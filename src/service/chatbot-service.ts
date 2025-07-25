const AI_API_URL = process.env.AI_API_URL || "http://127.0.0.1:3434";

export class ChatbotService {
  static async ask(payload: any): Promise<string> {
    const response = await fetch(`${AI_API_URL}/chatbot/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to get response from AI chatbot");
    }
    const data = await response.json();
    return data.response;
  }

  static async autoGreet(payload: any): Promise<string> {
    const response = await fetch(`${AI_API_URL}/chatbot/auto-greet`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error("Failed to get response from AI chatbot");
    }
    const data = await response.json();
    return data.response;
  }
}
