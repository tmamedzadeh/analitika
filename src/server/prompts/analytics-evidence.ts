import { analyticsSourceGroupKey, type AnalyticsSource } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";

export const normalizedEvidenceText = (text: string) =>
  text.normalize("NFC").replace(/\s+/gu, " ").trim();

/** Shared by prompt construction and selection so all evidence metadata is budgeted. */
export function formatAnalyticsEvidence(sources: readonly AnalyticsSource[]): string {
  const materials = new Map<string, number[]>();
  for (const source of sources) {
    const key = analyticsSourceGroupKey(source);
    materials.set(key, [...(materials.get(key) ?? []), source.n]);
  }
  const textOwner = new Map<string, number>();
  return sources
    .map((source) => {
      const textKey = normalizedEvidenceText(source.text);
      const owner = textOwner.get(textKey);
      if (owner === undefined) textOwner.set(textKey, source.n);
      const materialKey = analyticsSourceGroupKey(source);
      const date =
        source.sourceKind === "brief"
          ? (source.briefDate ?? "tarix göstərilməyib")
          : (source.docDate ?? "tarix göstərilməyib");
      const section = source.sectionTitle || "bölmə göstərilməyib";
      const label = source.sourceKind === "brief" ? "Gündəlik xülasə" : "Sənəd";
      const ratings =
        source.sourceKind === "document"
          ? [
              source.sourceReliability
                ? `Mənbə etibarlılığı: ${source.sourceReliability} (${az.reliability.source[source.sourceReliability]}).`
                : null,
              source.infoCredibility
                ? `Məlumat etibarlılığı: ${source.infoCredibility} (${az.reliability.information[source.infoCredibility]}).`
                : null,
            ].filter(Boolean)
          : [];
      return [
        "[" + source.n + "] " + label + " · " + source.title + " · " + section + " · " + date,
        `Eyni ilkin materialın fraqmentləri: ${materials
          .get(materialKey)!
          .map((n) => `[${n}]`)
          .join(", ")}.`,
        ratings.length
          ? ratings.join(" ")
          : "Etibarlılıq qiymətləndirilməyib; bu, aşağı etibarlılıq demək deyil.",
        owner === undefined
          ? source.text
          : `Mətn [${owner}] fraqmenti ilə eynidir; bu uyğunluq müstəqil təsdiq demək deyil.`,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n---\n\n");
}
