import { CulturalMediaResponse } from "../model/cultural-model";
import "dotenv/config";

export class CulturalService {
  private static readonly AI_SERVICE_URL = `${process.env.AI_API_URL}/scrape/cultural-media`;
  private static readonly AI_SERVICE_TIMEOUT = 45000;

  static async fetchCulturalMedia(id: number): Promise<CulturalMediaResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.AI_SERVICE_TIMEOUT
    );

    try {
      console.log(`Starting AI service call ${id}`);

      const response = await fetch(this.AI_SERVICE_URL, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(
          `AI service call ${id} failed with status ${response.status}: ${errorText}`
        );
        throw new Error(
          `AI service returned ${response.status}: ${
            errorText || "Unknown error"
          }`
        );
      }

      const data = await response.json();

      this.validateCulturalMediaResponse(data, id);

      console.log(
        `AI service call ${id} completed successfully: ${data.province} - ${data.cultural_category}`
      );

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      console.error(`AI service call ${id} failed:`, error);

      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `AI service call ${id} timed out after ${
            this.AI_SERVICE_TIMEOUT / 1000
          } seconds`
        );
      }

      throw new Error(
        `AI service call ${id} failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  private static validateCulturalMediaResponse(data: any, id: number): void {
    const requiredFields = [
      "province",
      "media_type",
      "media_url",
      "cultural_category",
    ];
    const missingFields = requiredFields.filter((field) => !data[field]);

    if (missingFields.length > 0) {
      console.error(`AI service call ${id} returned incomplete data:`, data);
      throw new Error(
        `AI service returned incomplete data - missing required fields: ${missingFields.join(
          ", "
        )}`
      );
    }
  }
}
