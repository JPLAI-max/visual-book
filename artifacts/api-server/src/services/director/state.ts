import { pool } from "@workspace/db";
import { assetUrl } from "../production/assets";
import { editorSource } from "../editor/timeline";
import { productionConfig } from "../production/config";
import { hasShotVideoProvider } from "./video";
export async function directorState(chapterId:number,selectedRunId?:number) {
  const source=await editorSource(chapterId);
  const runs=(await pool.query("SELECT * FROM director_runs WHERE chapter_id=$1 ORDER BY id DESC LIMIT 20",[chapterId])).rows;
  for(const run of runs){
    run.scenes=(await pool.query("SELECT * FROM director_scenes WHERE run_id=$1 ORDER BY scene_number",[run.id])).rows;
    for(const scene of run.scenes){
      scene.shots=(await pool.query("SELECT * FROM director_shots WHERE scene_plan_id=$1 ORDER BY (blueprint->>'shot_number')::int",[scene.id])).rows;
      for(const shot of scene.shots){
        shot.versions=(await pool.query("SELECT * FROM director_shot_versions WHERE shot_id=$1 ORDER BY id DESC",[shot.id])).rows
          .map(v=>({...v,image_url:assetUrl(v.image_asset_id),video_url:assetUrl(v.video_asset_id)}));
        for(const version of shot.versions) {
          const cost=(await pool.query("SELECT count(*)::int n,count(actual_cost)::int known,COALESCE(sum(estimated_cost),0)::float estimate,sum(actual_cost)::float actual FROM media_production_requests WHERE metadata->>'versionId'=$1",[String(version.id)])).rows[0];
          version.estimatedCost=cost.estimate;
          version.actualCost=cost.n===0?0:cost.n===cost.known?cost.actual:null;
        }
      }
    }
  }
  const jobs=(await pool.query("SELECT j.* FROM director_jobs j JOIN director_runs r ON r.id=j.run_id WHERE r.chapter_id=$1 ORDER BY j.id DESC LIMIT 100",[chapterId])).rows;
  const reviews=(await pool.query("SELECT q.* FROM director_reviews q JOIN director_runs r ON r.id=q.run_id WHERE r.chapter_id=$1 ORDER BY q.id DESC LIMIT 30",[chapterId])).rows;
  const p=(await pool.query("SELECT * FROM media_productions WHERE id=$1",[source.chapter.production_id])).rows[0];
  const billing=(await pool.query("SELECT count(*)::int n,count(actual_cost)::int known,sum(actual_cost)::float actual FROM media_production_requests WHERE production_id=$1",[p.id])).rows[0];
  const imageCount=(await pool.query("SELECT count(*)::int n FROM media_production_assets WHERE production_id=$1 AND mime_type LIKE 'image/%' AND provider NOT IN('local','ffmpeg')",[p.id])).rows[0].n;
  const videoCount=(await pool.query(`SELECT count(*)::int n FROM director_shots s JOIN director_scenes sc ON sc.id=s.scene_plan_id
    JOIN director_runs r ON r.id=sc.run_id JOIN director_shot_versions v ON v.id=s.current_version_id WHERE r.id=$1 AND v.status='approved' AND v.video_asset_id IS NOT NULL`,[runs[0]?.id??0])).rows[0].n;
  const config=await productionConfig();
  const extras=(await pool.query(`SELECT DISTINCT a.* FROM media_production_assets a JOIN director_shot_versions v ON a.id=v.image_asset_id OR a.id=v.video_asset_id
    JOIN director_shots sh ON sh.id=v.shot_id JOIN director_scenes s ON s.id=sh.scene_plan_id JOIN director_runs r ON r.id=s.run_id WHERE r.chapter_id=$1`,[chapterId])).rows;
  const assets=[...source.assets,...extras.filter(a=>!source.assets.some(s=>s.id===a.id)).map(a=>({id:a.id,kind:a.mime_type.startsWith("image/")?"image":"video",url:assetUrl(a.id),mime:a.mime_type,name:`Directed shot asset ${a.id}`,foregroundApproved:false}))];
  const latest=runs.find(r=>r.id===selectedRunId)??runs[0];
  return {chapter:source.chapter,runs,jobs,reviews,assets,
    cost:{maxSpend:p.max_spend,reservedSpend:p.reserved_spend,actualCost:billing.n>0&&billing.known===billing.n?billing.actual:null,
      actualCostComplete:billing.n>0&&billing.known===billing.n,imageCount,videoShotCount:videoCount,estimatedVideoUpgradeCost:config.aiVideoReservation+(p.configuration.qualityReservation??.05),notice:config.estimateNotice},
    video:{available:hasShotVideoProvider(config.aiVideoProvider),provider:config.aiVideoProvider,reservation:config.aiVideoReservation+(p.configuration.qualityReservation??.05)},
    comparison:{current:latest?.baseline??{scenes:source.scenes},directed:latest?.definition?.scenes?latest.definition:null}};
}
