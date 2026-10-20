import { z } from "zod";

export const OSINT_LANGUAGES = ["fa", "hy", "ru", "zh", "en", "fr", "ka", "az"] as const;
export const OSINT_PERIODS = ["24h", "7d", "30d", "all"] as const;
export const OSINT_SEARCH_CALL_BUDGET = 24;

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
  fa: "\u0641\u0627\u0631\u0633\u06cc",
  hy: "\u0540\u0561\u0575\u0565\u0580\u0565\u0576",
  ru: "\u0420\u0443\u0441\u0441\u043a\u0438\u0439",
  zh: "\u4e2d\u6587",
  en: "English",
  fr: "Fran\u00e7ais",
  ka: "\u10e5\u10d0\u10e0\u10d7\u10e3\u10da\u10d8",
  az: "Az\u0259rbaycanca",
};

export const osintLanguageLocale: Record<OsintLanguage, { language: string; country: string }> = {
  fa: { language: "FA", country: "IR" },
  hy: { language: "AM", country: "AM" },
  ru: { language: "RU", country: "RU" },
  zh: { language: "CN", country: "CN" },
  en: { language: "US", country: "US" },
  fr: { language: "FR", country: "FR" },
  ka: { language: "GE", country: "GE" },
  az: { language: "AZ", country: "AZ" },
};
