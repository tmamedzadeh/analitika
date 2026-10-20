import { OSINT_LANGUAGES, osintLanguageNames, type OsintLanguage } from "./osint";

const supportedLanguages: ReadonlySet<string> = new Set(OSINT_LANGUAGES);

export function originalSourceLanguage(value: string | null | undefined): OsintLanguage | null {
  if (!value) return null;
  const language = value.trim().toLowerCase().replaceAll("_", "-").split("-")[0];
  return language && supportedLanguages.has(language) ? (language as OsintLanguage) : null;
}

export function originalSourceLanguageLabel(value: string | null | undefined): string | null {
  const language = originalSourceLanguage(value);
  return language ? osintLanguageNames[language] : null;
}

export function detectedPageLanguage(
  htmlLanguage: string | null | undefined,
  openGraphLocale: string | null | undefined,
): OsintLanguage | null {
  return originalSourceLanguage(htmlLanguage) ?? originalSourceLanguage(openGraphLocale);
}
