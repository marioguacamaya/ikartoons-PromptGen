import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Actualiza memoria estructurada de la sesión
 */
export async function updateMemory({
  userMessage,
  assistantMessage,
  currentMemory = {}
}) {
  const system = `
You extract structured memory from conversations for a prompt engineering system.

Update ONLY if new useful info appears.

Return STRICT JSON:

{
  "projectGoal": "",
  "characters": [],
  "styleBible": [],
  "worldRules": [],
  "constraints": []
}

Rules:
- Do NOT invent
- Do NOT duplicate existing info
- Keep concise
- Only extract meaningful persistent data
`;

  try {
    const res = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `
CURRENT MEMORY:
${JSON.stringify(currentMemory)}

USER:
${userMessage}

ASSISTANT:
${assistantMessage}
`
        }
      ]
    });

    const raw = res.choices?.[0]?.message?.content || "";

    let parsed;
    try {
      const cleaned = raw.replace(/```json|```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return currentMemory;
    }

    return {
      projectGoal: parsed.projectGoal || currentMemory.projectGoal || "",
      characters: mergeUnique(currentMemory.characters, parsed.characters),
      styleBible: mergeUnique(currentMemory.styleBible, parsed.styleBible),
      worldRules: mergeUnique(currentMemory.worldRules, parsed.worldRules),
      constraints: mergeUnique(currentMemory.constraints, parsed.constraints)
    };

  } catch (err) {
    console.error("Memory update error:", err);
    return currentMemory;
  }
}

/**
 * evita duplicados
 */
function mergeUnique(oldArr = [], newArr = []) {
  const set = new Set([...(oldArr || []), ...(newArr || [])]);
  return Array.from(set);
}