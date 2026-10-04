import { Router,type IRouter } from "express";
import { pool } from "@workspace/db";
import { CreateBookBody,UpdateBookBody,AdminActionBody,CreateSceneVersionBody,GetAdminOverviewResponse,GetAdminDataResponse } from "@workspace/api-zod";
import { adminOnly,signedIn,readerId,parseId,fail } from "../services/access";
import { adminData,adminOverview } from "../services/editorial";
import { catalog,assertRights,validateLicense } from "../services/catalog";

const router:IRouter=Router();
router.use("/admin",signedIn,adminOnly);
const ok=(message:string)=>({success:true,message});
function assetUrl(value:string) {
  if(!value)return value;
  if(value.startsWith("/")&&!value.startsWith("//"))return value;
  const url=new URL(value);if(url.protocol!=="https:")fail(400,"Media URLs must use HTTPS or a local asset path");
  return value;
}
router.get("/admin/overview",async (_req,res)=>{res.json(GetAdminOverviewResponse.parse(await adminOverview()));});
router.get("/admin/data/:section",async (req,res)=>{res.json(GetAdminDataResponse.parse(await adminData(String(req.params.section))));});
router.post("/admin/books",async (req,res)=>{
  const b=CreateBookBody.parse(req.body);
  validateLicense(b.license??{});
  if(b.coverImage)assetUrl(b.coverImage);
  const client=await pool.connect();
  let id:number;
  try {
    await client.query("BEGIN");
    const row=await client.query(`INSERT INTO books(title,author,description,genre,rights_status,rights_notes,original_publication_year,cover_image,license)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[b.title,b.author,b.description,b.genre,b.rightsStatus,b.rightsNotes??"",b.year??0,b.coverImage??"",JSON.stringify(b.license??{})]);
    id=row.rows[0].id;
    await client.query("INSERT INTO visual_editions(book_id) VALUES($1)",[id]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  res.json((await catalog(readerId(req))).find(b=>b.id===id));
});
router.patch("/admin/books/:id",async (req,res)=>{
  const b=UpdateBookBody.parse(req.body);const id=parseId(req.params.id);
  validateLicense(b.license??{});
  if(b.coverImage)assetUrl(b.coverImage);
  const existing=(await pool.query("SELECT * FROM books WHERE id=$1",[id])).rows[0];if(!existing)fail(404,"Book not found");
  await pool.query(`UPDATE books SET title=$2,author=$3,description=$4,genre=$5,rights_status=$6,rights_notes=$7,
    original_publication_year=$8,cover_image=$9,license=$10,updated_at=now() WHERE id=$1`,
    [id,b.title,b.author,b.description,b.genre,b.rightsStatus,b.rightsNotes??existing.rights_notes,b.year??existing.original_publication_year,
      b.coverImage??existing.cover_image,JSON.stringify(b.license??existing.license)]);
  // Rights changes never leave an ineligible edition publicly streamable.
  try{await assertRights(id);}catch {await pool.query("UPDATE visual_editions SET published=false,status='revision_needed' WHERE book_id=$1 AND published=true",[id]);}
  await pool.query("INSERT INTO editorial_audit(user_id,action,target_id)VALUES($1,'update_book',$2)",[readerId(req),id]);
  res.json((await catalog(readerId(req))).find(b=>b.id===id));
});
router.post("/admin/scenes/:id/versions",async (req,res)=>{
  const sceneId=parseId(req.params.id);const input=CreateSceneVersionBody.parse(req.body);
  [input.imageUrl,input.videoUrl,input.audioUrl,input.captionUrl].forEach(assetUrl);
  const scene=(await pool.query("SELECT id FROM scenes WHERE id=$1",[sceneId])).rows[0];if(!scene)fail(404,"Scene not found");
  const client=await pool.connect();
  try{
    await client.query("BEGIN");
    await client.query("SELECT id FROM scenes WHERE id=$1 FOR UPDATE",[sceneId]);
    const next=(await client.query("SELECT COALESCE(max(version_number),0)+1 n FROM scene_versions WHERE scene_id=$1",[sceneId])).rows[0].n;
    const row=await client.query(`INSERT INTO scene_versions(scene_id,version_number,narration,image_asset,video_asset,audio_asset,caption_asset,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,[sceneId,next,input.narration,input.imageUrl,input.videoUrl,input.audioUrl,input.captionUrl,input.notes??""]);
    for(const [kind,url] of [["image",input.imageUrl],["video",input.videoUrl],["audio",input.audioUrl],["captions",input.captionUrl]]) {
      if(url)await client.query("INSERT INTO assets(scene_version_id,kind,object_path) VALUES($1,$2,$3)",[row.rows[0].id,kind,url]);
    }
    await client.query("INSERT INTO editorial_audit(user_id,action,target_id)VALUES($1,'create_scene_version',$2)",[readerId(req),sceneId]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  res.json(ok("Draft version created. The published scene has not changed."));
});
router.post("/admin/actions",async (req,res)=>{
  const {action,id,settings}=AdminActionBody.parse(req.body);
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    if(action==="publish_version"||action==="rollback_version") {
      const v=(await client.query(`SELECT v.*,e.book_id FROM scene_versions v JOIN scenes s ON s.id=v.scene_id
        JOIN chapters c ON c.id=s.chapter_id JOIN visual_editions e ON e.id=c.visual_edition_id WHERE v.id=$1 FOR UPDATE OF v,s`,[id])).rows[0];
      if(!v)fail(404,"Version not found");
      await assertRights(v.book_id);
      if(!(v.video_asset || (v.image_asset && v.audio_asset)))fail(400,"A version needs video or both artwork and narration before publication");
      await client.query("UPDATE scenes SET current_version_id=$2,status='published' WHERE id=$1",[v.scene_id,id]);
      await client.query("UPDATE scene_versions SET render_status='published' WHERE id=$1",[id]);
      await client.query(`UPDATE chapters SET version=split_part(version,'.',1)||'.'||(split_part(version,'.',2)::int+1)
        WHERE id=(SELECT chapter_id FROM scenes WHERE id=$1)`,[v.scene_id]);
      await client.query(`UPDATE visual_editions SET version=split_part(version,'.',1)||'.'||(split_part(version,'.',2)::int+1),updated_at=now()
        WHERE id=(SELECT c.visual_edition_id FROM chapters c JOIN scenes s ON s.chapter_id=c.id WHERE s.id=$1)`,[v.scene_id]);
    } else if(action==="publish_edition") {
      const e=(await client.query("SELECT * FROM visual_editions WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!e)fail(404,"Edition not found");
      await assertRights(e.book_id);
      const rows=(await client.query(`SELECT s.id,v.video_asset,v.image_asset,v.audio_asset FROM scenes s JOIN chapters c ON c.id=s.chapter_id
        LEFT JOIN scene_versions v ON v.id=s.current_version_id WHERE c.visual_edition_id=$1`,[id])).rows;
      if(!rows.length||rows.some(s=>!(s.video_asset||(s.image_asset&&s.audio_asset))))fail(400,"Every scene needs reviewed playable media before publishing");
      await client.query("UPDATE visual_editions SET published=false,status='archived' WHERE book_id=$1 AND id<>$2 AND published=true",[e.book_id,id]);
      await client.query("UPDATE visual_editions SET published=true,status='published',published_at=now() WHERE id=$1",[id]);
      await client.query("UPDATE chapters SET status='published' WHERE visual_edition_id=$1",[id]);
    } else if(action==="archive_edition") {
      const result=await client.query("UPDATE visual_editions SET published=false,status='archived' WHERE id=$1 RETURNING id",[id]);
      if(!result.rowCount)fail(404,"Edition not found");
    } else if(action==="approve_request") {
      const r=(await client.query("SELECT normalized_title,matched_book_id FROM book_requests WHERE id=$1",[id])).rows[0];if(!r)fail(404,"Request not found");
      const matchedId=r.matched_book_id??(settings?.bookId?parseId(settings.bookId):null);
      if(!matchedId)fail(400,"Match this request to a catalog book with documented rights before approving");
      await assertRights(matchedId);
      await client.query("UPDATE book_requests SET status='approved',matched_book_id=$2 WHERE normalized_title=$1",[r.normalized_title,matchedId]);
    } else if(action==="plan_book") {
      const book=await assertRights(id);
      if(!book.source_url)fail(400,"Approved source text URL required; initial planning supports the seeded Gutenberg sources.");
      await client.query("SELECT id FROM books WHERE id=$1 FOR UPDATE",[id]);
      const existing=(await client.query("SELECT id FROM generation_jobs WHERE book_id=$1 AND status IN('queued','processing','paused')",[id])).rows;
      if(existing.length)fail(409,"A planning job already exists for this title");
      const e=(await client.query("SELECT * FROM visual_editions WHERE book_id=$1 ORDER BY edition_number DESC LIMIT 1 FOR UPDATE",[id])).rows[0];
      let eid=e?.id;
      if(e?.published)fail(409,"A reusable published edition already exists. Revise individual scenes instead of regenerating it.");
      const planned=await client.query("SELECT id FROM chapters WHERE visual_edition_id=$1 LIMIT 1",[eid]);
      if(planned.rowCount)fail(409,"This edition already has a plan. Review its existing scenes.");
      if(!eid)eid=(await client.query("INSERT INTO visual_editions(book_id,status) VALUES($1,'approved') RETURNING id",[id])).rows[0].id;
      await client.query("INSERT INTO generation_jobs(book_id,visual_edition_id,job_type) VALUES($1,$2,'book_analysis')",[id,eid]);
      await client.query("UPDATE visual_editions SET status='planning' WHERE id=$1",[eid]);
    } else if(["pause_job","resume_job","retry_job","cancel_job"].includes(action)) {
      const job=(await client.query("SELECT * FROM generation_jobs WHERE id=$1 FOR UPDATE",[id])).rows[0];if(!job)fail(404,"Job not found");
      const allowed:Record<string,string[]>={pause_job:["queued","processing"],resume_job:["paused"],retry_job:["failed"],cancel_job:["queued","processing","paused","failed"]};
      if(!allowed[action]!.includes(job.status))fail(409,`Cannot ${action.replace("_"," ")} in ${job.status} state`);
      if(action==="resume_job"||action==="retry_job")await assertRights(job.book_id);
      if(action==="retry_job"&&job.attempts>=3)fail(409,"Retry limit reached. Review provider error and create a new plan after correcting it.");
      const status=action==="pause_job"?"paused":action==="cancel_job"?"cancelled":"queued";
      await client.query("UPDATE generation_jobs SET status=$2,error_message=NULL,lease_until=NULL WHERE id=$1",[id,status]);
    } else if(action==="save_settings") {
      const allowed=new Set(["textProvider","textModel","imageProvider","videoProvider","voiceProvider","freePreviewSeconds","subscriberCatalogAccess","premiumLicensedAccess"]);
      const values:Record<string,unknown>={};
      for(const [k,v] of Object.entries(settings??{})) {
        if(!allowed.has(k))fail(400,`Setting '${k}' cannot be changed here`);
        if(typeof v!=="string"&&typeof v!=="number"&&typeof v!=="boolean")fail(400,"Settings must be simple values");
        if(k==="freePreviewSeconds"&&(typeof v!=="number"||v<0||v>86400))fail(400,"Preview seconds must be between 0 and 86400");
        values[k]=v;
      }
      await client.query("UPDATE settings SET value=value||$1::jsonb WHERE key='providers'",[JSON.stringify(values)]);
    }
    await client.query("INSERT INTO editorial_audit(user_id,action,target_id,details) VALUES($1,$2,$3,$4)",[readerId(req),action,id,JSON.stringify(settings??{})]);
    await client.query("COMMIT");
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  res.json(ok(action==="plan_book"?"Planning queued. Analysis runs on the server and survives page refreshes. Actual AI charges are billed to your credits.":"Editorial changes saved"));
});
export default router;