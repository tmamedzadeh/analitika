import { z } from "zod";

export const OSINT_LANGUAGES = ["fa", "hy", "ru", "zh", "en", "fr"] as const;
export const OSINT_PERIODS = ["24h", "7d", "30d", "all"] as const;
export const OSINT_SEARCH_CALL_BUDGET = 8;
export const OSINT_GEMINI_CALL_BUDGET = 10;

export const osintSearchSchema = z
  .object({
    query: z.string().trim().min(3).max(1000),
    languages: z.array(z.enum(OSINT_LANGUAGES)).min(1).max(OSINT_LANGUAGES.length),
    period: z.enum(OSINT_PERIODS),
    refresh: z.boolean().default(false),
  })
  .refine((input) => new Set(input.languages).size === input.languages.length);

export const osintRunIdSchema = z.object({ runId: z.string().uuid() });
export type OsintLanguage = (typeof OSINT_LANGUAGES)[number];
export type OsintPeriod = (typeof OSINT_PERIODS)[number];

export const osintLanguageNames: Record<OsintLanguage, string> = {
  fa: "فارسی",
  hy: "Հայերեն",
  ru: "Русский",
  zh: "中文",
  en: "English",
  fr: "Français",
};
