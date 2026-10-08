import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { assertRights } from "../catalog";
import { readAsset, saveAsset } from "../production/assets";
import { mediaProviders, evaluateImage } from "../production/adapters";
import { productionConfig } from "../production/config";
import { directorContext } from "./context";
import { directorShotSchema } from "./types";
import { directorPaid } from "./paid";
import { planChapter } from "./planner";
import { reviewChapter } from "./review";
import { shotVideoProvider } from "./video";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
const exec=promisify(execFile);
async function processJob(job:any) {
  const run=(await pool.query("SELECT * FROM director_runs WHERE id=$1",[job.run_id])).rows[0];
  const production=(await pool.query("SELECT * FROM media_productions WHERE id=$1",[run.production_id])).rows[0];
  await assertRights(production.book_id);
  if(job.kind==="plan")return planChapter(job,run);
  if(job.kind==="review")return reviewChapter(job,run);
  const version=(await pool.query(`SELECT v.*,s.current_version_id,ds.scene_id,ds.continuity FROM director_shot_versions v
    JOIN director_shots s ON s.id=v.shot_id JOIN director_scenes ds ON ds.id=s.scene_plan_id WHERE v.id=$1 AND ds.run_id=$2`,[job.version_id,run.id])).rows[0];
  if(!version||version.current_version_id!==version.id)throw new Error("Shot version changed before generation");
  const context=await directorContext(run.chapter_id);
  const scene=context.scenes.find(s=>s.playback_scene_id===version.scene_id)!;
  const spec=directorShotSchema.parse(version.spec);
  const refs=scene.references.filter(r=>spec.reference_ids.includes(r.id));
  if(refs.length!==spec.reference_ids.length)throw new Error("Approved shot references changed");
  const buffers=await Promise.all(refs.map(r=>readAsset(r.current_asset_id)));
  const config=production.configuration;
  const prompt=`Generate ONE independent intentional ${spec.shot_type} cinematic illustrated-book shot, not a scene collage, contact sheet, panels, captions, lettering, or watermark. Protect central widescreen 16:9 safe area.
    Approved identity/location references in order: ${JSON.stringify(refs.map(r=>({reference_id:r.id,name:r.name,kind:r.kind,life_stage:r.data.life_stage})))}
    Shot: ${JSON.stringify(spec)}
    Scene narration (not all characters need appear): ${scene.narration}
    MUST inherit scene continuity: ${JSON.stringify(version.continuity)}
    Approved reference bibles: ${JSON.stringify(refs.map(r=>r.data))}
    Visual style: ${JSON.stringify(config.visualBible)}
    Latest structured shot_type, composition, camera_angle and camera_distance OVERRIDE any conflicting older generation_prompt text. Do not override the explicit shot composition with a default group portrait. ${spec.composition}
    Keep child characters young/fully clothed; never mix adult references into childhood. No added later-chapter events or modern props. Environment is source-approved. Wardrobe must remain consistent except documented story transitions. The prompt describes a still representative moment; never fake character animation.`;
  let imageId=version.image_asset_id as number|null;
  if(job.kind==="image"){
    if(!imageId){
      const generated=await directorPaid(job.id,"director_shot_image",config.imageProvider,config.imageModel,config.imageReservation,
        ()=>mediaProviders.image(config.imageProvider).editImage({prompt,references:buffers,model:config.imageModel}));
      const asset=await saveAsset({productionId:production.id,kind:"director_shot_image",bytes:generated.bytes,mime:"image/png",provider:config.imageProvider,model:config.imageModel,
        metadata:{directorJobId:job.id,runId:run.id,shotId:job.shot_id,versionId:version.id,prompt,referenceAssets:refs.map(r=>r.current_asset_id),usage:generated.usage,continuity:version.continuity}});
      imageId=asset.id;
      await pool.query("UPDATE director_shot_versions SET image_asset_id=$2 WHERE id=$1",[version.id,imageId]);
    }
    const assessed=await directorPaid(job.id,"director_shot_quality","openai",config.qualityModel??"gpt-5.4-mini",config.qualityReservation,
      async()=>evaluateImage(await readAsset(imageId!),{
        review_scope:"This is ONE finished directed shot, not the entire scene. Assess only the depicted shot subject/composition and visible elements. The scene and continuity inventory are context, NOT a list of objects/characters that must all appear in every frame. Offscreen people, cropped props, and invisible inventory are valid. A symbolic detail shot need not show faces. Source accuracy concerns actual source claims (identity, age, location, era, events), not the absence of an unspecified production-choice letter or mourning token in an earlier shot. Genuine wrong visible anatomy, wrong identity/age/geography, missing required focal objects, or invented plot events still fail.",
        shot:spec,source_narration_beat:spec.narration_beat,
        continuity_inventory_context:version.continuity,approved_reference_bibles:refs.map(r=>r.data),style:config.visualBible,
      },buffers,config.qualityModel??"gpt-5.4-mini"));
    await pool.query("UPDATE director_shot_versions SET status='review',quality=$2 WHERE id=$1",[version.id,JSON.stringify(assessed.quality)]);
    return {imageAssetId:imageId,quality:assessed.quality};
  }
  if(job.kind==="video"){
    if(!imageId)throw new Error("Approved image required for video upgrade");
    const runtime=await productionConfig();
    let videoId=version.video_asset_id;
    if(!videoId){
      const generated=await directorPaid(job.id,"director_shot_video",runtime.aiVideoProvider,"image-to-video-adapter",runtime.aiVideoReservation,
        async()=>shotVideoProvider(runtime.aiVideoProvider).generateVideoFromImage({image:await readAsset(imageId!),duration:spec.duration,motion:spec.camera_movement,action:spec.action,prompt:spec.generation_prompt,resolution:config.resolution}));
      const asset=await saveAsset({productionId:production.id,kind:"director_shot_video",bytes:generated.bytes,mime:generated.mime,provider:runtime.aiVideoProvider,model:"image-to-video-adapter",
        metadata:{shotId:job.shot_id,versionId:version.id,sourceImageId:imageId,duration:spec.duration,usage:generated.usage}});
      videoId=asset.id;await pool.query("UPDATE director_shot_versions SET video_asset_id=$2 WHERE id=$1",[version.id,videoId]);
    }
    const dir=await mkdtemp(join(tmpdir(),"folio-video-check-"));
    try{
      const path=join(dir,"clip");await writeFile(path,await readAsset(videoId));
      const probe=JSON.parse((await exec("ffprobe",["-v","error","-show_entries","format=duration","-of","json",path])).stdout);
      if(Number(probe.format.duration)+.05<spec.duration)throw new Error("Video is shorter than fixed shot timing; do not stretch/loop or alter narration");
      const frame=join(dir,"frame.png");await exec("ffmpeg",["-y","-v","error","-ss",String(spec.duration/2),"-i",path,"-frames:v","1",frame]);
      const quality=await directorPaid(job.id,"director_video_quality","openai",config.qualityModel??"gpt-5.4-mini",config.qualityReservation,
        async()=>evaluateImage(await readFile(frame),{shot:spec,continuity:version.continuity},buffers,config.qualityModel??"gpt-5.4-mini"));
      await pool.query("UPDATE director_shot_versions SET status='review',quality=$2 WHERE id=$1",[version.id,JSON.stringify(quality.quality)]);
      return {videoAssetId:videoId,quality:quality.quality};
    }finally{await rm(dir,{recursive:true,force:true});}
  }
  throw new Error("Unknown visual director job");
}
const working=new Set<number>();
let claiming=false;
export async function tickDirector() {
  // Reference-heavy image edits share a provider token bucket; serialize to avoid a charged burst of failed reservations.
  if(working.size>=1||claiming)return;
  claiming=true;
  let job:any;
  try {
    if((await pool.query("SELECT id FROM director_jobs WHERE status='failed' AND error LIKE '429%' AND lease_until>now() LIMIT 1")).rowCount)return;
  await pool.query("UPDATE director_jobs SET status='failed',error='Interrupted paid job. Review saved assets and billing before explicit retry.' WHERE status='running' AND lease_until<now()");
  job=(await pool.query(`UPDATE director_jobs SET status='running',lease_until=now()+interval '10 minutes' WHERE id=(
    SELECT id FROM director_jobs WHERE status='queued' ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`)).rows[0];
  }finally{claiming=false;}
  if(!job)return;
  working.add(job.id);
  const heartbeat=setInterval(()=>void pool.query("UPDATE director_jobs SET lease_until=now()+interval '10 minutes' WHERE id=$1 AND status='running'",[job.id]).catch(e=>logger.error({message:String(e)},"Director lease failed")),30000);
  heartbeat.unref();
  try{
    const result=await processJob(job);
    await pool.query("UPDATE director_jobs SET status='completed',result=$2,error=NULL,lease_until=NULL WHERE id=$1",[job.id,JSON.stringify(result)]);
    logger.info({directorJobId:job.id,kind:job.kind},"Visual director job completed");
  }catch(error){
    const status=(error as {status?:number}).status===402?"budget_paused":"failed";
    const limited=(error as {status?:number}).status===429;
    const headers=(error as {headers?:Headers}).headers;
    const seconds=limited?Math.max(15,Math.min(300,Number(headers?.get?.("retry-after"))||60)):0;
    await pool.query("UPDATE director_jobs SET status=$2,error=$3,lease_until=CASE WHEN $4::int>0 THEN now()+$4::int*interval '1 second' ELSE NULL END WHERE id=$1",[job.id,status,String((error as Error).message).slice(0,1000),seconds]);
    if(job.kind==="plan")await pool.query("UPDATE director_runs SET status='failed' WHERE id=$1",[job.run_id]);
    logger.warn({directorJobId:job.id,error:String(error)},"Visual director job requires review");
  }finally{clearInterval(heartbeat);working.delete(job.id);}
}
export function startDirectorEngine(){const timer=setInterval(()=>void tickDirector().catch(e=>logger.error({message:String(e)},"Director worker failed")),2000);timer.unref();void tickDirector();}
