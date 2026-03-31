import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import inboxRouter from "./inbox";
import mailRouter from "./mail";
import aliasesRouter from "./aliases";
import incomingRouter from "./incoming";
import adminRouter from "./admin";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(inboxRouter);
router.use(mailRouter);
router.use(aliasesRouter);
router.use(incomingRouter);
router.use(adminRouter);

export default router;
