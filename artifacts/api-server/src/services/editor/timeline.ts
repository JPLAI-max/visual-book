import { pool } from "@workspace/db";
import { fail } from "../access";
import { assetUrl } from "../production/assets";
import { definitionSchema, validateTimeline, type Asset, type TimelineScene } from "./types";

export async function editorSource(chapterId: number) {
  const chapter = (await pool.query(`SELECT c.*,b.title book_title,e.book_id,p.id production_id
    FROM chapters c JOIN visual_editions e ON e.id=c.visual_edition_id JOIN books b ON b.id=e.book_id
    JOIN media_productions p ON p.chapter_id=c.id WHERE c.id=$1`, [chapterId])).rows[0];
  if (!chapter) fail(404, "This chapter has no generated production to edit.");
  const takes = (await pool.query(`SELECT s.playback_scene_id,s.data,s.scene_number,t.* FROM media_production_scenes s
    JOIN media_scene_takes t ON t.id=s.current_version_id WHERE s.production_id=$1 ORDER BY s.scene_number`, [chapter.production_id])).rows;
  if (!takes.length || takes.some(t => t.status !== "approved" || !t.audio_asset_id || !t.caption_asset_id)) fail(409, "Approve all scene takes and narration before assembling a timeline.");
  const refs = (await pool.query("SELECT * FROM media_references WHERE production_id=$1 AND status='approved'", [chapter.production_id])).rows;
  const assetRows = (await pool.query(`SELECT DISTINCT a.* FROM media_production_assets a WHERE a.id IN (
    SELECT t.image_asset_id FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id WHERE s.production_id=$1 AND t.image_approved
    UNION SELECT t.video_asset_id FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id WHERE s.production_id=$1 AND t.status='approved' AND t.motion_type='AI_VIDEO'
    UNION SELECT t.audio_asset_id FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id WHERE s.production_id=$1 AND t.status='approved'
    UNION SELECT t.caption_asset_id FROM media_scene_takes t JOIN media_production_scenes s ON s.id=t.scene_id WHERE s.production_id=$1 AND t.status='approved'
    UNION SELECT current_asset_id FROM media_references WHERE production_id=$1 AND status='approved')`, [chapter.production_id])).rows;
  const assets: Asset[] = assetRows.map(a => ({
    id: a.id, kind: a.mime_type.startsWith("image/") ? "image" : a.mime_type.startsWith("audio/") ? "audio" : a.mime_type === "text/vtt" ? "captions" : "video", mime: a.mime_type,
    url: assetUrl(a.id), name: refs.find(r => r.current_asset_id === a.id)?.name ??
      `${a.mime_type.startsWith("audio/") ? "Narration" : a.mime_type === "text/vtt" ? "Captions" : "Approved visual"} ${a.id}`,
    foregroundApproved: a.mime_type === "image/png" && a.metadata?.approvedForeground === true,
  }));
  const scenes: TimelineScene[] = takes.map(t => {
    const environment = refs.find(r => r.kind === "environment" && r.canonical_id === t.data.environment_id);
    const existing = t.metadata?.shots as { duration: number; sourceImageIndex: number; camera: string }[] | undefined;
    const cameraShots = existing?.length ? existing : [{ duration: Number(t.duration), sourceImageIndex: 0, camera: "slow push-in" }];
    let start = 0;
    const shots = cameraShots.map((shot, index) => {
      const duration = index === cameraShots.length - 1 ? Number(t.duration) - start : Number(shot.duration);
      const pull = /pull/i.test(shot.camera);
      const value = {
        id: `take-${t.id}-shot-${index + 1}`, assetId: shot.sourceImageIndex === 1 && environment ? environment.current_asset_id : t.image_asset_id,
        start, duration, motionType: "PAN_ZOOM" as const, preset: pull ? "Slow Pull Out" as const : "Slow Push In" as const,
        crop: { x: 0, y: 0, width: 1, height: 1 }, zoomStart: pull ? 1.075 : 1.025, zoomEnd: pull ? 1.025 : 1.075,
        panDirection: "none" as const, transitionIn: "CUT" as const, transitionOut: "CUT" as const,
      };
      start += duration;
      return value;
    });
    return { id: t.playback_scene_id, title: t.data.scene_title, narration: t.narration, duration: Number(t.duration),
      audioAssetId: t.audio_asset_id, captionAssetId: t.caption_asset_id, shots };
  });
  return { chapter, scenes, assets };
}
export async function timelineState(chapterId: number) {
  const source = await editorSource(chapterId);
  const saved = (await pool.query("SELECT * FROM chapter_timelines WHERE chapter_id=$1", [chapterId])).rows[0];
  const renders = (await pool.query(`SELECT r.*,a.metadata->>'captionAssetId' caption_asset_id FROM timeline_renders r
    LEFT JOIN media_production_assets a ON a.id=r.asset_id WHERE r.chapter_id=$1 ORDER BY r.id DESC LIMIT 20`, [chapterId])).rows;
  return { ...source, revision: saved?.revision ?? 0, scenes: saved?.definition.scenes ?? source.scenes,
    renders: renders.map(r => ({ ...r, asset_url: assetUrl(r.asset_id), caption_url: assetUrl(r.caption_asset_id ? Number(r.caption_asset_id) : null) })) };
}
export async function saveTimeline(chapterId: number, revision: number, raw: unknown, auto = false) {
  const source = await editorSource(chapterId);
  const definition = definitionSchema.parse(auto ? { scenes: source.scenes } : raw);
  try { validateTimeline(definition, source.scenes, source.assets); } catch (error) { fail(400, String((error as Error).message)); }
  const result = revision === 0
    ? await pool.query("INSERT INTO chapter_timelines(chapter_id,revision,definition) VALUES($1,1,$2) ON CONFLICT DO NOTHING RETURNING chapter_id", [chapterId, JSON.stringify(definition)])
    : await pool.query("UPDATE chapter_timelines SET revision=revision+1,definition=$3,updated_at=now() WHERE chapter_id=$1 AND revision=$2 RETURNING chapter_id", [chapterId, revision, JSON.stringify(definition)]);
  if (!result.rowCount) fail(409, "Another editor changed this timeline. Reload before saving.");
  return timelineState(chapterId);
}
export async function queueTimelineRender(chapterId: number, revision: number) {
  const source = await editorSource(chapterId);
  const saved = (await pool.query("SELECT * FROM chapter_timelines WHERE chapter_id=$1 AND revision=$2", [chapterId, revision])).rows[0];
  if (!saved) fail(409, "Save this timeline revision before rendering.");
  try { validateTimeline(definitionSchema.parse(saved.definition), source.scenes, source.assets); } catch (error) { fail(409, (error as Error).message); }
  await pool.query(`INSERT INTO timeline_renders(chapter_id,revision,definition)
    SELECT $1,$2,$3 WHERE NOT EXISTS(SELECT 1 FROM timeline_renders WHERE chapter_id=$1 AND revision=$2 AND status IN ('queued','rendering','ready','published'))`,
    [chapterId, revision, JSON.stringify(saved.definition)]);
  return timelineState(chapterId);
}
