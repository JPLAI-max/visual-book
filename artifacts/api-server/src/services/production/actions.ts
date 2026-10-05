import { pool } from "@workspace/db";
import type { ProductionInput } from "@workspace/api-zod";
import { assertRights } from "../catalog";
import { fail } from "../access";
import { addMediaJob, startChapter } from "./queue";
import { assetUrl } from "./assets";
import { productionConfig } from "./config";
export async function productionAction(bookId:number,input:ProductionInput,userId:string|null) {
  await assertRights(bookId);
  if(input.operation==="start_chapter"){if(!input.chapterId)fail(400,"Choose a blueprint chapter");return startChapter(bookId,input.chapterId,input.maxSpend,input.resolution);}
  if((input.operation==="upgrade_ai_video"||input.motionType==="AI_VIDEO")&&!(await productionConfig()).aiVideoAvailable)fail(503,"AI_VIDEO is optional and not connected. Current camera-motion scenes remain usable.");
  if(input.operation==="configure"&&!input.productionId){
    const config=await productionConfig();
    for(const key of ["voiceId","qualityThreshold","maxRetries","jobMaxSpend","resolution"] as const)if(input[key]!==undefined)(config as any)[key]=input[key];
    await pool.query("INSERT INTO settings(key,value)VALUES('media_production',$1)ON CONFLICT(key)DO UPDATE SET value=$1",[JSON.stringify(config)]);
    return;
  }
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    const p=(await client.query("SELECT * FROM media_productions WHERE id=$1 AND book_id=$2 FOR UPDATE",[input.productionId,bookId])).rows[0];
    if(!p)fail(404,"Production not found");
    const busy=(await client.query("SELECT id FROM media_production_jobs WHERE production_id=$1 AND status='running'",[p.id])).rowCount;
    if(busy)fail(409,"Wait for the current asset job to finish");
    const op=input.operation;
    if(op==="configure"){
      const config={...p.configuration};
      if(input.voiceId&&input.voiceId!==config.voiceId){
        const audio=(await client.query(`SELECT r.id FROM media_production_requests r JOIN media_productions p ON p.id=r.production_id WHERE p.book_id=$1 AND r.kind='voice' LIMIT 1`,[bookId])).rowCount;
        if(audio)fail(409,"Narrator voice is locked for this book after narration generation");
        config.voiceId=input.voiceId;
      }
      for(const k of ["qualityThreshold","maxRetries","jobMaxSpend","resolution"] as const)if(input[k]!==undefined)config[k]=input[k];
      if(input.maxSpend!==undefined&&input.maxSpend<p.reserved_spend)fail(400,"Budget cannot be below existing reservations");
      await client.query("UPDATE media_productions SET configuration=$2,max_spend=$3 WHERE id=$1",[p.id,JSON.stringify(config),input.maxSpend??p.max_spend]);
    }else if(["approve_reference","reject_reference","regenerate_reference"].includes(op)){
      const ref=(await client.query("SELECT * FROM media_references WHERE id=$1 AND production_id=$2 FOR UPDATE",[input.referenceId,p.id])).rows[0];
      if(!ref)fail(404,"Reference does not belong to this production");
      if(op==="regenerate_reference"){
        if((await client.query("SELECT id FROM media_production_jobs WHERE production_id=$1 AND stage='reference' AND target_id=$2 AND status='queued'",[p.id,ref.id])).rowCount)fail(409,"Reference generation is already queued");
        await client.query("UPDATE media_references SET status='queued',current_asset_id=NULL WHERE id=$1",[ref.id]);
        await addMediaJob(client,p.id,"reference",ref.id);
      }else {
        if(op==="approve_reference"&&!ref.current_asset_id)fail(409,"Generate the reference before approving");
        await client.query("UPDATE media_references SET status=$2 WHERE id=$1",[ref.id,op==="approve_reference"?"approved":"rejected"]);
      }
    }else if(op==="retry_job"){
      const job=(await client.query("SELECT * FROM media_production_jobs WHERE id=$1 AND production_id=$2 AND status IN('failed','budget_paused')",[input.jobId,p.id])).rows[0];
      if(!job)fail(409,"Only failed or budget-paused jobs can be explicitly retried");
      await client.query("UPDATE media_production_jobs SET status='queued',attempts=0,error=NULL,lease_until=NULL,retry_at=NULL WHERE id=$1",[job.id]);
      await client.query("UPDATE media_productions SET status='generating' WHERE id=$1",[p.id]);
    }else if(["regenerate_image","regenerate_video","regenerate_voice","edit_prompt","upgrade_ai_video"].includes(op)){
      const s=(await client.query("SELECT * FROM media_production_scenes WHERE id=$1 AND production_id=$2 FOR UPDATE",[input.sceneId,p.id])).rows[0];
      if(!s)fail(404,"Scene does not belong to this production");
      if((await client.query(`SELECT j.id FROM media_production_jobs j JOIN media_scene_takes t ON t.id=j.target_id
        WHERE j.production_id=$1 AND t.scene_id=$2 AND j.stage IN('image','voice','motion') AND j.status IN('queued','running')`,[p.id,s.id])).rowCount)fail(409,"This scene already has pending generation");
      const base=(await client.query("SELECT * FROM media_scene_takes WHERE scene_id=$1 AND($2::int IS NULL OR id=$2)ORDER BY version_number DESC LIMIT 1",[s.id,input.versionId??null])).rows[0];
      if(!base)fail(404,"Selected base take does not belong to this scene");
      const next=(await client.query("SELECT max(version_number)+1 n FROM media_scene_takes WHERE scene_id=$1",[s.id])).rows[0].n;
      const mode=op==="upgrade_ai_video"?"AI_VIDEO":input.motionType??base.motion_type;
      if(mode==="PARALLAX"&&!base.metadata.foregroundAssetId)fail(409,"Parallax requires an approved transparent foreground layer; use PAN_ZOOM");
      const take=(await client.query(`INSERT INTO media_scene_takes(scene_id,version_number,narration,motion_type,prompt,negative_prompt,image_asset_id,audio_asset_id,caption_asset_id,image_approved,quality_score,quality,duration,metadata,status)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)RETURNING id`,
        [s.id,next,base.narration,mode,input.prompt??base.prompt,input.negativePrompt??base.negative_prompt,
          op==="regenerate_image"?null:base.image_asset_id,op==="regenerate_voice"?null:base.audio_asset_id,op==="regenerate_voice"?null:base.caption_asset_id,
          op==="regenerate_image"?false:base.image_approved,op==="regenerate_image"?null:base.quality_score,JSON.stringify(base.quality),base.duration,
          JSON.stringify({...base.metadata,sourceTakeId:base.id,requiresGeneration:op==="edit_prompt"}),op==="edit_prompt"?"draft":"generating"])).rows[0];
      if(op!=="edit_prompt"){
        const deps:number[]=[];
        if(op==="regenerate_image")deps.push(await addMediaJob(client,p.id,"image",take.id));
        if(op==="regenerate_voice")deps.push(await addMediaJob(client,p.id,"voice",take.id));
        await addMediaJob(client,p.id,"motion",take.id,deps);
        await client.query("UPDATE media_productions SET status='generating' WHERE id=$1",[p.id]);
      }
    }else if(["approve_image","approve","reject","set_current"].includes(op)){
      const take=(await client.query(`SELECT t.*,s.production_id,s.id parent_scene FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id
        WHERE t.id=$1 AND s.production_id=$2 FOR UPDATE OF t,s`,[input.versionId,p.id])).rows[0];
      if(!take)fail(404,"Take does not belong to this production");
      if(op==="approve_image"){
        if(!take.image_asset_id)fail(409,"No image to approve");
        await client.query("UPDATE media_scene_takes SET image_approved=true WHERE id=$1",[take.id]);
      }else if(op==="reject")await client.query("UPDATE media_scene_takes SET status='rejected' WHERE id=$1",[take.id]);
      else {
        if(!take.image_asset_id||!take.audio_asset_id||!take.caption_asset_id||!take.video_asset_id||take.metadata.requiresGeneration)fail(409,"A complete regenerated image, motion, narration and captions bundle is required");
        if(op==="set_current"&&take.status!=="approved")fail(409,"Only an approved take can become current");
        await client.query("UPDATE media_scene_takes SET status='approved' WHERE id=$1",[take.id]);
        if(op==="set_current"||!(await client.query("SELECT current_version_id FROM media_production_scenes WHERE id=$1",[take.parent_scene])).rows[0].current_version_id)
          await client.query("UPDATE media_production_scenes SET current_version_id=$2 WHERE id=$1",[take.parent_scene,take.id]);
      }
    }else if(op==="assemble"){
      const count=(await client.query(`SELECT count(*)::int total,count(*)FILTER(WHERE t.status='approved' AND t.video_asset_id IS NOT NULL)::int approved
        FROM media_production_scenes s LEFT JOIN media_scene_takes t ON t.id=s.current_version_id WHERE s.production_id=$1`,[p.id])).rows[0];
      if(count.total===0||count.approved!==count.total)fail(409,"Approve and select one complete take per scene before assembly");
      if((await client.query("SELECT id FROM media_production_jobs WHERE production_id=$1 AND stage='assemble' AND status='queued'",[p.id])).rowCount)fail(409,"Assembly already queued");
      await addMediaJob(client,p.id,"assemble",null);
    }else if(op==="publish"){
      const current=(await client.query(`SELECT s.*,t.* ,s.id production_scene_id FROM media_production_scenes s JOIN media_scene_takes t ON t.id=s.current_version_id
        WHERE s.production_id=$1 ORDER BY s.scene_number`,[p.id])).rows;
      const sceneCount=(await client.query("SELECT count(*)::int n FROM media_production_scenes WHERE production_id=$1",[p.id])).rows[0].n;
      if(!current.length||current.length!==sceneCount||current.some(t=>t.status!=="approved"))fail(409,"Every scene needs an approved current take");
      const render=(await client.query("SELECT * FROM chapter_media_renders WHERE production_id=$1 ORDER BY id DESC LIMIT 1",[p.id])).rows[0];
      if(!render||JSON.stringify(render.scene_versions)!==JSON.stringify(current.map(t=>t.id)))fail(409,"Reassemble the chapter after changing current takes");
      for(const t of current){
        const previous=(await client.query("SELECT id FROM scene_versions WHERE scene_id=$1 AND prompt_metadata->>'productionTakeId'=$2",[t.playback_scene_id,String(t.id)])).rows[0];
        let id=previous?.id;
        if(!id){
          const next=(await client.query("SELECT COALESCE(max(version_number),0)+1 n FROM scene_versions WHERE scene_id=$1",[t.playback_scene_id])).rows[0].n;
          id=(await client.query(`INSERT INTO scene_versions(scene_id,version_number,narration,image_asset,video_asset,audio_asset,caption_asset,render_status,generation_provider,generation_model,quality_score,notes,prompt_metadata,generation_cost)
            VALUES($1,$2,$3,$4,$5,$6,$7,'published',$8,$9,$10,$11,$12,NULL)RETURNING id`,
            [t.playback_scene_id,next,t.narration,assetUrl(t.image_asset_id),assetUrl(t.video_asset_id),assetUrl(t.audio_asset_id),assetUrl(t.caption_asset_id),
              "openai+ffmpeg",p.configuration.imageModel,t.quality_score,"Actual monetary generation cost is unknown unless reported by the provider.",
              JSON.stringify({productionTakeId:t.id,motion_type:t.motion_type,actual_cost:null,prompt:t.prompt,metadata:t.metadata})])).rows[0].id;
          for(const [kind,aid] of [["image",t.image_asset_id],["video",t.video_asset_id],["audio",t.audio_asset_id],["captions",t.caption_asset_id]])
            await client.query("INSERT INTO assets(scene_version_id,kind,object_path,metadata)VALUES($1,$2,$3,$4)",[id,kind,assetUrl(Number(aid)),JSON.stringify({productionAssetId:aid})]);
        }
        await client.query("UPDATE scenes SET current_version_id=$2,status='published',duration=$3 WHERE id=$1",[t.playback_scene_id,id,t.duration]);
      }
      const duration=current.reduce((n,t)=>n+Number(t.duration),0);
      await client.query("UPDATE chapters SET status='published',duration=$2 WHERE id=$1",[p.chapter_id,duration]);
      await client.query("UPDATE visual_editions SET published=true,status='published',generation_cost=NULL,published_at=now(),total_duration=$2,analysis=COALESCE(analysis,'{}'::jsonb)||$3::jsonb WHERE id=$1",
        [p.edition_id,duration,JSON.stringify({productionId:p.id,chapterRenderId:render.id,motionMode:"illustrated cinematic camera motion",scope:"one chapter"})]);
      await client.query("UPDATE media_productions SET status='published' WHERE id=$1",[p.id]);
      await client.query("UPDATE chapter_media_renders SET status='published' WHERE id=$1",[render.id]);
    }
    await client.query("INSERT INTO editorial_audit(user_id,action,target_id,details)VALUES($1,$2,$3,$4)",
      [userId,`production_${op}`,p.id,JSON.stringify(input)]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}