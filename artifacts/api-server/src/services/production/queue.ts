import { pool } from "@workspace/db";
import { fail } from "../access";
import { assertRights } from "../catalog";
import { productionConfig, type ProductionConfig } from "./config";
import { assetUrl } from "./assets";
import { childhoodReference, lakeComoReference } from "./references";
export async function addMediaJob(client:{query:typeof pool.query},productionId:number,stage:string,targetId:number|null,dependencies:number[]=[]) {
  return (await client.query("INSERT INTO media_production_jobs(production_id,stage,target_id,dependencies)VALUES($1,$2,$3,$4)RETURNING id",
    [productionId,stage,targetId,JSON.stringify(dependencies)])).rows[0].id as number;
}
export async function startChapter(bookId:number,chapterId:number,maxSpend=10,resolution="1080p") {
  await assertRights(bookId);
  const config=await productionConfig();config.resolution=resolution as ProductionConfig["resolution"];
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const book=(await client.query("SELECT id,title FROM books WHERE id=$1 FOR UPDATE",[bookId])).rows[0];
    const chapter=(await client.query(`SELECT c.*,a.book_id,a.sections,a.status analysis_status,a.source_id
      FROM intelligence_chapters c JOIN book_analyses a ON a.id=c.analysis_id WHERE c.id=$1 AND a.book_id=$2`,[chapterId,bookId])).rows[0];
    if(!chapter||!["completed","needs_review"].includes(chapter.analysis_status))fail(409,"Choose a chapter from a completed blueprint");
    if((await client.query("SELECT id FROM media_productions WHERE blueprint_chapter_id=$1",[chapterId])).rowCount)fail(409,"This chapter already has a production. Use targeted scene controls.");
    const plans=(await client.query("SELECT * FROM intelligence_scenes WHERE chapter_id=$1 ORDER BY scene_number",[chapterId])).rows;
    if(!plans.length)fail(409,"No saved scene plan");
    // A narrator belongs to the book, not the individual chapter.
    const previous=(await client.query("SELECT configuration FROM media_productions WHERE book_id=$1 ORDER BY id LIMIT 1",[bookId])).rows[0];
    if(previous){config.voiceId=previous.configuration.voiceId;config.voiceModel=previous.configuration.voiceModel;config.voiceProvider=previous.configuration.voiceProvider;}
    const num=(await client.query("SELECT COALESCE(max(edition_number),0)+1 n FROM visual_editions WHERE book_id=$1",[bookId])).rows[0].n;
    const edition=(await client.query("INSERT INTO visual_editions(book_id,edition_number,status,published,sample)VALUES($1,$2,'generating',false,false)RETURNING id",[bookId,num])).rows[0];
    const actualNumber=Number(chapter.chapter_title.match(/^Chapter (\d+)$/)?.[1] ?? chapter.chapter_number);
    const playback=(await client.query("INSERT INTO chapters(visual_edition_id,chapter_number,title,summary,status,sort_order)VALUES($1,$2,$3,$4,'generating',1)RETURNING id",
      [edition.id,actualNumber,chapter.chapter_title,chapter.data.summary])).rows[0];
    const p=(await client.query(`INSERT INTO media_productions(book_id,analysis_id,blueprint_chapter_id,edition_id,chapter_id,max_spend,configuration)
      VALUES($1,$2,$3,$4,$5,$6,$7)RETURNING *`,[bookId,chapter.analysis_id,chapterId,edition.id,playback.id,maxSpend,
      JSON.stringify({...config,visualBible:chapter.sections.visual_style,narrationBible:chapter.sections.narration_style,chapterTitle:chapter.chapter_title,sourceId:chapter.source_id})])).rows[0];
    const charIds=[...new Set(plans.flatMap(s=>s.data.characters_present))];
    const envIds=[...new Set(plans.map(s=>s.data.environment_id).filter(Boolean))];
    const chars=(await client.query("SELECT * FROM intelligence_characters WHERE id=ANY($1::int[]) AND analysis_id=$2",[charIds,chapter.analysis_id])).rows;
    const envs=(await client.query("SELECT * FROM intelligence_environments WHERE id=ANY($1::int[]) AND analysis_id=$2",[envIds,chapter.analysis_id])).rows;
    const refs=[...chars.map(c=>({kind:"character",id:c.id,name:c.name,data:{...c.data,life_stage:"canonical"}})),...envs.map(e=>({kind:"environment",id:e.id,name:e.name,data:{...e.data,life_stage:"canonical"}}))];
    // Chapter 1 depicts childhood. Keep those life-stage references separate from the adult identity.
    if(/Frankenstein/i.test(book.title)&&chapter.chapter_title==="Chapter 1"){
      for(const c of chars.filter(c=>/Victor Frankenstein|Elizabeth Lavenza/i.test(c.name))){
        const variant=childhoodReference(c.name,c.data);
        if(/Elizabeth/i.test(c.name)){const ref=refs.find(r=>r.id===c.id&&r.kind==="character")!;ref.data=variant;}
        else refs.push({kind:"character_child",id:c.id,name:`${c.name} — childhood`,data:variant});
      }
      for(const plan of plans.filter(s=>/Lake Como/i.test(s.data.visual_description))){
        const ref=refs.find(r=>r.kind==="environment"&&r.id===plan.data.environment_id);
        if(ref){ref.id=-plan.id;ref.name="Lake Como — Elizabeth's adoption";ref.data=lakeComoReference(ref.data,plan.id);}
        plan.data={...plan.data,original_environment_id:plan.data.environment_id,environment_id:-plan.id};
      }
    }
    const refJobs:number[]=[];
    for(const ref of refs){
      const old=(await client.query(`SELECT r.current_asset_id,r.quality_score FROM media_references r JOIN media_productions p ON p.id=r.production_id
        WHERE p.analysis_id=$1 AND r.kind=$2 AND r.canonical_id=$3 AND r.status='approved' AND r.data->>'life_stage'=$4 LIMIT 1`,
        [chapter.analysis_id,ref.kind,ref.id,ref.data.life_stage])).rows[0];
      const row=(await client.query(`INSERT INTO media_references(production_id,kind,canonical_id,name,data,status,current_asset_id,quality_score)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)RETURNING id`,[p.id,ref.kind,ref.id,ref.name,JSON.stringify(ref.data),old?"approved":"queued",old?.current_asset_id??null,old?.quality_score??null])).rows[0];
      if(!old)refJobs.push(await addMediaJob(client,p.id,"reference",row.id));
    }
    for(const plan of plans){
      plan.data.source_reference=plan.data.source_reference.replace(/^Chapter \d+:/,`${chapter.chapter_title}:`);
      const s=(await client.query(`INSERT INTO scenes(chapter_id,scene_number,title,purpose,narration,visual_prompt,camera_direction,duration,source_notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)RETURNING id`,
        [playback.id,plan.scene_number,plan.data.scene_title,plan.data.purpose,plan.data.narration,plan.data.visual_description,plan.data.camera_direction,plan.data.estimated_duration,plan.data.source_reference])).rows[0];
      const scene=(await client.query(`INSERT INTO media_production_scenes(production_id,blueprint_scene_id,playback_scene_id,scene_number,data)VALUES($1,$2,$3,$4,$5)RETURNING id`,
        [p.id,plan.id,s.id,plan.scene_number,JSON.stringify(plan.data)])).rows[0];
      const take=(await client.query("INSERT INTO media_scene_takes(scene_id,version_number,narration)VALUES($1,1,$2)RETURNING id",[scene.id,plan.data.narration])).rows[0];
      const image=await addMediaJob(client,p.id,"image",take.id,refJobs);
      const voice=await addMediaJob(client,p.id,"voice",take.id,refJobs);
      await addMediaJob(client,p.id,"motion",take.id,[image,voice]);
    }
    await client.query("COMMIT");return p.id;
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
export async function productionState(bookId:number) {
  const book=(await pool.query("SELECT id,title FROM books WHERE id=$1",[bookId])).rows[0];if(!book)fail(404,"Book not found");
  const candidates=(await pool.query(`SELECT c.id,c.chapter_title,count(s.id)::int scene_count,
    (count(s.id)*.8+3.5)::float estimated_cost FROM intelligence_chapters c JOIN book_analyses a ON a.id=c.analysis_id
    JOIN intelligence_scenes s ON s.chapter_id=c.id WHERE a.book_id=$1 AND a.status IN('completed','needs_review')
    GROUP BY c.id ORDER BY CASE WHEN c.chapter_title='Chapter 1' THEN 0 ELSE 1 END,c.chapter_number`,[bookId])).rows;
  const productions=(await pool.query("SELECT * FROM media_productions WHERE book_id=$1 ORDER BY id DESC",[bookId])).rows;
  const active=productions[0]??null;const pid=active?.id??null;
  const [scenes,takes,references,jobs,renders,requests,assets]=await Promise.all([
    pool.query("SELECT * FROM media_production_scenes WHERE production_id=$1 ORDER BY scene_number",[pid]),
    pool.query("SELECT t.* FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id WHERE s.production_id=$1 ORDER BY t.version_number DESC",[pid]),
    pool.query("SELECT * FROM media_references WHERE production_id=$1 ORDER BY id",[pid]),
    pool.query("SELECT * FROM media_production_jobs WHERE production_id=$1 ORDER BY id DESC",[pid]),
    pool.query("SELECT * FROM chapter_media_renders WHERE production_id=$1 ORDER BY id DESC",[pid]),
    pool.query("SELECT r.*,t.scene_id FROM media_production_requests r LEFT JOIN media_scene_takes t ON t.id=r.take_id WHERE r.production_id=$1 ORDER BY r.id",[pid]),
    pool.query("SELECT id,take_id,reference_id,kind,mime_type,provider,model,cost,metadata,created_at FROM media_production_assets WHERE production_id=$1 ORDER BY id",[pid]),
  ]);
  const selected=scenes.rows.map(s=>s.current_version_id).filter(Boolean);
  if(active){
    active.actual_cost=requests.rows.some(r=>r.actual_cost===null)?null:requests.rows.reduce((n,r)=>n+Number(r.actual_cost),0);
    active.unknown_cost_requests=requests.rows.filter(r=>r.actual_cost===null).length;
    active.cost_estimates_by_kind=Object.fromEntries(["reference_image","scene_image","voice","quality"].map(k=>[k,requests.rows.filter(r=>r.kind===k).reduce((n,r)=>n+r.estimated_cost,0)]));
    active.cost_estimates_by_scene=Object.fromEntries(scenes.rows.map(s=>[s.id,requests.rows.filter(r=>r.scene_id===s.id).reduce((n,r)=>n+r.estimated_cost,0)]));
    active.actual_cost_by_kind=Object.fromEntries(["reference_image","scene_image","voice","quality","ai_video"].map(k=>[k,
      requests.rows.some(r=>r.kind===k&&r.actual_cost===null)?null:requests.rows.filter(r=>r.kind===k).reduce((n,r)=>n+Number(r.actual_cost),0)]));
    active.actual_cost_by_scene=Object.fromEntries(scenes.rows.map(s=>[s.id,
      requests.rows.some(r=>r.scene_id===s.id&&r.actual_cost===null)?null:requests.rows.filter(r=>r.scene_id===s.id).reduce((n,r)=>n+Number(r.actual_cost),0)]));
  }
  return {bookId,title:book.title,candidates,productions,activeProduction:active,
    scenes:scenes.rows.map(s=>({...s,versions:takes.rows.filter(t=>t.scene_id===s.id).map(t=>({...t,current:t.id===s.current_version_id,
      image_url:assetUrl(t.image_asset_id),audio_url:assetUrl(t.audio_asset_id),video_url:assetUrl(t.video_asset_id),caption_url:assetUrl(t.caption_asset_id),
      assets:assets.rows.filter(a=>[t.image_asset_id,t.audio_asset_id,t.video_asset_id,t.caption_asset_id].includes(a.id))}))})),
    references:references.rows.map(r=>({...r,asset_url:assetUrl(r.current_asset_id),assets:assets.rows.filter(a=>a.reference_id===r.id)})),
    jobs:jobs.rows.map(j=>({...j,status:j.status!=="queued"?j.status:
      ["failed","budget_paused"].includes(active?.status)?"blocked":
      j.stage!=="reference"&&references.rows.some(r=>r.status!=="approved")?"waiting_references":
      j.stage==="motion"&&!takes.rows.find(t=>t.id===j.target_id)?.image_approved?"waiting_approval":"queued"})),
    renders:renders.rows.map(r=>({...r,asset_url:assetUrl(r.asset_id),is_current:selected.length===scenes.rows.length&&JSON.stringify(r.scene_versions)===JSON.stringify(selected)})),
    assets:assets.rows.map(a=>({...a,asset_url:assetUrl(a.id)})),requests:requests.rows,
    configuration:{...(active?.configuration??await productionConfig()),aiVideoAvailable:(await productionConfig()).aiVideoAvailable}};
}