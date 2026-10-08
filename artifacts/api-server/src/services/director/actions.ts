import { pool } from "@workspace/db";
import { fail } from "../access";
import { assertRights } from "../catalog";
import { timelineState } from "../editor/timeline";
import { actionSchema, pacingSchema, directorShotSchema } from "./types";
import { directorState } from "./state";
import { assembleDirected, directedDefinition } from "./assembly";
import { productionConfig } from "../production/config";
import { hasShotVideoProvider } from "./video";
import type { TimelineScene } from "../editor/types";
export async function directorAction(chapterId:number,raw:unknown) {
  const input=actionSchema.parse(raw);
  const current=await timelineState(chapterId);
  const currentScenes:TimelineScene[]=current.scenes;
  await assertRights(current.chapter.book_id);
  if(input.action==="direct"||input.action==="re_direct_scene"){
    const parent=input.action==="re_direct_scene"?(await pool.query("SELECT * FROM director_runs WHERE id=$1 AND chapter_id=$2",[input.runId,chapterId])).rows[0]:null;
    if(input.action==="re_direct_scene"&&(!parent||!currentScenes.some(s=>s.id===input.sceneId)))fail(404,"Select a scene from this director run");
    const active=(await pool.query("SELECT j.id FROM director_jobs j JOIN director_runs r ON r.id=j.run_id WHERE r.chapter_id=$1 AND j.status IN('queued','running')",[chapterId])).rows;
    if(active.length)fail(409,"Wait for active director jobs before starting a new proposal");
    const pacing=pacingSchema.parse(input.pacing??parent?.pacing??{});
    const run=(await pool.query("INSERT INTO director_runs(chapter_id,production_id,pacing,baseline) VALUES($1,$2,$3,$4) RETURNING id",[chapterId,current.chapter.production_id,JSON.stringify(pacing),JSON.stringify(parent?.baseline??{scenes:current.scenes,revision:current.revision})])).rows[0];
    await pool.query("INSERT INTO director_jobs(run_id,kind,input) VALUES($1,'plan',$2)",[run.id,JSON.stringify({sceneId:input.sceneId,parentRunId:parent?.id})]);
    return directorState(chapterId);
  }
  const run=(await pool.query("SELECT * FROM director_runs WHERE id=$1 AND chapter_id=$2",[input.runId,chapterId])).rows[0];
  if(!run)fail(404,"Director run not found");
  if(input.action==="compare")return directorState(chapterId,run.id);
  if(input.action==="assemble"){
    if(input.revision===undefined)fail(400,"Current timeline revision required");
    await assembleDirected(run.id,input.revision!);
    return directorState(chapterId);
  }
  if(input.action==="review"){
    const assembled=(await directedDefinition(run.id)).definition;
    const definition=currentScenes.some(s=>s.shots.some(sh=>sh.directorShotId))?{scenes:currentScenes}:assembled;
    if(!(await pool.query("SELECT id FROM director_jobs WHERE run_id=$1 AND kind='review' AND status IN('queued','running')",[run.id])).rowCount)
      await pool.query("INSERT INTO director_jobs(run_id,kind,input) VALUES($1,'review',$2)",[run.id,JSON.stringify({definition})]);
    return directorState(chapterId);
  }
  if(input.action==="retry"){
    const job=(await pool.query("SELECT * FROM director_jobs WHERE id=$1 AND run_id=$2 AND status IN('failed','budget_paused')",[input.jobId,run.id])).rows[0];
    if(!job)fail(409,"Only failed or budget-paused director jobs can be explicitly retried");
    if(job.lease_until&&new Date(job.lease_until).getTime()>Date.now())fail(409,"Provider requested a cooldown. Wait for its retry window before another paid attempt.");
    await pool.query("UPDATE director_jobs SET status='queued',error=NULL,lease_until=NULL WHERE id=$1",[job.id]);
    if(job.kind==="plan")await pool.query("UPDATE director_runs SET status='planning' WHERE id=$1",[run.id]);
    return directorState(chapterId);
  }
  const all=(await pool.query(`SELECT sh.*,v.id version_id,v.status version_status,v.image_asset_id,v.video_asset_id,v.spec,v.quality
    FROM director_shots sh JOIN director_scenes ds ON ds.id=sh.scene_plan_id JOIN director_shot_versions v ON v.id=sh.current_version_id
    WHERE ds.run_id=$1 ORDER BY ds.scene_number,(sh.blueprint->>'shot_number')::int`,[run.id])).rows;
  const shot=all.find(s=>s.id===input.shotId);
  if(input.action!=="generate"&&!shot)fail(404,"Shot does not belong to this proposal");
  if(shot&&input.versionId!==shot.version_id)fail(409,"Shot version changed; reload before editing");
  const enqueue=async(kind:string,s:any)=>pool.query(`INSERT INTO director_jobs(run_id,kind,shot_id,version_id)
    SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM director_jobs WHERE version_id=$4 AND kind=$2 AND status IN('queued','running')) ON CONFLICT DO NOTHING`,[run.id,kind,s.id,s.version_id]);
  if(input.action==="generate"){
    const selected=shot?[shot]:input.shotId?[]:all;
    if(!selected.length)fail(409,"Wait for the proposed shot list");
    for(const s of selected)if(!s.image_asset_id)await enqueue("image",s);
  }else if(input.action==="approve"){
    if((await pool.query("SELECT id FROM director_jobs WHERE version_id=$1 AND status IN('queued','running')",[shot.version_id])).rowCount)fail(409,"Wait for generation and its quality check before approving this version");
    const quality=shot.quality;
    const threshold=(await pool.query("SELECT configuration FROM media_productions WHERE id=$1",[run.production_id])).rows[0].configuration.qualityThreshold??80;
    if(!shot.image_asset_id||!quality?.checks||quality.score<threshold||!Object.values(quality.checks).every(Boolean))fail(409,"Shot must pass source/identity/era/artifact checks before approval");
    if(shot.video_asset_id&&currentScenes.some(s=>s.shots.some(sh=>sh.directorShotId===shot.id&&sh.duration>shot.spec.duration+.05)))fail(409,"Video cannot cover the edited shot duration; preserve compatible timing before upgrading.");
    await pool.query("UPDATE director_shot_versions SET status='approved' WHERE id=$1",[shot.version_id]);
    const pending=(await pool.query(`SELECT v.id FROM director_shots sh JOIN director_scenes ds ON ds.id=sh.scene_plan_id
      JOIN director_shot_versions v ON v.id=sh.current_version_id WHERE ds.run_id=$1 AND v.status<>'approved'`,[run.id])).rows;
    if(!pending.length&&!run.directed_revision&&run.baseline.revision===current.revision) {
      await assembleDirected(run.id,current.revision);
    } else if(currentScenes.some(s=>s.shots.some(sh=>sh.directorShotId===shot.id))) {
      const {saveTimeline}=await import("../editor/timeline");
      const prior=(await pool.query("SELECT spec FROM director_shot_versions WHERE id=(SELECT parent_version_id FROM director_shot_versions WHERE id=$1)",[shot.version_id])).rows[0]?.spec;
      const scenes=currentScenes.map(scene=>({...scene,shots:scene.shots.map(existing=>{
        if(existing.directorShotId!==shot.id)return existing;
        const changedMotion=prior&&(prior.camera_movement!==shot.spec.camera_movement||prior.motion_recommendation!==shot.spec.motion_recommendation);
        const mode=shot.video_asset_id?"AI_VIDEO":shot.spec.motion_recommendation==="STATIC"?"STATIC":existing.motionType==="AI_VIDEO"?"PAN_ZOOM":changedMotion?"PAN_ZOOM":existing.motionType;
        const preset=changedMotion?(mode==="STATIC"?"Static":["Static","Parallax"].includes(shot.spec.camera_movement)?"Slow Push In":shot.spec.camera_movement):existing.preset;
        return {...existing,id:`director-shot-${shot.id}-v${shot.version_id}`,assetId:shot.video_asset_id??shot.image_asset_id,motionType:mode,preset,
          panDirection:changedMotion?(preset==="Pan Left"?"left":preset==="Pan Right"?"right":preset==="Pan Up"?"up":preset==="Pan Down"?"down":"none"):existing.panDirection,
          directorVersionId:shot.version_id,shotType:shot.spec.shot_type,composition:shot.spec.composition,motionRecommendation:shot.spec.motion_recommendation};
      })}));
      const next=await saveTimeline(chapterId,current.revision,{scenes});
      await pool.query("UPDATE director_runs SET definition=$2,directed_revision=$3 WHERE id=$1",[run.id,JSON.stringify({scenes}),next.revision]);
    }
  }else if(input.action==="edit"||input.action==="regenerate"){
    if((await pool.query("SELECT id FROM director_jobs WHERE version_id=$1 AND status IN('queued','running')",[shot.version_id])).rowCount)fail(409,"Wait for this shot's generation job");
    const spec=directorShotSchema.parse({...shot.spec,...(input.changes??{})});
    const imageChange=input.action==="regenerate"||Object.keys(input.changes??{}).some(k=>["shot_type","composition","camera_angle","camera_distance"].includes(k));
    const version=(await pool.query("INSERT INTO director_shot_versions(shot_id,spec,status,image_asset_id,quality,parent_version_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [shot.id,JSON.stringify(spec),imageChange?"proposed":"review",imageChange?null:shot.image_asset_id,JSON.stringify(imageChange?{}:shot.quality),shot.version_id])).rows[0];
    const updated=await pool.query("UPDATE director_shots SET blueprint=$2,current_version_id=$3 WHERE id=$1 AND current_version_id=$4 RETURNING id",[shot.id,JSON.stringify(spec),version.id,shot.version_id]);
    if(!updated.rowCount)fail(409,"Another editor changed this shot; the prior version is retained");
    if(input.action==="regenerate")await enqueue("image",{id:shot.id,version_id:version.id});
  }else if(input.action==="upgrade_video"){
    const config=await productionConfig();
    if(!hasShotVideoProvider(config.aiVideoProvider))fail(409,"Connect an image-to-video provider adapter first; camera-motion playback remains available");
    const limits=(await pool.query("SELECT configuration FROM media_productions WHERE id=$1",[run.production_id])).rows[0].configuration;
    if((limits.jobMaxSpend??2)<config.aiVideoReservation+(limits.qualityReservation??.05))fail(409,"Video plus its required quality check exceeds the configured per-job cap; adjust that cap before upgrading.");
    if(shot.version_status!=="approved"||!shot.image_asset_id)fail(409,"Upgrade an approved shot image");
    const version=(await pool.query("INSERT INTO director_shot_versions(shot_id,spec,status,image_asset_id,quality,parent_version_id) VALUES($1,$2,'review',$3,$4,$5) RETURNING id",
      [shot.id,JSON.stringify(shot.spec),shot.image_asset_id,JSON.stringify({}),shot.version_id])).rows[0];
    const updated=await pool.query("UPDATE director_shots SET current_version_id=$2 WHERE id=$1 AND current_version_id=$3 RETURNING id",[shot.id,version.id,shot.version_id]);
    if(!updated.rowCount)fail(409,"Another editor changed this shot before upgrade");
    await enqueue("video",{id:shot.id,version_id:version.id});
  }
  return directorState(chapterId,run.id);
}
