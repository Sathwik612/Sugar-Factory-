import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import sourceFilesRouter from "./sourceFiles";
import authRouter from "./auth";
import dailyOperationsRouter from "./dailyOperations";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(sourceFilesRouter);
router.use(dailyOperationsRouter);

export default router;
