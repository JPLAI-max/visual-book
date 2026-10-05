import { Router, type IRouter } from "express";
import healthRouter from "./health";
import readerRouter from "./reader";
import adminRouter from "./admin";
import mediaRouter from "./media";
import intelligenceRouter from "./intelligence";
import productionRouter from "./production";

const router: IRouter = Router();

router.use(healthRouter);
router.use(readerRouter);
router.use(intelligenceRouter);
router.use(productionRouter);
router.use(adminRouter);
router.use(mediaRouter);

export default router;
