import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { assertRights } from "../catalog";
import { batchProcess } from "./batch";
import { sourceText,stageContext,generateStage,type Job } from "./provider";
import { detectChapters } from "./source";
import { saveStage,finalizeAnalysis } from "./persistence";

let working=false;
const PROMPT_VERSION="intelligence-2";
export function startIntelligenceEngine() {
  const timer=setInterval(()=>void tickIntelligence().catch(err=>logger.error({err},"Book Intelligence scheduler failed")),1500);
  timer.unref();
}
export async function tickIntelligence() {
  if(working)return;
  working=true;
  try{
    const {rows}=await pool.query(`WITH ready AS(
      SELECT j.id FROM intelligence_jobs j JOIN book_analyses a ON a.id=j.analysis_id
      WHERE a.status IN('queued','running') AND (j.status='queued' OR(j.status='running' AND j.lease_until<now()))
      AND (j.retry_at IS NULL OR j.retry_at<=now())
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(j.dependencies) dep
        JOIN intelligence_jobs p ON p.id=dep::int WHERE p.status<>'completed')
      ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 2)
      UPDATE intelligence_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '4 minutes'
      WHERE id IN(SELECT id FROM ready) RETURNING *`);
    if(!rows.length)return;
    await batchProcess(rows as Job[],async job=>{
      const analysis=(await pool.query("SELECT * FROM book_analyses WHERE id=$1",[job.analysis_id])).rows[0];
      try {
        await assertRights(analysis.book_id);
        await pool.query("UPDATE book_analyses SET status='running' WHERE id=$1",[job.analysis_id]);
        const settings=(await pool.query("SELECT value FROM settings WHERE key='providers'")).rows[0]?.value??{};
        job.provider=String(settings.textProvider??"openai");job.model=String(settings.textModel??"gpt-5.4-mini");
        await pool.query("UPDATE intelligence_jobs SET provider=$2,model=$3,prompt_version=$4 WHERE id=$1",[job.id,job.provider,job.model,PROMPT_VERSION]);
        const {context,instruction}=await stageContext(job);
        let result:unknown;
        if(job.stage==="chapter_detection") {
          const text=await sourceText(analysis.source_id);
          const chapters=detectChapters(text);
          let cursor=0;
          for(const c of chapters){if(c.start_offset!==cursor||c.end_offset<=c.start_offset)throw new Error("Source chapter ranges have a gap or overlap");cursor=c.end_offset;}
          result={chapters,source_characters:text.length,covered_characters:cursor,scope:"Complete ingested source; contiguous character ranges without truncation",
            detection_method:/Source section/.test(chapters[0]?.chapter_title??"")?"paragraph-bounded source sections (no explicit chapter headings)":"source chapter/letter headings"};
          if(cursor!==text.length)throw new Error("Chapter detection omitted source text");
        }else {
          result=(await generateStage(job,context,instruction)).output;
        }
        await saveStage(job,result);
        logger.info({analysisId:job.analysis_id,jobId:job.id,stage:job.stage},"Book Intelligence stage completed");
      }catch(err) {
        const message=err instanceof Error?err.message:"Unknown analysis failure";
        const last=job.attempts>=3;
        const providerError=err as {status?:number;headers?:Headers};
        const retryHeader=providerError.headers?.get?.("retry-after");
        const retrySeconds=retryHeader?Number(retryHeader):0;
        const backoff=providerError.status===429?Math.max(Number.isFinite(retrySeconds)?retrySeconds:0,60*job.attempts):Math.min(60,2**job.attempts*2);
        const failure={attempt:job.attempts,message,created_at:new Date().toISOString(),provider:job.provider,model:job.model,prompt_version:PROMPT_VERSION};
        // Validation and transport failures are retried with bounded backoff;
        // no invalid output is ever committed as canonical data.
        await pool.query(`UPDATE intelligence_jobs SET status=$2,error=$3,failure_log=failure_log||$4::jsonb,
          retry_at=CASE WHEN $2='queued' THEN now()+($5::text||' seconds')::interval ELSE NULL END,lease_until=NULL WHERE id=$1`,
          [job.id,last?"failed":"queued",message,JSON.stringify([failure]),backoff]);
        if(providerError.status===429) {
          // A provider-wide rate limit also pauses other queued calls; letting
          // them immediately consume their own retry budgets would cascade one
          // rate limit into failures across otherwise independent stages.
          await pool.query(`UPDATE intelligence_jobs SET retry_at=GREATEST(COALESCE(retry_at,now()),now()+($2::text||' seconds')::interval)
            WHERE provider=$1 AND status='queued' AND stage<>'chapter_detection'`,[job.provider,backoff]);
        }
        if(last) {
          await pool.query(`UPDATE intelligence_jobs SET status='blocked',error='A required stage failed; retry the failed stages first'
            WHERE analysis_id=$1 AND status='queued'`,[job.analysis_id]);
        }
        logger.warn({jobId:job.id,stage:job.stage,attempt:job.attempts,error:message},"Book Intelligence stage failed");
      }
      try {
        await finalizeAnalysis(job.analysis_id);
      }catch(err) {
        const message=err instanceof Error?err.message:"Blueprint finalization failed";
        await pool.query("UPDATE intelligence_jobs SET status='failed',error=$2 WHERE id=$1",[job.id,message]);
        await pool.query("UPDATE book_analyses SET status='failed' WHERE id=$1",[job.analysis_id]);
        logger.error({jobId:job.id,analysisId:job.analysis_id,error:message},"Book Intelligence finalization failed");
      }
    },{concurrency:2,retries:0});
  }finally{working=false;}
}