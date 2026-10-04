import { pool } from "@workspace/db";

export async function sceneAnalytics() {
  const {rows}=await pool.query(`SELECT s.id,s.title,s.chapter_id,s.current_version_id,
    (SELECT count(*)::int FROM view_events WHERE scene_id=s.id AND event_type='scene_started') starts,
    (SELECT count(*)::int FROM view_events WHERE scene_id=s.id AND event_type='scene_completed') completions,
    (SELECT count(*)::int FROM view_events WHERE scene_id=s.id AND event_type IN('rewind','scene_replayed')) rewinds,
    (SELECT count(*)::int FROM view_events WHERE scene_id=s.id AND event_type IN('exit','scene_skipped')) exits,
    (SELECT count(*)::int FROM feedback WHERE scene_id=s.id) feedback_count,
    (SELECT count(*)::int FROM feedback WHERE scene_id=s.id AND rating=-1) negative,
    (SELECT count(*)::int FROM feedback WHERE scene_id=s.id AND feedback_type='confusing') confusing
    FROM scenes s ORDER BY s.id`);
  return rows.map(r=>{
    const completionRate=r.starts?Math.min(100,r.completions/r.starts*100):0;
    const rewindRate=r.starts?Math.min(100,r.rewinds/r.starts*100):0;
    const negativeRate=r.feedback_count?r.negative/r.feedback_count*100:0;
    const recommended=(r.starts>=5 && completionRate<70)||(r.feedback_count>=3 && negativeRate>25);
    return {...r,completionRate,rewindRate,negativeRate,
      abandonmentRate:r.starts?Math.min(100,r.exits/r.starts*100):0,
      confusionScore:Math.round((rewindRate+negativeRate)/2),
      revisionRecommended:recommended,
      suggestion: recommended ? r.confusing?"Clarify the cause-and-effect narration and extend the scene's explanation. Create a draft for editorial review.":r.rewinds?"Slow the pacing and add context before the key story beat. Create a draft for editorial review.":"Review missing context and character continuity; use feedback comments to prepare a new version." : "Collect more viewing and feedback data before recommending changes.",
    };
  });
}