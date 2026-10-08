import { pool } from "@workspace/db";
import { fail } from "../access";
import { assertRights } from "../catalog";
import { assetUrl } from "../production/assets";
import { definitionSchema, validateTimeline } from "./types";
import { editorSource, timelineState } from "./timeline";
import { assertDirectorReview } from "../director/assembly";

export async function publishTimeline(chapterId: number, revision: number, renderId: number, dryRun = false) {
  const source = await editorSource(chapterId);
  await assertRights(source.chapter.book_id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [chapterId]);
    const current = (await client.query("SELECT revision FROM chapter_timelines WHERE chapter_id=$1 FOR UPDATE", [chapterId])).rows[0];
    const render = (await client.query("SELECT * FROM timeline_renders WHERE id=$1 AND chapter_id=$2 FOR UPDATE", [renderId, chapterId])).rows[0];
    if (!render || render.status !== "ready" || render.revision !== revision || current?.revision !== revision) fail(409, "Publish a ready render of the current saved timeline revision.");
    const definition = definitionSchema.parse(render.definition);
    await assertDirectorReview(definition, client);
    try { validateTimeline(definition, source.scenes, source.assets); } catch (error) { fail(409, (error as Error).message); }
    for (const scene of definition.scenes) {
      const output = render.scene_assets.find((asset: { sceneId: number }) => asset.sceneId === scene.id);
      if (!output?.assetId) fail(409, "Render is missing a scene.");
      const version = (await client.query(`INSERT INTO scene_versions(scene_id,version_number,narration,image_asset,video_asset,audio_asset,caption_asset,
        render_status,generation_provider,generation_model,generation_cost,notes,prompt_metadata)
        SELECT $1,COALESCE(max(version_number),0)+1,$2,$3,$4,$5,$6,'published','ffmpeg','shot-timeline-v1',0,
        'Non-destructive chapter editor revision', $7 FROM scene_versions WHERE scene_id=$1 RETURNING id`,
        [scene.id, scene.narration, assetUrl(scene.shots[0]!.assetId), assetUrl(output.assetId), assetUrl(scene.audioAssetId),
          assetUrl(scene.captionAssetId), JSON.stringify({ timelineRenderId: render.id, timelineRevision: revision, shots: scene.shots })])).rows[0];
      for (const [kind, id] of [["video", output.assetId], ["audio", scene.audioAssetId], ["caption", scene.captionAssetId], ["image", scene.shots[0]!.assetId]] as const) {
        await client.query("INSERT INTO assets(scene_version_id,kind,object_path,metadata) VALUES($1,$2,$3,$4)",
          [version.id, kind, assetUrl(id), JSON.stringify({ productionAssetId: id })]);
      }
      await client.query("UPDATE scenes SET current_version_id=$2,duration=$3 WHERE id=$1", [scene.id, version.id, scene.duration]);
    }
    const duration = definition.scenes.reduce((sum, scene) => sum + scene.duration, 0);
    await client.query("UPDATE chapters SET status='published',duration=$2 WHERE id=$1", [chapterId, duration]);
    await client.query(`UPDATE visual_editions SET published=true,status='published',total_duration=(SELECT SUM(duration) FROM chapters WHERE visual_edition_id=$1),
      updated_at=now() WHERE id=$1`, [source.chapter.visual_edition_id]);
    await client.query("UPDATE timeline_renders SET status='published' WHERE id=$1", [renderId]);
    await client.query(dryRun ? "ROLLBACK" : "COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return timelineState(chapterId);
}
