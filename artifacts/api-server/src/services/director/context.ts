import { pool } from "@workspace/db";
import { editorSource, timelineState } from "../editor/timeline";
import { readAsset } from "../production/assets";
import { loadSource, detectChapters } from "../intelligence/source";
type Reference = {id:number;canonical_id:number;kind:string;name:string;current_asset_id:number;data:Record<string,any>};
type SceneContext = {id:number;playback_scene_id:number;scene_number:number;data:Record<string,any>;narration:string;duration:number;captions:string;references:Reference[];previous_scene:unknown;next_scene:unknown};
export async function directorContext(chapterId: number) {
  const source = await editorSource(chapterId);
  const production = (await pool.query("SELECT * FROM media_productions WHERE id=$1", [source.chapter.production_id])).rows[0];
  const scenes = (await pool.query("SELECT * FROM media_production_scenes WHERE production_id=$1 ORDER BY scene_number", [production.id])).rows;
  const refs = (await pool.query<Reference>("SELECT * FROM media_references WHERE production_id=$1 AND status='approved' ORDER BY id", [production.id])).rows;
  const originals = await loadSource(production.configuration.sourceId);
  const blueprint = (await pool.query("SELECT chapter_number FROM intelligence_chapters WHERE id=$1", [production.blueprint_chapter_id])).rows[0];
  const evidence = detectChapters(originals.text).find(c => c.chapter_number === blueprint.chapter_number);
  if (!evidence) throw new Error("Canonical source chapter is missing");
  const contextualScenes:SceneContext[] = await Promise.all(scenes.map(async (scene, index) => {
    const override=production.configuration.directorEnvironments?.[String(scene.playback_scene_id)];
    const environmentIds:number[]=Array.isArray(override)?override:[override??scene.data.environment_id].filter(v=>v!==null&&v!==undefined);
    const environmentId=environmentIds[0]??null;
    const timeline = source.scenes[index]!;
    const childhood = production.configuration.chapterTitle === "Chapter 1" && scene.scene_number >= 3;
    const relevant = refs.filter(ref => ref.kind === "environment" ? environmentIds.includes(ref.canonical_id) :
      scene.data.characters_present.includes(ref.canonical_id) &&
      (ref.kind === "character_child" ? childhood : !(childhood && refs.some(r => r.kind === "character_child" && r.canonical_id === ref.canonical_id))));
    return { ...scene, data:{...scene.data,environment_id:environmentId,allowed_environment_ids:environmentIds},narration: timeline.narration, duration: timeline.duration,
      captions: (await readAsset(timeline.captionAssetId)).toString("utf8"), references: relevant,
      previous_scene: scenes[index - 1]?.data ?? null, next_scene: scenes[index + 1]?.data ?? null };
  }));
  return { ...source, production, scenes: contextualScenes, references: refs, sourceText: originals.text.slice(evidence.start_offset, evidence.end_offset).slice(0,18000),
    timeline: await timelineState(chapterId) };
}
