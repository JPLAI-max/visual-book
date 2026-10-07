import { pool } from "@workspace/db";
import { fail } from "../access";
import { bookDetail } from "../catalog";
import { loadSource } from "../intelligence/source";

export async function questionContext(bookId: number, chapterId: number, sceneId: number, timestamp: number) {
  const detail = await bookDetail(bookId, null);
  if (detail.book.status !== "published") fail(404, "This book is not published.");
  const chapter = detail.chapters.find(c => c.id === chapterId);
  const scene = chapter?.scenes.find(s => s.id === sceneId);
  if (!chapter || chapter.status !== "published" || !scene) fail(400, "The scene must belong to this published chapter and edition.");
  const index = chapter.scenes.findIndex(s => s.id === sceneId);
  const start = chapter.scenes.slice(0, index).reduce((sum, s) => sum + Number(s.duration), 0);
  if (timestamp < Math.max(0, start - 1) || timestamp > start + Number(scene.duration) + 1) fail(400, "Playback position does not match this scene.");
  const context = (await pool.query(`SELECT ps.data,p.analysis_id,p.blueprint_chapter_id,ba.source_id,v.id version_id
    FROM scenes s JOIN scene_versions v ON v.id=s.current_version_id
    LEFT JOIN media_production_scenes ps ON ps.playback_scene_id=s.id
    LEFT JOIN media_productions p ON p.id=ps.production_id LEFT JOIN book_analyses ba ON ba.id=p.analysis_id
    WHERE s.id=$1`, [sceneId])).rows[0];
  const facts: { id: string; label: string; text: unknown }[] = [
    { id: `scene:${sceneId}`, label: `Scene: ${scene.title}`, text: { narration: scene.narration, summary: context?.data?.summary, sourceReference: context?.data?.source_reference } },
    { id: `chapter:${chapterId}`, label: `Chapter ${chapter.number}: ${chapter.title}`, text: {
      summary: chapter.summary, earlierScenes: chapter.scenes.slice(0, index).map(s => ({ title: s.title, narration: s.narration })),
    } },
  ];
  if (context?.analysis_id) {
    const current = (await pool.query("SELECT * FROM intelligence_chapters WHERE id=$1", [context.blueprint_chapter_id])).rows[0];
    const prior = (await pool.query("SELECT chapter_title,data FROM intelligence_chapters WHERE analysis_id=$1 AND chapter_number < $2 ORDER BY chapter_number DESC LIMIT 3", [context.analysis_id, current.chapter_number])).rows;
    facts.push({ id: "prior", label: "Approved earlier chapter analysis", text: prior.map(c => ({ title: c.chapter_title, summary: c.data.summary ?? c.data.chapter_summary })) });
    const characters = (await pool.query(`SELECT r.name,r.data FROM media_references r JOIN media_productions p ON p.id=r.production_id
      WHERE p.chapter_id=$1 AND r.kind='character' AND r.status='approved' AND r.canonical_id=ANY($2::int[])`,
      [chapterId, context.data?.characters_present ?? []])).rows;
    facts.push({ id: "characters", label: "Approved character references for this scene", text: characters });
    if (context.source_id) {
      const source = await loadSource(context.source_id);
      // Chapter-only excerpt; do not load later chapters into the model's context.
      facts.push({ id: `source:${context.source_id}`, label: `${detail.book.title}, approved source chapter (${source.record.rights_status})`,
        text: source.text.slice(current.start_offset, Math.min(current.end_offset, current.start_offset + 10000)) });
    }
  }
  return { editionId: detail.book.editionId, versionId: context.version_id, rights: detail.book.rightsStatus,
    book: { title: detail.book.title, author: detail.book.author }, chapter: { id: chapterId, title: chapter.title, number: chapter.number },
    scene: { id: sceneId, title: scene.title }, timestamp, facts };
}
