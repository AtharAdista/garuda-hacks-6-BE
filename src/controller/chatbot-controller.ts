import { Request, Response, NextFunction } from "express";
import { ChatbotService } from "../service/chatbot-service";

export class ChatbotController {
  static async ask(req: Request, res: Response, next: NextFunction) {
    try {
      const response = await ChatbotService.ask(req.body);
      res.json({ response });
    } catch (error) {
      next(error);
    }
  }

  static async autoGreet(req: Request, res: Response, next: NextFunction) {
    try {
      const response = await ChatbotService.autoGreet(req.body);
      res.json({ response });
    } catch (error) {
      next(error);
    }
  }
}
