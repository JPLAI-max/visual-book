import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { SaveChapterTimelineBody, AskBookQuestionBody, AskBookQuestionResponse } from "@workspace/api-zod";
import { signedIn, adminOnly, parseId } from "../services/access";
import { timelineState, saveTimeline, queueTimelineRender } from "../services/editor/timeline";
import { publishTimeline } from "../services/editor/publish";
import { askQuestion, questionActor, questionInsights } from "../services/questions/ask";
const router: IRouter = Router();
router.use("/admin/timeline", signedIn, adminOnly);
router.use("/admin/questions", signedIn, adminOnly);
router.get("/admin/timeline/chapters", async (_req, res) => {
  const chapters = (await pool.query(`SELECT c.id,c.title,c.duration,b.id book_id,b.title book_title FROM media_productions p
    JOIN chapters c ON c.id=p.chapter_id JOIN books b ON b.id=p.book_id ORDER BY b.id,c.sort_order`)).rows;
  res.json({ data: { chapters } });
});
router.get("/admin/timeline/chapters/:chapterId", async (req, res) => res.json({ data: await timelineState(parseId(req.params.chapterId)) }));
router.put("/admin/timeline/chapters/:chapterId", async (req, res) => {
  const body = SaveChapterTimelineBody.parse(req.body);
  res.json({ data: await saveTimeline(parseId(req.params.chapterId), body.revision, { scenes: body.scenes }) });
});
router.post("/admin/timeline/chapters/:chapterId/auto-assemble", async (req, res) => {
  const body = SaveChapterTimelineBody.parse(req.body);
  res.json({ data: await saveTimeline(parseId(req.params.chapterId), body.revision, null, true) });
});
router.post("/admin/timeline/chapters/:chapterId/render", async (req, res) => {
  const body = SaveChapterTimelineBody.parse(req.body);
  res.json({ data: await queueTimelineRender(parseId(req.params.chapterId), body.revision) });
});
router.post("/admin/timeline/chapters/:chapterId/publish", async (req, res) => {
  const body = SaveChapterTimelineBody.parse(req.body);
  res.json({ data: await publishTimeline(parseId(req.params.chapterId), body.revision, parseId(body.renderId)) });
});
router.post("/ask", async (req, res) => {
  const input = AskBookQuestionBody.parse(req.body);
  res.json(AskBookQuestionResponse.parse(await askQuestion(input, questionActor(req, res))));
});
router.get("/ask/history", async (req, res) => {
  const actor = questionActor(req, res);
  const questions = (await pool.query(`SELECT question,answer,scene_id,timestamp,created_at FROM saved_questions
    WHERE actor_key=$1 AND book_id=$2 ORDER BY id DESC LIMIT 50`, [actor.actorKey, parseId(req.query.bookId)])).rows;
  res.set("Cache-Control", "private, no-store").json({ data: { questions } });
});
router.get("/admin/questions", async (_req, res) => res.json({ data: { scenes: await questionInsights() } }));
export default router;
