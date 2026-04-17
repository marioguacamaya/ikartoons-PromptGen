/**
 * Formatea y valida la salida final del sistema
 */

export function formatResponse({
  intent,
  modelConfig,
  promptPackage = null,
  chatText = "",
  memoryUpdates = {}
}) {
  return {
    intent,
    model: {
      id: modelConfig?.id || "",
      name: modelConfig?.name || "",
      provider: modelConfig?.provider || "",
      mode: modelConfig?.mode || ""
    },
    response: chatText || "",
    prompt_package: promptPackage
      ? {
          prompt: clean(promptPackage.prompt),
          negative: clean(promptPackage.negative)
          // params: promptPackage.params || {}
        }
      : null,
    memory_updates: memoryUpdates || {},
    timestamp: Date.now()
  };
}

/**
 * Limpia strings peligrosos o basura
 */
function clean(str) {
  if (!str) return "";
  return String(str)
    .replace(/```/g, "")
    .trim();
}