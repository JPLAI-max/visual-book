import { pool } from "@workspace/db";
import { logger } from "../../lib/logger";
import { assertRights } from "../catalog";
import { mediaProviders, evaluateImage } from "./adapters";
import { paidCall, productionConfig, type ProductionConfig } from "./config";
import { readAsset, saveAsset } from "./assets";
import { audioDuration, assembleVideos,videoMime } from "./render";
type Job={id:number;production_id:number;stage:string;target_id:number|null;attempts:number};
let working=false;
export function startProductionEngine() {
  const timer=setInterval(()=>void tickProduction().catch(e=>logger.error({message:String(e)},"Production scheduler failed")),1500);
  timer.unref();
}
async function checkImage(productionId:number,bytes:Buffer,brief:unknown,references:Buffer[],target:{takeId?:number;referenceId?:number},config:ProductionConfig) {
  const model=config.qualityModel??"gpt-5.4-mini";
  const {value,requestId}=await paidCall(productionId,"quality","openai",model,config.qualityReservation,target,()=>evaluateImage(bytes,brief,references,model));
  await pool.query("UPDATE media_production_requests SET metadata=metadata||$2::jsonb WHERE id=$1",[requestId,JSON.stringify({usage:value.usage,quality:value.quality})]);
  return value.quality;
}
async function runJob(job:Job) {
  const p=(await pool.query("SELECT * FROM media_productions WHERE id=$1",[job.production_id])).rows[0];
  await assertRights(p.book_id);
  const config=p.configuration as ProductionConfig & {visualBible:unknown;narrationBible:unknown;chapterTitle:string};
  if(job.stage==="reference"){
    const ref=(await pool.query("SELECT * FROM media_references WHERE id=$1 AND production_id=$2",[job.target_id,p.id])).rows[0];
    const prompt=`Canonical ${ref.kind} reference for ${ref.name}. Premium cinematic illustrated-book documentary, restrained painterly realism, no lettering, no collage, no watermark.
      Establish a reusable visual identity. ${ref.kind.startsWith("character")?"A clear full-length or three-quarter character study, neutral pose, authentic modest era clothing, face clearly readable. No simulated motion.":"A wide environment establishing view with readable spatial structure, authentic era details."}
      Canonical source evidence and explicitly proposed production choices: ${JSON.stringify(ref.data)}
      Edition Visual Style Bible: ${JSON.stringify(config.visualBible)}
      For childhood life stages keep all subjects fully clothed, visibly young, and nonsexual; do not use adult facial anatomy.
      This is a production-design illustration, not a claim that unspecified appearance is historical fact.`;
    let aid=ref.current_asset_id;
    if(!aid){
      const generated=await paidCall(p.id,"reference_image",config.imageProvider,config.imageModel,config.imageReservation,{referenceId:ref.id},
        ()=>mediaProviders.image(config.imageProvider).generateImage({prompt,references:[],model:config.imageModel}));
      const asset=await saveAsset({productionId:p.id,referenceId:ref.id,kind:"reference_image",bytes:generated.value.bytes,mime:"image/png",provider:config.imageProvider,model:config.imageModel,
        metadata:{prompt,negative_prompt:null,seed:null,requestId:generated.requestId,usage:generated.value.usage,life_stage:ref.data.life_stage}});
      aid=asset.id;
      await pool.query("UPDATE media_references SET current_asset_id=$2,status='evaluating' WHERE id=$1",[ref.id,aid]);
    }
    const quality=await checkImage(p.id,await readAsset(aid),{reference:ref.data,style:config.visualBible},[],{referenceId:ref.id},config);
    await pool.query("UPDATE media_references SET quality_score=$2,status='review',data=data||$3::jsonb WHERE id=$1",[ref.id,quality.score,JSON.stringify({quality})]);
    return {assetId:aid,quality};
  }
  if(job.stage==="assemble"){
    const current=(await pool.query(`SELECT t.* FROM media_production_scenes s JOIN media_scene_takes t ON t.id=s.current_version_id WHERE s.production_id=$1 ORDER BY s.scene_number`,[p.id])).rows;
    const count=(await pool.query("SELECT count(*)::int n FROM media_production_scenes WHERE production_id=$1",[p.id])).rows[0].n;
    if(current.length!==count||current.some(t=>t.status!=="approved"))throw new Error("Current scene selections changed or are not approved");
    const bytes=await assembleVideos(await Promise.all(current.map(t=>readAsset(t.video_asset_id))));
    const asset=await saveAsset({productionId:p.id,kind:"chapter_render",bytes,mime:videoMime(bytes),provider:"ffmpeg",model:"chapter-concat-v1",
      metadata:{sceneVersions:current.map(t=>t.id),individualAssetsPreserved:true}});
    const duration=current.reduce((n,t)=>n+Number(t.duration),0);
    const render=(await pool.query("INSERT INTO chapter_media_renders(production_id,asset_id,scene_versions,duration)VALUES($1,$2,$3,$4)RETURNING id",
      [p.id,asset.id,JSON.stringify(current.map(t=>t.id)),duration])).rows[0];
    await pool.query("UPDATE media_productions SET status='assembled' WHERE id=$1",[p.id]);
    return {renderId:render.id,assetId:asset.id,duration};
  }
  const take=(await pool.query(`SELECT t.*,s.data,s.scene_number FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id
    WHERE t.id=$1 AND s.production_id=$2`,[job.target_id,p.id])).rows[0];
  if(!take)throw new Error("Scene take target not found");
  const refs=(await pool.query("SELECT * FROM media_references WHERE production_id=$1 AND status='approved' ORDER BY id",[p.id])).rows;
  if(job.stage==="image"){
    const childhood=config.chapterTitle==="Chapter 1"&&take.scene_number>=3;
    const relevant=refs.filter(r=>r.kind==="environment"?r.canonical_id===take.data.environment_id:
      take.data.characters_present.includes(r.canonical_id) &&
      (r.kind==="character_child"?childhood:!(childhood&&refs.some(c=>c.kind==="character_child"&&c.canonical_id===r.canonical_id))));
    if(!relevant.length)throw new Error("No approved scene references");
    const buffers=await Promise.all(relevant.map(r=>readAsset(r.current_asset_id)));
    const prompt=take.prompt||`Create one coherent widescreen cinematic illustrated scene, no panels, no lettering, no captions, no watermark.
      Use the attached canonical reference images as identity and location sources of truth. Preserve faces, hair, body build and era. Adjust clothing only as the source-described life stage and poverty/wealth require.
      Visual Style Bible: ${JSON.stringify(config.visualBible)}
      Scene ${take.scene_number}: ${JSON.stringify(take.data)}
      Reference image order: ${JSON.stringify(relevant.map(r=>({name:r.name,kind:r.kind,life_stage:r.data.life_stage})))}
      Characters_present is allowable casting, not a requirement to crowd every referenced person into the shot. A narrator may remain off-screen.
      ${childhood?"This memory depicts childhood: Victor and Elizabeth must look like young fully clothed children, not the adult characters.":""}
      Story action must be source-faithful. Show one representative moment rather than cramming sequential actions into a collage.
      No modern objects, anachronistic clothes, distorted hands, duplicate people, or invented supernatural effects.`;
    const finalPrompt=prompt+(take.negative_prompt?`\nAvoid: ${take.negative_prompt}`:"");
    let aid=take.image_asset_id;
    if(!aid){
      const generated=await paidCall(p.id,"scene_image",config.imageProvider,config.imageModel,config.imageReservation,{takeId:take.id},
        ()=>mediaProviders.image(config.imageProvider).editImage({prompt:finalPrompt,references:buffers,model:config.imageModel}));
      const asset=await saveAsset({productionId:p.id,takeId:take.id,kind:"scene_image",bytes:generated.value.bytes,mime:"image/png",provider:config.imageProvider,model:config.imageModel,
        metadata:{prompt:finalPrompt,negative_prompt:take.negative_prompt||null,nativeNegativePromptSupported:false,seed:null,reference_assets:relevant.map(r=>r.current_asset_id),
          requestId:generated.requestId,usage:generated.value.usage}});
      aid=asset.id;
      await pool.query("UPDATE media_scene_takes SET image_asset_id=$2,prompt=$3,metadata=metadata||$4::jsonb WHERE id=$1",
        [take.id,aid,prompt,JSON.stringify({referenceAssets:relevant.map(r=>r.current_asset_id),requiresGeneration:false})]);
    }
    const quality=await checkImage(p.id,await readAsset(aid),{scene:take.data,childhood,references:relevant.map(r=>r.data),style:config.visualBible},buffers,{takeId:take.id},config);
    const passed=quality.score>=config.qualityThreshold&&Object.values(quality.checks).every(Boolean);
    await pool.query("UPDATE media_scene_takes SET quality_score=$2,quality=$3,image_approved=$4 WHERE id=$1",[take.id,quality.score,JSON.stringify(quality),passed]);
    return {assetId:aid,quality,imageApproved:passed};
  }
  if(job.stage==="voice"){
    let aid=take.audio_asset_id;
    if(!aid){
      const generated=await paidCall(p.id,"voice",config.voiceProvider,config.voiceModel,config.voiceReservation,{takeId:take.id},
        ()=>mediaProviders.voice(config.voiceProvider).generateVoice({text:take.narration,bible:config.narrationBible,voiceId:config.voiceId,model:config.voiceModel}));
      const asset=await saveAsset({productionId:p.id,takeId:take.id,kind:"voice",bytes:generated.value.bytes,mime:"audio/wav",provider:config.voiceProvider,model:config.voiceModel,
        metadata:{voice_id:config.voiceId,approvedNarration:take.narration,transcript:generated.value.transcript,usage:generated.value.usage,requestId:generated.requestId}});
      aid=asset.id;await pool.query("UPDATE media_scene_takes SET audio_asset_id=$2 WHERE id=$1",[take.id,aid]);
    }
    const bytes=await readAsset(aid);const duration=await audioDuration(bytes);
    const captions=await mediaProviders.captions().generateCaptions({text:take.narration,duration,audio:bytes});
    const caption=await saveAsset({productionId:p.id,takeId:take.id,kind:"captions",bytes:captions.bytes,mime:"text/vtt",provider:"local",model:"speech-pause-caption-v1",metadata:{method:captions.method,duration}});
    await pool.query("UPDATE media_scene_takes SET caption_asset_id=$2,duration=$3 WHERE id=$1",[take.id,caption.id,duration]);
    return {assetId:aid,captionId:caption.id,duration};
  }
  if(job.stage==="motion"){
    if(!take.image_approved||!take.image_asset_id||!take.audio_asset_id||!take.caption_asset_id)throw new Error("Approve the scene image and complete narration before motion");
    const images=[await readAsset(take.image_asset_id)];
    const establishing=refs.find(r=>r.kind==="environment"&&r.canonical_id===take.data.environment_id);
    if(establishing)images.push(await readAsset(establishing.current_asset_id));
    const input={
      images,audio:await readAsset(take.audio_asset_id),duration:take.duration,motionType:take.motion_type,resolution:config.resolution,
      motionPrompt:take.data.camera_direction,foreground:take.metadata.foregroundAssetId?await readAsset(take.metadata.foregroundAssetId):undefined};
    const ai=take.motion_type==="AI_VIDEO";const runtime=await productionConfig();
    const provider=ai?runtime.aiVideoProvider:config.motionProvider;
    const generated=ai?(await paidCall(p.id,"ai_video",provider,"connected-adapter",runtime.aiVideoReservation,{takeId:take.id},
      ()=>mediaProviders.video(provider).generateVideo(input))).value:await mediaProviders.video(provider).generateVideo(input);
    const asset=await saveAsset({productionId:p.id,takeId:take.id,kind:"motion",bytes:generated.bytes,mime:videoMime(generated.bytes),provider,model:ai?"connected-adapter":"restrained-camera-webm-v1",
      metadata:{source_image:take.image_asset_id,establishing_image:establishing?.current_asset_id??null,motion_type:take.motion_type,
        motion_prompt:take.data.camera_direction,duration:take.duration,shots:generated.shots,narrationSpeedUnchanged:true,quality_score:take.quality_score}});
    await pool.query("UPDATE media_scene_takes SET video_asset_id=$2,status='review',metadata=metadata||$3::jsonb WHERE id=$1",
      [take.id,asset.id,JSON.stringify({shots:generated.shots,motionProvider:provider,motionModel:ai?"connected-adapter":"restrained-camera-webm-v1"})]);
    return {assetId:asset.id,duration:take.duration};
  }
  throw new Error("Unknown production stage");
}
export async function tickProduction() {
  if(working)return;working=true;
  try{
    // Interrupted paid jobs are not automatically reissued: billing may already have happened.
    await pool.query(`UPDATE media_production_jobs SET status='failed',error='Worker lease expired. Review retained assets and billing before explicitly retrying.'
      WHERE status='running' AND lease_until<now()`);
    const job=(await pool.query(`WITH ready AS(
      SELECT j.id FROM media_production_jobs j JOIN media_productions p ON p.id=j.production_id
      LEFT JOIN media_scene_takes t ON t.id=j.target_id
      WHERE j.status='queued' AND p.status NOT IN('failed','budget_paused')
      AND(j.retry_at IS NULL OR j.retry_at<=now())
      AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(j.dependencies) dep JOIN media_production_jobs d ON d.id=dep::int WHERE d.status<>'completed')
      AND(j.stage='reference' OR NOT EXISTS(SELECT 1 FROM media_references r WHERE r.production_id=p.id AND r.status<>'approved'))
      AND(j.stage<>'motion' OR t.image_approved=true)
      ORDER BY j.id FOR UPDATE OF j SKIP LOCKED LIMIT 1)
      UPDATE media_production_jobs SET status='running',attempts=attempts+1,lease_until=now()+interval '10 minutes'
      WHERE id IN(SELECT id FROM ready) RETURNING *`)).rows[0] as Job|undefined;
    if(!job)return;
    try {
      const result=await runJob(job);
      await pool.query("UPDATE media_production_jobs SET status='completed',result=$2,error=NULL,lease_until=NULL WHERE id=$1",[job.id,JSON.stringify(result)]);
      if(job.stage!=="assemble"){
        const refs=(await pool.query("SELECT id FROM media_references WHERE production_id=$1 AND status<>'approved'",[job.production_id])).rowCount;
        const pending=(await pool.query("SELECT id FROM media_production_jobs WHERE production_id=$1 AND status IN('queued','running')",[job.production_id])).rowCount;
        await pool.query("UPDATE media_productions SET status=$2 WHERE id=$1",[job.production_id,refs?"references":pending?"generating":"review"]);
      }
      logger.info({jobId:job.id,stage:job.stage},"Production stage completed");
    }catch(e){
      const config=(await pool.query("SELECT configuration FROM media_productions WHERE id=$1",[job.production_id])).rows[0].configuration;
      const error=e as Error&{status?:number;stopAutomaticRetries?:boolean};const budget=error.status===402;const last=job.attempts>config.maxRetries||error.stopAutomaticRetries;
      const status=budget?"budget_paused":last?"failed":"queued";
      await pool.query("UPDATE media_production_jobs SET status=$2,error=$3,lease_until=NULL,retry_at=now()+interval '60 seconds' WHERE id=$1",
        [job.id,status,error.message.slice(0,800)]);
      if(error.status===429)await pool.query("UPDATE media_production_jobs SET retry_at=GREATEST(COALESCE(retry_at,now()),now()+interval '60 seconds') WHERE status='queued' AND stage IN('reference','image','voice')");
      if(budget||last)await pool.query("UPDATE media_productions SET status=$2 WHERE id=$1",[job.production_id,budget?"budget_paused":"failed"]);
      logger.warn({jobId:job.id,stage:job.stage,status,error:error.message},"Production stage stopped or deferred");
    }
  }finally{working=false;}
}