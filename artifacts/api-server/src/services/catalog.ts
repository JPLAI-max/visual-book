import { pool } from "@workspace/db";
import { fail } from "./access";

export function normalize(text: string): string { return text.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
export function validateLicense(license:Record<string,unknown>) {
  for(const key of ["startDate","expiration"]) {
    const date=license[key];
    if(date && (typeof date!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date)))) fail(400,`${key} must be a valid YYYY-MM-DD date`);
  }
  if(license.startDate && license.expiration && String(license.startDate)>String(license.expiration))fail(400,"License expiration must follow its start date");
  for(const key of ["royaltyRate","revenueShare"]) {
    const value=license[key];
    if(value!==undefined && value!=="" && (typeof value!=="number" || !Number.isFinite(value) || value<0 || value>100))fail(400,`${key} must be between 0 and 100`);
  }
}
function distance(a: string, b: string) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j-1]!+1, previous[j]!+1, previous[j-1]!+(a[i-1]===b[j-1]?0:1));
    previous = next;
  }
  return previous[b.length]!;
}
export async function catalog(userId: string | null) {
  const { rows } = await pool.query(`SELECT b.*, e.id edition_id,e.version,e.status,e.total_duration,e.sample,
    (SELECT count(*)::int FROM chapters WHERE visual_edition_id=e.id) chapter_count,
    p.chapter_id,p.playback_position,p.percentage_complete,p.completed_chapters,
    (SELECT title FROM chapters WHERE id=p.chapter_id) chapter_title,
    EXISTS(SELECT 1 FROM user_library WHERE user_id=$1 AND book_id=b.id) saved
    FROM books b
    LEFT JOIN LATERAL (SELECT * FROM visual_editions WHERE book_id=b.id ORDER BY published DESC,edition_number DESC LIMIT 1) e ON true
    LEFT JOIN user_book_progress p ON p.visual_edition_id=e.id AND p.user_id=$1
    ORDER BY b.id`, [userId]);
  return rows.map(r => ({
    id:r.id,title:r.title,subtitle:r.subtitle,author:r.author,description:r.description,
    coverImage:r.cover_image,year:r.original_publication_year,genre:r.genre,isbn:r.isbn,
    rightsStatus:r.rights_status,rightsNotes:r.rights_notes,status:r.rights_status==="licensed" && r.license?.expiration && new Date(r.license.expiration)<new Date() ? "license_expired" : r.status??"requested",
    duration:r.total_duration??0,chapterCount:r.chapter_count??0,sample:r.sample??false,
    editionId:r.edition_id,version:r.version,saved:r.saved,
    ...(r.chapter_id ? {progress:{chapterId:r.chapter_id,chapterTitle:r.chapter_title,position:r.playback_position,
      percentage:r.percentage_complete,completedChapters:r.completed_chapters}} : {}),
  }));
}
export async function searchBooks(q: string, genre: string, userId: string | null) {
  let books = await catalog(userId);
  if (genre && genre.toLowerCase() !== "all") books = books.filter(b => b.genre.toLowerCase()===genre.toLowerCase());
  if (!q) return books;
  const n = normalize(q).slice(0,200);
  const hits = books.map(b => {
    const title = normalize(b.title);
    const words = title.split(" ");
    const d = Math.min(distance(n,title),...words.map(w => distance(n,w)));
    const score = title.includes(n)||normalize(b.author).includes(n)||normalize(b.isbn)===n ? 100 : Math.max(0,70-d*12);
    return {b,score,d};
  }).filter(x => x.score===100 || x.d<=Math.max(1,Math.floor(n.length*0.25))).sort((a,b)=>b.score-a.score);
  if (hits.length) await pool.query("UPDATE books SET search_count=search_count+1 WHERE id=ANY($1::int[])", [hits.map(x=>x.b.id)]);
  return hits.map(x=>x.b);
}
export async function bookDetail(id: number, userId: string | null, admin = false) {
  const book = (await catalog(userId)).find(b=>b.id===id);
  if (!book) fail(404,"Book not found");
  const { rows: chapterRows } = await pool.query("SELECT * FROM chapters WHERE visual_edition_id=$1 ORDER BY sort_order",[book.editionId]);
  const { rows: sceneRows } = await pool.query(`SELECT s.*,v.version_number,v.narration version_narration,v.image_asset,v.video_asset,v.audio_asset,v.caption_asset
    FROM scenes s LEFT JOIN scene_versions v ON v.id=s.current_version_id
    JOIN chapters c ON c.id=s.chapter_id WHERE c.visual_edition_id=$1 ORDER BY s.scene_number`,[book.editionId]);
  return {book,chapters:chapterRows.map(c=>({id:c.id,title:c.title,number:c.chapter_number,summary:c.summary,
    duration:c.duration,status:c.status,scenes:sceneRows.filter(s=>s.chapter_id===c.id).map(s=>({
      id:s.id,title:s.title,number:s.scene_number,narration:s.version_narration??s.narration,duration:s.duration,purpose:s.purpose,
      imageUrl:admin||book.status==="published"?s.image_asset??"":"",
      videoUrl:admin||book.status==="published"?s.video_asset??"":"",
      audioUrl:admin||book.status==="published"?s.audio_asset??"":"",
      captionUrl:admin||book.status==="published"?s.caption_asset??"":"",
      version:s.version_number??1,
    }))}))};
}
export async function assertRights(bookId: number) {
  const {rows} = await pool.query("SELECT * FROM books WHERE id=$1",[bookId]);
  const book = rows[0];
  if (!book) fail(404,"Book not found");
  if (!["public_domain","owned","licensed"].includes(book.rights_status)) fail(403,"Rights approval is required before adaptation.");
  if (!book.rights_notes.trim()) fail(403,"Enter documented rights evidence before generation or publication.");
  const license = book.license ?? {};
  if (book.rights_status==="licensed") {
    if (!license.rightsHolder || !license.usagePermissions || !license.territory) fail(403,"License holder, territory and adaptation permissions are required.");
    if (license.startDate && new Date(license.startDate)>new Date()) fail(403,"License has not started.");
    if (license.expiration && new Date(license.expiration)<new Date()) fail(403,"License has expired.");
    if (!String(license.usagePermissions).toLowerCase().includes("adapt")) fail(403,"License must explicitly permit adaptation.");
  }
  return book;
}