import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { GetBookResponse, ListBooksResponse, GetHomeResponse, GetMeResponse, SaveProgressBody, RequestBookBody, SubmitFeedbackBody, RecordViewEventBody } from "@workspace/api-zod";
import { readerId, signedIn, isAdmin, parseId, validateContext, fail } from "../services/access";
import { catalog, searchBooks, bookDetail, normalize } from "../services/catalog";

const router: IRouter = Router();
const ok = (message: string) => ({ success: true, message });
router.get("/me", async (req,res) => {
  const id=readerId(req);
  let subscription="free";
  if (id) {
    await pool.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT DO NOTHING",[id]);
    subscription=(await pool.query("SELECT subscription_status FROM users WHERE id=$1",[id])).rows[0].subscription_status;
  }
  res.json(GetMeResponse.parse({authenticated:!!id,admin:await isAdmin(req),subscription}));
});
router.get("/books", async (req,res) => {
  const q=typeof req.query.q==="string"?req.query.q.slice(0,200):"";
  const genre=typeof req.query.genre==="string"?req.query.genre:"";
  res.json(ListBooksResponse.parse(await searchBooks(q,genre,readerId(req))));
});
router.get("/books/:id", async (req,res) => {
  res.json(GetBookResponse.parse(await bookDetail(parseId(req.params.id),readerId(req))));
});
router.get("/home", async (req,res) => {
  const books=await catalog(readerId(req));
  res.json(GetHomeResponse.parse({recent:books,continuing:books.filter(b=>b.progress && b.progress.percentage<100),library:books.filter(b=>b.saved)}));
});
router.get("/library",signedIn,async (req,res) => {res.json(ListBooksResponse.parse((await catalog(readerId(req))).filter(b=>b.saved)));});
router.post("/library/:bookId",signedIn,async (req,res) => {
  const id=parseId(req.params.bookId); await validateContext(id);
  await pool.query("INSERT INTO user_library (user_id,book_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",[readerId(req),id]);
  res.json(ok("Added to your library"));
});
router.delete("/library/:bookId",signedIn,async (req,res) => {
  await pool.query("DELETE FROM user_library WHERE user_id=$1 AND book_id=$2",[readerId(req),parseId(req.params.bookId)]);
  res.json(ok("Removed from your library"));
});
router.post("/progress",signedIn,async (req,res) => {
  const input=SaveProgressBody.parse(req.body);
  const context=await validateContext(input.bookId,input.chapterId);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${readerId(req)}:${context.edition_id}`]);
    const old=(await client.query("SELECT completed_chapters FROM user_book_progress WHERE user_id=$1 AND visual_edition_id=$2",[readerId(req),context.edition_id])).rows[0];
    const completed=new Set<number>(old?.completed_chapters??[]);
    const position=Math.min(context.duration,input.position);
    if(input.completed && position>=context.duration-1) completed.add(input.chapterId);
    const chapterRows=(await client.query("SELECT id,duration,sort_order FROM chapters WHERE visual_edition_id=$1 ORDER BY sort_order",[context.edition_id])).rows;
    const total=chapterRows.reduce((s,c)=>s+c.duration,0);
    const watched=chapterRows.reduce((s,c)=>s+(completed.has(c.id)?c.duration:c.id===input.chapterId?position:0),0);
    const percentage=total?Math.min(100,watched/total*100):0;
    await client.query(`INSERT INTO user_book_progress (user_id,visual_edition_id,chapter_id,playback_position,percentage_complete,completed_chapters)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id,visual_edition_id) DO UPDATE SET chapter_id=$3,playback_position=$4,percentage_complete=$5,completed_chapters=$6,last_watched_at=now()`,
      [readerId(req),context.edition_id,input.chapterId,position,percentage,JSON.stringify([...completed])]);
    await client.query("COMMIT");
  } catch(e) {await client.query("ROLLBACK");throw e;} finally {client.release();}
  res.json(ok("Progress saved"));
});
router.post("/requests",signedIn,async (req,res) => {
  const input=RequestBookBody.parse(req.body);
  if (input.bookId) {
    const books=await catalog(readerId(req));
    const book=books.find(b=>b.id===input.bookId);
    if (!book) fail(404,"Book not found");
    if (["unlicensed","pending_license","unknown"].includes(book.rightsStatus)) fail(403,"This title requires rights review before an adaptation request.");
    if(book.status==="published") fail(409,"This edition is already available");
    input.title=book.title; input.author=book.author;
  }
  await pool.query(`INSERT INTO book_requests(user_id,title,normalized_title,author,matched_book_id) VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT(user_id,normalized_title) DO NOTHING`,[readerId(req),input.title.trim(),normalize(input.title),input.author??"",input.bookId??null]);
  res.json(ok(input.bookId?"Request recorded. Production requires editorial approval.":"Request recorded for title and rights review. No media generation has started."));
});
router.post("/feedback",signedIn,async (req,res) => {
  const input=SubmitFeedbackBody.parse(req.body);
  if(input.sceneId&&!input.chapterId) fail(400,"Chapter is required for scene feedback");
  await validateContext(input.bookId,input.chapterId,input.sceneId);
  await pool.query(`INSERT INTO feedback(user_id,book_id,chapter_id,scene_id,feedback_type,rating,comment) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [readerId(req),input.bookId,input.chapterId??null,input.sceneId??null,input.feedbackType??"other",input.rating,input.comment??""]);
  res.json(ok("Thank you. Your feedback helps improve this edition."));
});
router.post("/events",async (req,res) => {
  const input=RecordViewEventBody.parse(req.body);
  const context=await validateContext(input.bookId,input.chapterId,input.sceneId);
  const id=readerId(req);
  if(id) await pool.query("INSERT INTO users(id) VALUES ($1) ON CONFLICT DO NOTHING",[id]);
  await pool.query(`INSERT INTO view_events(user_id,book_id,chapter_id,scene_id,scene_version_id,event_type,playback_position,watch_seconds)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[id,input.bookId,input.chapterId,input.sceneId??null,context.current_version_id,input.eventType,Math.min(input.position,context.duration),input.watchSeconds??0]);
  res.json(ok("Recorded"));
});
export default router;