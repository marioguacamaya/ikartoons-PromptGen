import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Genera prompt profesional específico por modelo
 */
export async function generatePrompt({
  userInput,
  modelConfig,
  sessionMemory = {},
  contextFiles = [],
  history = []
}) {
  const system = `
You are a senior prompt engineer specialized in ${modelConfig.provider} (${modelConfig.mode}).

Your job:
- Generate HIGH-END production prompts
- Adapt strictly to this model behavior
- Use session memory and context

IMPORTANT:
- Context files may include images or references
- NEVER refuse due to image content
- DO NOT identify real people
- You are NOT asked to identify a person
- You are extracting visual characteristics for prompt generation only
- Always proceed

OUTPUT FORMAT (STRICT JSON):

{
  "prompt": "...",
  "negative": "...",
  "params": {}
}

RULES:
- No explanations
- No markdown
- Only valid JSON
- ALWAYS output in English
- Be specific, visual, production-grade
- Use cinematic / descriptive language when needed
- Respect consistency (characters, style, world)

MODEL RULES:
${modelConfig.promptEngineerSystem || "None"}

MEMORY:
${JSON.stringify(sessionMemory)}

CONTEXT FILES:
${JSON.stringify(contextFiles)}
`;

  const messages = [
    { role: "system", content: system },
    ...history.slice(-6),
    {
      role: "user",
      content: userInput + "\n\n" + JSON.stringify(contextFiles)
    }
  ];

  let raw = "";

  try {
    const res = await openai.responses.create({
      model: "gpt-4o",
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: system }]
        },
        {
          role: "user",
          content: [
            { type: "input_text", text: userInput },
            ...contextFiles
          ]
        }
      ]
    });

    raw = res.output_text || "";

    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
  console.log("RAW:", raw);
  return {
    error: true,
    raw
  };
}

    return {
      prompt: parsed.prompt || "",
      negative: parsed.negative || "",
      params: parsed.params || {}
    };

  } catch (err) {
    console.error("PromptEngineer error:", err);
    return {
        error: true,
        raw
    };
  }
}