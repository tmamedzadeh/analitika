export type ModelFallback = {
  fromModel: string;
  toModel: string;
  reason: "quota" | "unavailable";
  backup: boolean;
};

export function modelDisplayName(model: string): string {
  return model
    .replace(/^gemini-/, "Gemini ")
    .replace(/-flash-lite$/, " Flash-Lite")
    .replace(/-flash$/, " Flash");
}
