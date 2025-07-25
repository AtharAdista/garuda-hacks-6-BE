const AI_API_URL = process.env.AI_API_URL || "http://127.0.0.1:3434";

export class MatchSummaryService {
  static async summary(payload: any): Promise<string> {
    const response = await fetch(`${AI_API_URL}/match-summary`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to get match summary from AI service");
    }
    const data = await response.json();
    return data.feedback;
  }
}
