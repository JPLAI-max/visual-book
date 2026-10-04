import { Router,type IRouter } from "express";
import { objectStorageClient } from "../lib/objectStorage";
import { parseId,fail } from "../services/access";
import { pool } from "@workspace/db";
const router:IRouter=Router();
router.get("/media/:kind/:id",async (req,res)=>{
  const kind=String(req.params.kind);
  if(!["narration","captions"].includes(kind))fail(404,"Unknown media kind");
  const id=parseId(req.params.id);
  if(id>6)fail(404,"Sample media not found");
  const publicEdition=(await pool.query(`SELECT id FROM visual_editions WHERE published=true AND sample=true LIMIT 1`)).rows[0];
  if(!publicEdition)fail(404,"Sample edition is not currently available");
  const object=`folio/samples/${kind==="narration"?"narration":"captions"}-${id}.${kind==="narration"?"mp3":"vtt"}`;
  const file=objectStorageClient.bucket(process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID!).file(object);
  const [metadata]=await file.getMetadata();
  const size=Number(metadata.size);
  res.setHeader("Content-Type",kind==="narration"?"audio/mpeg":"text/vtt");
  res.setHeader("Cache-Control","private, max-age=300");
  res.setHeader("Accept-Ranges","bytes");
  if(req.method==="HEAD"){res.setHeader("Content-Length",size);res.end();return;}
  if(req.headers.range) {
    const match=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if(!match){res.status(416).setHeader("Content-Range",`bytes */${size}`);res.end();return;}
    const start=Number(match[1]);const end=match[2]?Math.min(Number(match[2]),size-1):size-1;
    if(start>=size||end<start){res.status(416).setHeader("Content-Range",`bytes */${size}`);res.end();return;}
    res.status(206);res.setHeader("Content-Range",`bytes ${start}-${end}/${size}`);res.setHeader("Content-Length",end-start+1);
    file.createReadStream({start,end}).on("error",err=>{req.log.error({err},"Media stream failed");res.destroy();}).pipe(res);
  }else {
    res.setHeader("Content-Length",size);
    file.createReadStream().on("error",err=>{req.log.error({err},"Media stream failed");res.destroy();}).pipe(res);
  }
});
export default router;