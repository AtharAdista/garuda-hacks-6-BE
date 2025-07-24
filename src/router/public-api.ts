import express from "express";
import { UserController } from "../controller/user-controller";
import { CulturalController } from "../controller/cultural-controller";

export const publicApi = express.Router();

publicApi.post("/api/authentication/register", UserController.register);
publicApi.post("/api/authentication/login", UserController.login);
publicApi.get(
  "/api/stream-data-questions",
  CulturalController.streamCulturalData
);
