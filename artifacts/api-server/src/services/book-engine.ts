import { pool } from "@workspace/db";
import { assertRights } from "./catalog";
import { providerRegistry,bookPlanSchema } from "./providers";
import { logger } from "../lib/logger";

let working=false;
export function startBookEngine() {
  const timer=setInterval(()=>{void runNext().catch(err=>logger.error({err},"Book Engine worker error"));},4000);
  timer.unref();
}
async function runNext() {
  if(working)return;
  working=true;
  let job:Record<string,any>|undefined;
  try {
    const claimed=await pool.query(`WITH candidate AS (
      SELECT id FROM generation_jobs WHERE job_type='book_analysis' AND (status='queued' OR(status='processing' AND lease_until<now()))
      ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE generation_jobs SET status='processing',attempts=attempts+1,percentage=10,lease_until=now()+interval '5 minutes'
      WHERE id=(SELECT id FROM candidate) RETURNING *`);
    job=claimed.rows[0]; if(!job)return;
    const book=await assertRights(job.book_id);
    const edition=(await pool.query("SELECT * FROM visual_editions WHERE id=$1",[job.visual_edition_id])).rows[0];
    if(edition?.published)throw new Error("Published editions cannot be overwritten by planning jobs");
    let source="";
    if(book.source_url) {
      const url=new URL(book.source_url);
      if(url.protocol!=="https:"||url.hostname!=="www.gutenberg.org")throw new Error("Source must be an approved Project Gutenberg text URL");
      let response=await fetch(url,{signal:AbortSignal.timeout(30000),redirect:"manual"});
      for(let redirects=0;response.status>=300&&response.status<400&&redirects<3;redirects++) {
        const location=response.headers.get("location");
        if(!location)throw new Error("Source redirect has no destination");
        const next=new URL(location,url);
        if(next.hostname==="www.gutenberg.org" && next.protocol==="http:")next.protocol="https:";
        if(next.protocol!=="https:"||next.hostname!=="www.gutenberg.org")throw new Error("Source redirected outside the approved host");
        response=await fetch(next,{signal:AbortSignal.timeout(30000),redirect:"manual"});
      }
      if(!response.ok)throw new Error(`Source download failed (${response.status})`);
      const body=await response.text();
      source=body.slice(0,60000);
    }
    if(!source)throw new Error("An approved source text is required before planning");
    const settings=(await pool.query("SELECT value FROM settings WHERE key='providers'")).rows[0]?.value??{};
    const name=String(settings.textProvider??process.env.TEXT_PROVIDER??"openai");
    const model=String(settings.textModel??"gpt-5.4-mini");
    await pool.query("UPDATE generation_jobs SET provider=$2,model=$3,percentage=25 WHERE id=$1 AND status='processing'",[job.id,name,model]);
    const cached=job.result?.generatedAnalysis;
    const result:Awaited<ReturnType<ReturnType<typeof providerRegistry.text>["generateText"]>>=cached ? {...cached,plan:bookPlanSchema.parse(cached.plan)} : await providerRegistry.text(name).generateText(`Book: ${book.title} by ${book.author}. Genre: ${book.genre}. The following is the first 60,000 characters of source text, not necessarily the whole book. Return only a sample excerpt plan. SOURCE:\n${source}`,model);
    // Store completed provider work before editorial state checks, so pausing and
    // resuming never repeats a successful paid call.
    await pool.query("UPDATE generation_jobs SET result=$2 WHERE id=$1",[job.id,JSON.stringify({generatedAnalysis:result,actualCostKnown:false})]);
    await assertRights(book.id);
    const client=await pool.connect();
    try {
      await client.query("BEGIN");
      const state=(await client.query("SELECT status FROM generation_jobs WHERE id=$1 FOR UPDATE",[job.id])).rows[0];
      if(state?.status!=="processing"){await client.query("ROLLBACK");return;}
      const charIds:Record<string,number>={};
      for(const c of result.plan.characters) {
        const row=await client.query(`INSERT INTO characters(book_id,name,description,age,appearance,wardrobe,personality,character_prompt,consistency_notes)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[book.id,c.name,c.description,c.age,JSON.stringify(c.appearance),c.wardrobe,c.personality,c.canonicalPrompt,c.consistencyNotes]);
        charIds[c.name]=row.rows[0].id;
      }
      const envIds:Record<string,number>={};
      for(const e of result.plan.environments) {
        const row=await client.query(`INSERT INTO environments(book_id,name,description,location,time_period,visual_style,environment_prompt,details)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[book.id,e.name,e.description,e.location,e.period,e.visualStyle,e.canonicalPrompt,JSON.stringify(e.details)]);
        envIds[e.name]=row.rows[0].id;
      }
      const existing=(await client.query("SELECT count(*)::int n FROM chapters WHERE visual_edition_id=$1",[job.visual_edition_id])).rows[0].n;
      if(existing)throw new Error("Edition already has a chapter plan; create a new edition rather than replacing its scenes");
      let duration=0;
      for(const [ci,c] of result.plan.chapters.entries()) {
        const cDuration=c.scenes.reduce((a,s)=>a+s.duration,0);duration+=cDuration;
        const row=await client.query(`INSERT INTO chapters(visual_edition_id,chapter_number,title,summary,duration,status,sort_order) VALUES($1,$2,$3,$4,$5,'planning',$2) RETURNING id`,[job.visual_edition_id,ci+1,c.title,c.summary,cDuration]);
        for(const [si,s] of c.scenes.entries()) await client.query(`INSERT INTO scenes(chapter_id,scene_number,title,purpose,narration,visual_prompt,camera_direction,characters_present,environment_id,duration,educational_goal,source_notes,spoiler_level)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,[row.rows[0].id,si+1,s.title,s.purpose,s.narration,s.visualPrompt,s.cameraDirection,JSON.stringify(s.characters.map(n=>charIds[n]).filter(Boolean)),envIds[s.environment]??null,s.duration,s.objective,s.sourceReference,s.spoilerLevel]);
      }
      const analysis={...result.plan,analysisScope:"Excerpt-based sample: first 60,000 source characters; not a complete adaptation",sourceUrl:book.source_url,provider:result.provider,model:result.model,promptVersion:"book-plan-1",usage:result.usage};
      await client.query("UPDATE visual_editions SET analysis=$2,status='review',total_duration=$3,updated_at=now() WHERE id=$1",[job.visual_edition_id,JSON.stringify(analysis),duration]);
      await client.query("UPDATE generation_jobs SET status='completed',percentage=100,result=$2,completed_at=now(),lease_until=NULL WHERE id=$1",[job.id,JSON.stringify({usage:result.usage,model:result.model,scope:analysis.analysisScope,actualCostKnown:false})]);
      await client.query("COMMIT");
    } catch(e){await client.query("ROLLBACK");throw e;} finally{client.release();}
  } catch(err) {
    if(job)await pool.query("UPDATE generation_jobs SET status='failed',error_message=$2,completed_at=now(),lease_until=NULL WHERE id=$1 AND status='processing'",[job.id,err instanceof Error?err.message:"Unknown generation failure"]);
    logger.error({err,jobId:job?.id},"Book analysis failed");
  } finally{working=false;}
}