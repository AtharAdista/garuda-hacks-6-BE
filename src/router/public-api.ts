import express from "express"
import { UserController } from "../controller/user-controller";

export const publicApi = express.Router();

publicApi.post("/api/authentication/register", UserController.register)
publicApi.post("/api/authentication/login", UserController.login)

