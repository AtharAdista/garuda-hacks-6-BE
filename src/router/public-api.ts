import express from "express";
import { UserController } from "../controller/user-controller";
import { CulturalController } from "../controller/cultural-controller";
import { ChatbotController } from "../controller/chatbot-controller";
import { MatchSummaryController } from "../controller/match-summary-controller";


export const publicApi = express.Router();

// Auth
publicApi.post("/api/authentication/register", UserController.register);
publicApi.post("/api/authentication/login", UserController.login);

// Get Game Data
publicApi.get(
  "/api/stream-data-questions",
  CulturalController.streamCulturalData
);
// Encyclopedia chatbot
publicApi.post("/chatbot/ask", ChatbotController.ask);
publicApi.post("/chatbot/auto-greet", ChatbotController.autoGreet);

publicApi.post("/match-summary", MatchSummaryController.summary);
