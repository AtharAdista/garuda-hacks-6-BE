import { Request, Response, NextFunction } from "express";
import { MatchSummaryService } from "../service/match-summary-service";

export class MatchSummaryController {
  static async summary(req: Request, res: Response, next: NextFunction) {
    try {
      const feedback = await MatchSummaryService.summary(req.body);
      res.json({ feedback });
    } catch (error) {
      next(error);
    }
  }
}
