/**
 * Construye el contexto que se enviará al modelo
 */
export function buildContext({
  sessionMemory = {},
  contextFiles = [],
  history = [],
  modelConfig = {}
}) {

  // 🧠 memoria estructurada resumida
  const memoryBlock = {
    projectGoal: sessionMemory.projectGoal || "",
    characters: sessionMemory.characters || [],
    style: sessionMemory.styleBible || [],
    constraints: sessionMemory.constraints || [],
    world: sessionMemory.worldRules || []
  };

  // 📁 contexto de archivos (ligero, no pesado)
  const filesBlock = contextFiles.map(f => ({
    role: f.role,
    summary: f.summary || f.fileName || "",
    type: f.mimeType || ""
  }));

  // 💬 últimos mensajes (solo relevantes)
  const recentHistory = history
    .slice(-6)
    .map(m => ({
      role: m.role,
      content: m.content
    }));

  return {
    model: {
      id: modelConfig.id,
      provider: modelConfig.provider,
      mode: modelConfig.mode
    },
    memory: memoryBlock,
    contextFiles: filesBlock,
    history: recentHistory
  };
}