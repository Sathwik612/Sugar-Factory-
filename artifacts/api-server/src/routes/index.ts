import { Router, type IRouter } from "express";
import healthRouter from "./health";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import sourceFilesRouter from "./sourceFiles";
import authRouter from "./auth";
import dailyOperationsRouter from "./dailyOperations";
import approvalRouter from "./approval";
import usersRouter from "./users";
import auditLogsRouter from "./auditLogs";
import operationsSuiteRouter from "./operationsSuite";
import notificationsRouter from "./notifications";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(sourceFilesRouter);
router.use(dailyOperationsRouter);
router.use(approvalRouter);
router.use(usersRouter);
router.use(auditLogsRouter);
router.use(operationsSuiteRouter);
router.use(notificationsRouter);

export default router;
