import { Router,type IRouter } from "express";
import { IngestBookSourceBody,RunIntelligenceActionBody,GetBookIntelligenceResponse } from "@workspace/api-zod";
import { adminOnly,signedIn,readerId,parseId,fail } from "../services/access";
import { pool } from "@workspace/db";
import { ingestSource } from "../services/intelligence/source";
import { analyzeBook,targetedRevision,intelligenceState } from "../services/intelligence/queue";

const router:IRouter=Router();
router.use("/admin/intelligence",signedIn,adminOnly);
router.get("/admin/intelligence/books/:bookId",async(req,res)=>{
  res.json(GetBookIntelligenceResponse.parse(await intelligenceState(parseId(req.params.bookId))));
});
router.post("/admin/intelligence/books/:bookId/sources",async(req,res)=>{
  const bookId=parseId(req.params.bookId);
  const input=IngestBookSourceBody.parse(req.body);
  const source=await ingestSource(bookId,input);
  await pool.query("INSERT INTO editorial_audit(user_id,action,target_id,details)VALUES($1,'ingest_source',$2,$3)",[readerId(req),bookId,JSON.stringify({sourceId:source.id,checksum:source.checksum})]);
  res.json({success:true,message:`Source version ${source.source_version} stored with a verified SHA-256 checksum. No analysis or media generation has started.`});
});
router.post("/admin/intelligence/books/:bookId/actions",async(req,res)=>{
  const bookId=parseId(req.params.bookId);
  const input=RunIntelligenceActionBody.parse(req.body);
  if(input.operation==="analyze_book")await analyzeBook(bookId,input.sourceId);
  else {
    if(!input.analysisId)fail(400,"Analysis ID is required for targeted revisions");
    await targetedRevision(bookId,input.operation,input.analysisId,input.targetId);
  }
  await pool.query("INSERT INTO editorial_audit(user_id,action,target_id,details)VALUES($1,$2,$3,$4)",[readerId(req),`intelligence_${input.operation}`,bookId,JSON.stringify(input)]);
  res.json({success:true,message:"Validated text analysis queued. No image, audio or video generation is performed."});
});
export default router;