import { Router,type IRouter } from "express";
import { pool } from "@workspace/db";
import { GetBookProductionResponse, RunProductionActionBody } from "@workspace/api-zod";
import { signedIn,adminOnly,parseId,readerId,isAdmin,fail } from "../services/access";
import { assertRights } from "../services/catalog";
import { productionState } from "../services/production/queue";
import { productionAction } from "../services/production/actions";
import { objectStorageClient } from "../lib/objectStorage";
const router:IRouter=Router();
router.use("/admin/production",signedIn,adminOnly);
router.get("/admin/production/books/:bookId",async(req,res)=>res.json(GetBookProductionResponse.parse(await productionState(parseId(req.params.bookId)))));
router.post("/admin/production/books/:bookId/actions",async(req,res)=>{
  await productionAction(parseId(req.params.bookId),RunProductionActionBody.parse(req.body),readerId(req));
  res.json({success:true,message:"Production operation saved. Existing scene versions and source analysis are retained."});
});
router.get("/production/media/:assetId",async(req,res)=>{
  const asset=(await pool.query(`SELECT a.*,p.book_id,e.published,
    e.published AND (
      EXISTS(SELECT 1 FROM assets legacy JOIN scene_versions v ON v.id=legacy.scene_version_id
        WHERE legacy.metadata->>'productionAssetId'=a.id::text AND v.render_status='published')
      OR EXISTS(SELECT 1 FROM chapter_media_renders r WHERE r.asset_id=a.id AND r.status='published')
    ) public_ready FROM media_production_assets a
    JOIN media_productions p ON p.id=a.production_id JOIN visual_editions e ON e.id=p.edition_id WHERE a.id=$1`,[parseId(req.params.assetId)])).rows[0];
  if(!asset)fail(404,"Media not found");
  if(!asset.public_ready&&!await isAdmin(req))fail(readerId(req)?403:401,"Unpublished production media is editor-only");
  await assertRights(asset.book_id);
  const file=objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!).file(asset.object_path);
  const [metadata]=await file.getMetadata();const size=Number(metadata.size);
  res.set({"Content-Type":asset.mime_type,"Cache-Control":asset.public_ready?"private, max-age=300":"private, no-store","Accept-Ranges":"bytes","X-Content-Type-Options":"nosniff"});
  let start=0,end=size-1;
  if(req.headers.range){
    const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!m){res.status(416).set("Content-Range",`bytes */${size}`).end();return;}
    start=Number(m[1]);end=m[2]?Math.min(Number(m[2]),size-1):size-1;
    if(start>=size||end<start){res.status(416).set("Content-Range",`bytes */${size}`).end();return;}
    res.status(206).set("Content-Range",`bytes ${start}-${end}/${size}`);
  }
  res.set("Content-Length",String(end-start+1));
  if(req.method==="HEAD"){res.end();return;}
  file.createReadStream({start,end}).on("error",()=>res.destroy()).pipe(res);
});
export default router;