import { Router, type IRouter } from "express";
import healthRouter from "./health";
import readerRouter from "./reader";
import adminRouter from "./admin";
import mediaRouter from "./media";

const router: IRouter = Router();

router.use(healthRouter);
router.use(readerRouter);
router.use(adminRouter);
router.use(mediaRouter);

export default router;
