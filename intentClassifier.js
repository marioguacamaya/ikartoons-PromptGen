import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Clasifica la intención del usuario
 * @param {string} message
 * @param {Array} history (opcional)
 */
export async function classifyIntent(message, history = []) {
  try {
    const recentHistory = history
      .slice(-6)
      .map(m => `${m.role}: ${m.content}`)
      .join("\n");

    const system = `
You are an intent classifier for a professional prompt engineering system.

Classify the user input into ONE of these categories:

- conversation → general talk, questions, clarification
- generate_prompt → user wants a new prompt created
- refine_prompt → user wants to modify/improve an existing prompt

Rules:
- If user describes something to create → generate_prompt
- If user says "make it better", "change", "improve" → refine_prompt
- If unclear → conversation

Return ONLY JSON:

{
  "intent": "conversation | generate_prompt | refine_prompt",
  "confidence": 0-1
}
`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `
HISTORY:
${recentHistory || "none"}

USER MESSAGE:
${message}
`
        }
      ]
    });

    const raw = response.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return {
        intent: "conversation",
        confidence: 0
      };
    }

    if (!parsed.intent) {
      return {
        intent: "conversation",
        confidence: 0
      };
    }

    return parsed;

  } catch (err) {
    console.error("Intent classification error:", err);
    return {
      intent: "conversation",
      confidence: 0
    };
  }
}