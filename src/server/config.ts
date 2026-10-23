import { readServerEnv, requireServerEnv } from "./env";

export function getAppConfig() {
  const env = readServerEnv();
  const chatModel = requireServerEnv("AI_CHAT_MODEL");

  return {
    analyticsModel: chatModel,
    lightModel: env.AI_LIGHT_MODEL,
    backupModel: env.AI_BACKUP_MODEL,
    embeddingModel: requireServerEnv("GEMINI_EMBED_MODEL"),
    embeddingDimensions: 768 as const,
    analyticsThinkingLevel: env.ANALYTICS_THINKING_LEVEL,
    enableRerank: env.ENABLE_RERANK === "true",
    enableContextExpansion: env.ENABLE_CONTEXT_EXPANSION === "true",
  };
}
