import { readServerEnv } from "../env";

export class ExternalAiPolicyError extends Error {
  constructor() {
    super("External AI processing is not authorized for this classification.");
    this.name = "ExternalAiPolicyError";
  }
}

export function isExternalAiClassificationAllowed(classification: string): boolean {
  const env = readServerEnv();
  const allowed = env.AI_EXTERNAL_ALLOWED_CLASSIFICATIONS.includes(classification);
  return allowed && (classification === "open" || Boolean(env.AI_EXTERNAL_POLICY_REFERENCE));
}

export function assertExternalAiClassification(classification: string): void {
  if (!isExternalAiClassificationAllowed(classification)) throw new ExternalAiPolicyError();
}
