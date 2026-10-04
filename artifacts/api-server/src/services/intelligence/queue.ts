import { pool } from "@workspace/db";
import { fail } from "../access";
import { assertRights } from "../catalog";
import { ingestSource,loadSource,detectChapters } from "./source";

const connection=()=>pool.connect();
type Client=Awaited<ReturnType<typeof connection>>;
async function addJob(client:Client,analysisId:number,stage:string,dependencies:number[]=[],targetId:number|null=null) {
  const row=(await client.query(`INSERT INTO intelligence_jobs(analysis_id,stage,target_id,dependencies)
    VALUES($1,$2,$3,$4) RETURNING id`,[analysisId,stage,targetId,JSON.stringify(dependencies)])).rows[0];
  return Number(row.id);
}
export async function analyzeBook(bookId:number,sourceId?:number) {
  const book=await assertRights(bookId);
  let source=(await pool.query("SELECT * FROM book_sources WHERE book_id=$1 AND ($2::int IS NULL OR id=$2) ORDER BY source_version DESC LIMIT 1",[bookId,sourceId??null])).rows[0];
  if(!source && sourceId)fail(404,"Source does not belong to this book");
  if(!source) {
    if(book.rights_status!=="public_domain"||!book.source_url)fail(400,"Ingest documented source text before starting analysis");
    source=await ingestSource(bookId,{sourceType:"public_domain",rightsStatus:"public_domain",rightsNotes:book.rights_notes,sourceUrl:book.source_url});
  }
  const {text}=await loadSource(source.id);
  const detected=detectChapters(text);
  if(detected.length>150)fail(400,"Source exceeds the 150-section analysis limit; prepare a chapter-structured source");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT id FROM books WHERE id=$1 FOR UPDATE",[bookId]);
    const running=(await client.query("SELECT id FROM book_analyses WHERE book_id=$1 AND status IN('queued','running')",[bookId])).rows;
    if(running.length)fail(409,"An analysis is already active for this book");
    const prior=(await client.query("SELECT id FROM book_analyses WHERE book_id=$1 AND source_id=$2 ORDER BY analysis_version DESC LIMIT 1",[bookId,source.id])).rows[0];
    if(prior)fail(409,"This source already has an analysis. Retry failed stages or use targeted revision controls; a full-book rerun requires a new source version.");
    const version=(await client.query("SELECT COALESCE(max(analysis_version),0)+1 n FROM book_analyses WHERE book_id=$1",[bookId])).rows[0].n;
    const editionNumber=(await client.query("SELECT COALESCE(max(edition_number),0)+1 n FROM visual_editions WHERE book_id=$1",[bookId])).rows[0].n;
    const edition=(await client.query("INSERT INTO visual_editions(book_id,edition_number,status,published,sample) VALUES($1,$2,'planning',false,false) RETURNING id",[bookId,editionNumber])).rows[0];
    const analysis=(await client.query("INSERT INTO book_analyses(book_id,source_id,visual_edition_id,analysis_version) VALUES($1,$2,$3,$4) RETURNING id",[bookId,source.id,edition.id,version])).rows[0];
    const aid=analysis.id;
    const a=await addJob(client,aid,"overview");
    const b=await addJob(client,aid,"chapter_detection",[a]);
    const gJobs:number[]=[];
    const chapterIds:number[]=[];
    for(const c of detected) {
      const row=(await client.query(`INSERT INTO intelligence_chapters(analysis_id,chapter_number,chapter_title,start_offset,end_offset)VALUES($1,$2,$3,$4,$5) RETURNING id`,
        [aid,c.chapter_number,c.chapter_title,c.start_offset,c.end_offset])).rows[0];
      chapterIds.push(row.id);
      gJobs.push(await addJob(client,aid,"chapter_analysis",[b],row.id));
    }
    const c=await addJob(client,aid,"character_roster",gJobs);
    const d=await addJob(client,aid,"environments",gJobs);
    const e=await addJob(client,aid,"themes",gJobs);
    const f=await addJob(client,aid,"structure",[...gJobs,c,d]);
    const refined=await addJob(client,aid,"overview",[c,d,e,f]);
    const i=await addJob(client,aid,"visual_style",[refined]);
    const j=await addJob(client,aid,"narration_style",[refined]);
    for(const id of chapterIds)await addJob(client,aid,"scene_plan",[c,d,i,j,f],id);
    await client.query("COMMIT");return aid;
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function targetedRevision(bookId:number,operation:string,analysisId:number,targetId?:number) {
  await assertRights(bookId);
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const analysis=(await client.query("SELECT * FROM book_analyses WHERE id=$1 AND book_id=$2 FOR UPDATE",[analysisId,bookId])).rows[0];
    if(!analysis)fail(404,"Analysis not found for this book");
    if(operation==="retry_failed") {
      const failures=await client.query("SELECT id FROM intelligence_jobs WHERE analysis_id=$1 AND status='failed'",[analysisId]);
      if(!failures.rowCount)fail(409,"No failed stages to retry");
      await client.query("UPDATE intelligence_jobs SET status='queued',attempts=0,error=NULL,retry_at=NULL,lease_until=NULL WHERE analysis_id=$1 AND status IN('failed','blocked')",[analysisId]);
    }else {
      if(!["completed","needs_review"].includes(analysis.status))fail(409,"Wait for the current analysis to finish");
      if(!targetId)fail(400,"Choose the specific chapter, character or environment to revise");
      const stage=operation==="reanalyze_chapter"?"chapter_analysis":operation==="regenerate_character"?"characters":operation==="regenerate_environment"?"environments":"scene_plan";
      const table=stage==="characters"?"intelligence_characters":stage==="environments"?"intelligence_environments":"intelligence_chapters";
      const target=(await client.query(`SELECT id FROM ${table} WHERE id=$1 AND analysis_id=$2`,[targetId,analysisId])).rows[0];
      if(!target)fail(404,"Revision target does not belong to this analysis");
      const id=await addJob(client,analysisId,stage,[],targetId);
      if(stage==="chapter_analysis") {
        await addJob(client,analysisId,"scene_plan",[id],targetId);
        await client.query("UPDATE book_analyses SET stale_sections=$2 WHERE id=$1",[analysisId,JSON.stringify(["overview","themes","structure","visual_style","narration_style"])]);
      }
    }
    await client.query("UPDATE book_analyses SET status='running',completed_at=NULL WHERE id=$1",[analysisId]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function intelligenceState(bookId:number) {
  const book=(await pool.query("SELECT id,title FROM books WHERE id=$1",[bookId])).rows[0];
  if(!book)fail(404,"Book not found");
  const sources=(await pool.query("SELECT * FROM book_sources WHERE book_id=$1 ORDER BY source_version DESC",[bookId])).rows;
  const analyses=(await pool.query("SELECT * FROM book_analyses WHERE book_id=$1 ORDER BY analysis_version DESC",[bookId])).rows;
  const active=analyses[0]??null;
  const [chapters,characters,environments,scenes,jobs]=await Promise.all(
    ["intelligence_chapters","intelligence_characters","intelligence_environments","intelligence_scenes","intelligence_jobs"].map(async table=>(await pool.query(`SELECT * FROM ${table} WHERE analysis_id=$1 ORDER BY id`,[active?.id??null])).rows));
  return {bookId:book.id,title:book.title,sources,analyses,activeAnalysis:active,sections:active?.sections??{},chapters,characters,environments,scenes,jobs};
}