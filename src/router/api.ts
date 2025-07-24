import express from "express";
import { authenticateToken } from "../middleware/auth-middleware";
import { UserController } from "../controller/user-controller";

export const apiRouter = express.Router();
apiRouter.use(authenticateToken);

apiRouter.get("/api/user/current", UserController.get);
