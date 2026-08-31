import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import sourceFilesRouter from "./sourceFiles";

const router: IRouter = Router();

router.use(healthRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(sourceFilesRouter);

export default router;
