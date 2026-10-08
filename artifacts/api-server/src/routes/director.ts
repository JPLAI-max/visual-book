import { Router, type IRouter } from "express";
import { signedIn, adminOnly, parseId } from "../services/access";
import { directorState } from "../services/director/state";
import { directorAction } from "../services/director/actions";
const router:IRouter=Router();
router.use("/admin/director",signedIn,adminOnly);
router.get("/admin/director/chapters/:chapterId",async(req,res)=>res.json({data:await directorState(parseId(req.params.chapterId))}));
router.post("/admin/director/chapters/:chapterId",async(req,res)=>res.json({data:await directorAction(parseId(req.params.chapterId),req.body)}));
export default router;
