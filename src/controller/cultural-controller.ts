import { NextFunction, Request, Response } from "express";
import { CulturalService } from "../service/cultural-service";
import {
  CulturalMediaResponse,
  StreamStatusMessage,
  StreamErrorMessage,
  StreamCompleteMessage,
} from "../model/cultural-model";

export class CulturalController {
  static async streamCulturalData(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      CulturalController.setupSSEHeaders(res);

      let itemsStreamed = 0;
      const maxItems = 10;
      let connectionClosed = false;

      CulturalController.handleClientDisconnect(req, () => {
        connectionClosed = true;
      });

      console.log("Starting SSE stream for cultural data");

      CulturalController.sendInitialStatusMessage(res);

      await CulturalController.streamCulturalItems(
        res,
        maxItems,
        () => connectionClosed,
        (count: number) => {
          itemsStreamed = count;
        }
      );

      if (!connectionClosed) {
        CulturalController.sendCompletionMessage(res, itemsStreamed);
        console.log(`SSE stream completed. Total items: ${itemsStreamed}`);
      }
    } catch (error) {
      CulturalController.handleStreamError(res, error);
    } finally {
      if (!res.headersSent) {
        res.end();
      }
    }
  }

  private static setupSSEHeaders(res: Response): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Cache-Control",
    });
  }

  private static handleClientDisconnect(
    req: Request,
    onDisconnect: () => void
  ): void {
    req.on("close", () => {
      onDisconnect();
      console.log("SSE client disconnected");
    });
  }

  private static sendInitialStatusMessage(res: Response): void {
    const startMessage: StreamStatusMessage = {
      type: "status",
      message: "Starting cultural data stream",
      timestamp: new Date().toISOString(),
    };
    res.write(`data: ${JSON.stringify(startMessage)}\n\n`);
  }

  private static async streamCulturalItems(
    res: Response,
    maxItems: number,
    isConnectionClosed: () => boolean,
    updateItemsStreamed: (count: number) => void
  ): Promise<void> {
    let itemsStreamed = 0;

    for (let i = 1; i <= maxItems; i++) {
      if (isConnectionClosed()) break;

      try {
        console.log(`Fetching cultural media item ${i}/${maxItems}`);
        const result = await CulturalService.fetchCulturalMedia(i);

        if (isConnectionClosed()) break;

        const streamItem = CulturalController.transformCulturalData(result);
        res.write(`data: ${JSON.stringify(streamItem)}\n\n`);

        itemsStreamed++;
        console.log(
          `Streamed item ${i}: ${result.province} - ${result.cultural_category}`
        );

        if (i < maxItems && !isConnectionClosed()) {
          await CulturalController.delay(2000);
        }
      } catch (error) {
        if (isConnectionClosed()) break;
        CulturalController.sendItemError(res, i, error);
      }
    }

    updateItemsStreamed(itemsStreamed);
  }

  private static transformCulturalData(
    result: CulturalMediaResponse
  ): CulturalMediaResponse {
    return {
      province: result.province,
      media_type: result.media_type,
      media_url: result.media_url,
      cultural_category: result.cultural_category,
      query: result.query,
      cultural_context: result.cultural_context || result.query,
    };
  }

  private static sendItemError(
    res: Response,
    itemNumber: number,
    error: unknown
  ): void {
    console.error(`Error fetching item ${itemNumber}:`, error);

    const errorData: StreamErrorMessage = {
      detail: `Failed to load cultural data item ${itemNumber}: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
    };
    res.write(`data: ${JSON.stringify(errorData)}\n\n`);
  }

  private static sendCompletionMessage(
    res: Response,
    totalItems: number
  ): void {
    const completionMessage: StreamCompleteMessage = {
      message: "Stream completed",
      total: totalItems,
    };
    res.write(
      `event: complete\ndata: ${JSON.stringify(completionMessage)}\n\n`
    );
  }

  private static handleStreamError(res: Response, error: unknown): void {
    console.error("SSE endpoint error:", error);
    if (!res.headersSent) {
      const errorData: StreamErrorMessage = {
        detail: "Internal server error occurred while streaming cultural data",
      };
      res.write(`data: ${JSON.stringify(errorData)}\n\n`);
    }
  }

  private static delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
