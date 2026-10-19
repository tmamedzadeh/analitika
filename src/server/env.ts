import process from "node:process";
import { config as loadDotEnv } from "dotenv";
import { z } from "zod";

loadDotEnv({ path: ".env.local" });
loadDotEnv({ path: ".env" });

const optionalValue = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);
export const serverEnvSchema = z.object({
  DATABASE_URL: optionalValue,
  DATABASE_POOL_MAX: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().min(1).max(50).default(3),
  ),
  GOOGLE_GENERATIVE_AI_API_KEY: optionalValue,
  AI_CHAT_MODEL: optionalValue,
  AI_LIGHT_MODEL: optionalValue,
  GEMINI_EMBED_MODEL: optionalValue,
  ANALYTICS_THINKING_LEVEL: z.enum(["low", "medium", "high"]).default("medium"),
  EXA_API_KEY: optionalValue,
  TAVILY_API_KEY: optionalValue,
  HASDATA_API_KEY: optionalValue,
  HASDATA_MODE: z.enum(["light", "full"]).default("light"),
  OSINT_MAX_SEARCH_REQUESTS: z.coerce.number().int().min(1).max(24).default(24),
  OSINT_MMR_LAMBDA: z.coerce.number().min(0).max(1).default(0.7),
  OSINT_RELEVANCE_THRESHOLD: z.coerce.number().min(0).max(1).default(0.18),
  SEARCH_PROVIDER: z.enum(["exa", "gemini_grounding"]).default("exa"),
  S3_ENDPOINT: optionalValue,
  S3_REGION: optionalValue,
  S3_ACCESS_KEY_ID: optionalValue,
  S3_SECRET_ACCESS_KEY: optionalValue,
  S3_BUCKET: optionalValue,
  INNGEST_EVENT_KEY: optionalValue,
  INNGEST_SIGNING_KEY: optionalValue,
  ENABLE_RERANK: z.enum(["true", "false"]).default("false"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function readServerEnv(): ServerEnv {
  const result = serverEnvSchema.safeParse(process.env);
  if (!result.success) {
    const fields = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter(Boolean)
      .join(", ");
    throw new Error("Invalid server environment configuration: " + fields);
  }
  return result.data;
}

export function requireServerEnv<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = readServerEnv()[key];
  if (value === undefined || value === "") {
    throw new Error("Missing required environment variable: " + key);
  }
  return value as NonNullable<ServerEnv[K]>;
}
