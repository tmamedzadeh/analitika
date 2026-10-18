import { readServerEnv, requireServerEnv } from "./env";

export function getAppConfig() {
  const env = readServerEnv();
  const chatModel = requireServerEnv("GEMINI_CHAT_MODEL");

  return {
    analyticsModel: chatModel,
    osintModel: chatModel,
    lightModel: requireServerEnv("GEMINI_LIGHT_MODEL"),
    embeddingModel: requireServerEnv("GEMINI_EMBED_MODEL"),
    embeddingDimensions: 768 as const,
    searchProvider: env.SEARCH_PROVIDER,
    enableRerank: env.ENABLE_RERANK === "true",
  };
}
