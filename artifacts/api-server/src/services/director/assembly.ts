import { pool } from "@workspace/db";
import { fail } from "../access";
import { saveTimeline, editorSource } from "../editor/timeline";
import { shotSchema, definitionSchema } from "../editor/types";
import { directorShotSchema, definitionHash } from "./types";
export async function directedDefinition(runId:number) {
  const run=(await pool.query("SELECT * FROM director_runs WHERE id=$1",[runId])).rows[0];
  if(!run)fail(404,"Director run not found");
  const source=await editorSource(run.chapter_id);
  const scenes=(await pool.query("SELECT * FROM director_scenes WHERE run_id=$1 ORDER BY scene_number",[runId])).rows;
  if(scenes.length!==source.scenes.length)fail(409,"Director is still planning all scenes");
  const definition={scenes:[] as typeof source.scenes};
  for(const scene of scenes){
    const original=source.scenes.find(s=>s.id===scene.scene_id);
    if(!original)fail(409,"Source scene changed");
    const versions=(await pool.query(`SELECT s.id shot_id,v.* FROM director_shots s JOIN director_shot_versions v ON v.id=s.current_version_id
      WHERE s.scene_plan_id=$1 ORDER BY (s.blueprint->>'shot_number')::int`,[scene.id])).rows;
    if(!versions.length||versions.some(v=>v.status!=="approved"||!v.image_asset_id))fail(409,"Approve every current shot version before first-cut assembly");
    const shots=versions.map(v=>{
      const spec=directorShotSchema.parse(v.spec);
      const video=!!v.video_asset_id;
      // Recommendations are not scene asset modes. Unsupported parallax/video stays honest camera-only motion.
      const mode=video?"AI_VIDEO":spec.motion_recommendation==="STATIC"?"STATIC":"PAN_ZOOM";
      const preset=mode==="STATIC"?"Static":["Parallax","Static"].includes(spec.camera_movement)?"Slow Push In":spec.camera_movement;
      const pull=preset==="Slow Pull Out";
      const direction=preset==="Pan Left"?"left":preset==="Pan Right"?"right":preset==="Pan Up"?"up":preset==="Pan Down"?"down":"none";
      return shotSchema.parse({id:`director-shot-${v.shot_id}-v${v.id}`,assetId:video?v.video_asset_id:v.image_asset_id,start:spec.start_time,duration:spec.duration,
        motionType:mode,preset,crop:{x:0,y:0,width:1,height:1},zoomStart:mode==="STATIC"?1:pull?1.075:1.035,zoomEnd:mode==="STATIC"?1:pull?1.035:1.075,
        panDirection:direction,transitionIn:"CUT",transitionOut:"CUT",directorShotId:v.shot_id,directorVersionId:v.id,shotType:spec.shot_type,
        composition:spec.composition,motionRecommendation:spec.motion_recommendation});
    });
    definition.scenes.push({...original!,shots});
  }
  return {run,definition:definitionSchema.parse(definition)};
}
export async function assembleDirected(runId:number,revision:number) {
  const {run,definition}=await directedDefinition(runId);
  const timeline=await saveTimeline(run.chapter_id,revision,definition);
  await pool.query("UPDATE director_runs SET status='assembled',definition=$2,directed_revision=$3 WHERE id=$1",[run.id,JSON.stringify(definition),timeline.revision]);
  return timeline;
}
export async function assertDirectorReview(definition:unknown,db:{query:typeof pool.query}) {
  const parsed=definitionSchema.parse(definition);
  const all=parsed.scenes.flatMap(s=>s.shots);
  const versions=(await db.query("SELECT id,status,image_asset_id,video_asset_id FROM director_shot_versions WHERE image_asset_id=ANY($1::int[]) OR video_asset_id=ANY($1::int[])",[all.map(s=>s.assetId)])).rows;
  const shots=all.filter(s=>s.directorVersionId||versions.some(v=>v.image_asset_id===s.assetId||v.video_asset_id===s.assetId));
  if(!shots.length)return;
  if(shots.some(s=>!versions.some(v=>(!s.directorVersionId||v.id===s.directorVersionId)&&v.status==="approved"&&(v.image_asset_id===s.assetId||v.video_asset_id===s.assetId))))fail(409,"Directed visual must match its approved asset version");
  const result=(await db.query("SELECT id FROM director_reviews WHERE definition_hash=$1 AND status='completed' LIMIT 1",[definitionHash(parsed)])).rows;
  if(!result.length)fail(409,"Run chapter visual review on this exact timeline revision before publication");
}
