import { pool } from "@workspace/db";
import { productionConfig } from "./production/config";
import { sceneAnalytics } from "./improvement";
import { fail } from "./access";

export type EditorialRow={id:number;title:string;status:string;subtitle?:string;data:Record<string,unknown>};
export async function adminData(section:string):Promise<EditorialRow[]> {
  switch(section) {
    case "catalog": case "books": case "rights": {
      const {rows}=await pool.query(`SELECT b.*,e.status,e.id edition_id FROM books b
        LEFT JOIN LATERAL(SELECT * FROM visual_editions WHERE book_id=b.id ORDER BY edition_number DESC LIMIT 1)e ON true ORDER BY b.id`);
      return rows.map(b=>({id:b.id,title:b.title,subtitle:b.author,status:section==="rights"?b.rights_status:b.status??"requested",
        data:{title:b.title,author:b.author,description:b.description,genre:b.genre,year:b.original_publication_year,
          coverImage:b.cover_image,rightsStatus:b.rights_status,rightsNotes:b.rights_notes,license:b.license,
          searchCount:b.search_count,editionId:b.edition_id,sourceUrl:b.source_url}}));
    }
    case "visual-editions": case "editions": {
      const {rows}=await pool.query("SELECT e.*,b.title FROM visual_editions e JOIN books b ON b.id=e.book_id ORDER BY e.id");
      return rows.map(e=>({id:e.id,title:e.title,subtitle:`Edition ${e.edition_number} · v${e.version}`,status:e.status,
        data:{bookId:e.book_id,version:e.version,duration:e.total_duration,generationCost:e.generation_cost,sample:e.sample,published:e.published,analysis:e.analysis}}));
    }
    case "chapters": {
      const {rows}=await pool.query(`SELECT c.*,b.title book_title FROM chapters c JOIN visual_editions e ON e.id=c.visual_edition_id JOIN books b ON b.id=e.book_id ORDER BY c.id`);
      return rows.map(c=>({id:c.id,title:c.title,status:c.status,subtitle:c.book_title,data:{number:c.chapter_number,summary:c.summary,duration:c.duration,version:c.version,editionId:c.visual_edition_id}}));
    }
    case "scenes": {
      const {rows}=await pool.query(`SELECT s.*,c.title chapter_title FROM scenes s JOIN chapters c ON c.id=s.chapter_id ORDER BY s.id`);
      const versions=(await pool.query("SELECT * FROM scene_versions ORDER BY scene_id,version_number DESC")).rows;
      const analytics=await sceneAnalytics();
      return rows.map(s=>{
        const vs=versions.filter(v=>v.scene_id===s.id);
        const v=vs.find(v=>v.id===s.current_version_id);
        return {id:s.id,title:s.title,subtitle:s.chapter_title,status:s.status,data:{
          chapterId:s.chapter_id,number:s.scene_number,purpose:s.purpose,narration:v?.narration??s.narration,
          visualPrompt:s.visual_prompt,cameraDirection:s.camera_direction,duration:s.duration,characters:s.characters_present,
          environmentId:s.environment_id,sourceNotes:s.source_notes,currentVersionId:s.current_version_id,
          imageUrl:v?.image_asset??"",videoUrl:v?.video_asset??"",audioUrl:v?.audio_asset??"",captionUrl:v?.caption_asset??"",
          analytics:analytics.find(a=>a.id===s.id),versions:vs.map(v=>({id:v.id,version:v.version_number,number:v.version_number,versionNumber:v.version_number,current:v.id===s.current_version_id,status:v.render_status,
            narration:v.narration,imageUrl:v.image_asset,videoUrl:v.video_asset,audioUrl:v.audio_asset,captionUrl:v.caption_asset,provider:v.generation_provider,model:v.generation_model,cost:v.generation_cost,notes:v.notes,createdAt:v.created_at})),
        }};
      });
    }
    case "characters": case "environments": {
      const table=section;
      const {rows}=await pool.query(`SELECT x.*,b.title book_title FROM ${table} x JOIN books b ON b.id=x.book_id ORDER BY x.id`);
      return rows.map(r=>({id:r.id,title:r.name,subtitle:r.book_title,status:"canonical",data:r}));
    }
    case "requests": {
      const {rows}=await pool.query(`SELECT min(r.id)::int id,r.normalized_title,max(r.title) title,max(r.author) author,max(r.matched_book_id) book_id,
        count(*)::int request_count,max(r.status) status,max(b.rights_status) rights_status,max(b.search_count) search_count
        FROM book_requests r LEFT JOIN books b ON b.id=r.matched_book_id GROUP BY r.normalized_title ORDER BY count(*) DESC`);
      return rows.map(r=>({id:r.id,title:r.title,subtitle:r.author,status:r.status,data:{
        bookId:r.book_id,requestCount:r.request_count,searchCount:r.search_count??0,rightsStatus:r.rights_status??"unknown",
        demandScore:r.request_count*10+(r.search_count??0),estimatedGenerationCost:null,
      }}));
    }
    case "generation-queue": case "queue": case "jobs": {
      const {rows}=await pool.query("SELECT j.*,b.title FROM generation_jobs j JOIN books b ON b.id=j.book_id ORDER BY j.created_at DESC");
      return rows.map(j=>({id:j.id,title:j.title,status:j.status,subtitle:j.job_type,data:{
        bookId:j.book_id,editionId:j.visual_edition_id,stage:j.job_type,percentage:j.percentage,currentChapter:j.chapter_id,currentScene:j.scene_id,
        provider:j.provider,model:j.model,estimatedCost:j.estimated_cost,actualCost:j.cost,attempts:j.attempts,
        error:j.error_message,result:j.result,createdAt:j.created_at,completedAt:j.completed_at,
      }}));
    }
    case "feedback": {
      const {rows}=await pool.query(`SELECT f.*,b.title book_title,s.title scene_title FROM feedback f JOIN books b ON b.id=f.book_id LEFT JOIN scenes s ON s.id=f.scene_id ORDER BY f.created_at DESC`);
      return rows.map(f=>({id:f.id,title:f.book_title,subtitle:f.scene_title,status:f.rating===1?"positive":"negative",
        data:{bookId:f.book_id,chapterId:f.chapter_id,sceneId:f.scene_id,rating:f.rating,feedbackType:f.feedback_type,comment:f.comment,createdAt:f.created_at}}));
    }
    case "analytics": {
      return (await sceneAnalytics()).map(s=>({id:s.id,title:s.title,status:s.revisionRecommended?"revision_recommended":s.starts?"healthy":"awaiting_data",data:s}));
    }
    case "costs": {
      const {rows}=await pool.query(`SELECT b.id,b.title,
        CASE WHEN COALESCE(j.unknown,0)+COALESCE(m.unknown,0)>0 THEN NULL ELSE COALESCE(j.actual,0)+COALESCE(m.actual,0) END actual_cost,
        (COALESCE(j.estimate,0)+COALESCE(m.estimate,0))::float estimated_cost,
        (COALESCE(j.jobs,0)+COALESCE(m.jobs,0))::int jobs,(COALESCE(j.unknown,0)+COALESCE(m.unknown,0))::int unknown_cost_jobs
        FROM books b
        LEFT JOIN LATERAL(SELECT sum(cost) actual,sum(estimated_cost) estimate,count(*) jobs,count(*)FILTER(WHERE cost IS NULL) unknown FROM generation_jobs WHERE book_id=b.id)j ON true
        LEFT JOIN LATERAL(SELECT sum(r.actual_cost) actual,sum(r.estimated_cost) estimate,count(*) jobs,count(*)FILTER(WHERE r.actual_cost IS NULL) unknown
          FROM media_production_requests r JOIN media_productions p ON p.id=r.production_id WHERE p.book_id=b.id)m ON true ORDER BY b.id`);
      return rows.map(r=>({id:r.id,title:r.title,status:r.unknown_cost_jobs?"cost_unconfirmed":"recorded",data:{
        actualCost:r.actual_cost,estimatedCost:r.estimated_cost,totalJobs:r.jobs,costUnconfirmedJobs:r.unknown_cost_jobs,
        note:"Actual provider billing is not inferred from token counts. Sample assets have no recorded runtime generation spend.",
      }}));
    }
    case "providers": {
      const s=(await pool.query("SELECT value FROM settings WHERE key='providers'")).rows[0]?.value??{};
      const media=await productionConfig();
      return [{id:1,title:"Text analysis",status:"configured",data:{provider:s.textProvider??"openai",model:s.textModel??"gpt-5.4-mini",...s}},
        {id:2,title:"Image generation",status:"configured",data:{provider:media.imageProvider,model:media.imageModel,quality:media.imageQuality}},
        {id:3,title:"Video generation",status:"controlled_motion",data:{provider:media.motionProvider,aiVideoAvailable:media.aiVideoAvailable,note:"V1 uses restrained camera pans and zooms. AI video is optional and never a prerequisite."}},
        {id:4,title:"Voice generation",status:"configured",data:{provider:media.voiceProvider,model:media.voiceModel,voiceId:media.voiceId,note:"Narrator identity is locked book-wide after the first narration request."}}];
    }
    case "settings": {
      const {rows}=await pool.query("SELECT * FROM settings ORDER BY id");
      return rows.map(s=>({id:s.id,title:s.key,status:"configured",data:s.value}));
    }
    default: fail(404,"Unknown editorial section");
  }
}
export async function adminOverview() {
  const {rows}=await pool.query(`SELECT
    (SELECT count(*)::int FROM books) total_books,
    (SELECT count(*)::int FROM visual_editions WHERE published=true) published_editions,
    (SELECT count(*)::int FROM generation_jobs WHERE status IN('queued','processing')) generating,
    (SELECT count(DISTINCT normalized_title)::int FROM book_requests WHERE status='requested') requested,
    (SELECT count(DISTINCT user_id)::int FROM view_events) viewers,
    (SELECT COALESCE(sum(watch_seconds),0)::float/3600 FROM view_events) watch_hours,
    (SELECT CASE WHEN count(*)=0 THEN 0 ELSE count(*) FILTER(WHERE percentage_complete>=99.9)::float/count(*)*100 END FROM user_book_progress) completion_rate,
    (SELECT COALESCE(sum(cost),0)::float FROM generation_jobs) generation_spend`);
  const r=rows[0];
  const mostWatched=(await pool.query(`SELECT b.id,b.title,count(v.id)::int views FROM books b JOIN view_events v ON v.book_id=b.id AND v.event_type='scene_started' GROUP BY b.id ORDER BY count(v.id) DESC LIMIT 5`)).rows;
  return {totalBooks:r.total_books,publishedEditions:r.published_editions,generating:r.generating,requested:r.requested,viewers:r.viewers,
    watchHours:r.watch_hours,completionRate:r.completion_rate,generationSpend:r.generation_spend,
    averageCost:r.published_editions?r.generation_spend/r.published_editions:0,
    mostWatched:mostWatched.map(b=>({id:b.id,title:b.title,status:"published",data:{views:b.views}})),
    mostRequested:(await adminData("requests")).slice(0,5),
    revisions:(await adminData("analytics")).filter(r=>r.status==="revision_recommended")};
}