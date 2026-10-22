import { createRoot } from "react-dom/client";
import { AnalyticsAnswer } from "../../src/components/AnalyticsAnswer";
import { AnalyticsSourceCard } from "../../src/components/AnalyticsSourceCard";
import { groupAnalyticsSources, type AnalyticsSourcePreview } from "../../src/lib/analytics";
import "../../src/styles.css";

// Entirely synthetic fixtures. This page never imports server modules or calls an API.
const title =
  "Sınaq materialı: uzun başlığın mobil ekranda oxunaqlılığı və analitik mənbələrin qruplaşdırılması";
const answer =
  "## Sintetik analitik cavab\n\nBirinci fakt [1]. Üçüncü fraqment üzrə nəticə [3]. Digər təsdiq [6][8]. Əlçatan olmayan istinad [9].\n\n| Dövr | Məbləğ |\n| --- | --- |\n| 2026 | 12 milyon |\n\n[Etibarsız keçid](https://untrusted.invalid/report) <script>alert(1)</script>";
const documentSources: AnalyticsSourcePreview[] = [1, 3, 6].map((n) => ({
  n,
  sourceKind: "document",
  documentId: "same-parent",
  briefId: null,
  chunkId: `document-chunk-${n}`,
  title,
  docDate: "2026-10-21",
  briefDate: null,
  direction: "OSINT",
  sectionTitle: `Bölmə ${n}: ${"uzunbölməadı".repeat(8)}`,
  quote: `Sintetik fraqment ${n}. Bu nümunə yalnız interfeys yoxlaması üçündür və real hadisə barədə məlumat deyil.`,
  classification: "open",
  sourceReliability: "B",
  infoCredibility: 3,
  isTable: false,
  attachmentCount: 0,
}));
const sources: AnalyticsSourcePreview[] = [
  ...documentSources,
  {
    ...documentSources[0]!,
    n: 8,
    sourceKind: "brief",
    chunkId: "brief-chunk-8",
    documentId: null,
    briefId: "same-parent",
    docDate: null,
    briefDate: "2026-10-20",
    sourceReliability: null,
    infoCredibility: null,
    quote: "Sintetik bülleten fraqmenti 8.",
  },
];
const groups = groupAnalyticsSources(sources);

export function AnalyticsUiFixture() {
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <h1 className="text-2xl font-semibold">Analitika komponentlərinin brauzer yoxlaması</h1>
      {["history-a", "history-b"].map((scope) => (
        <section key={scope} data-testid={scope} data-answer={answer} className="min-w-0 space-y-4">
          <div className="panel p-4 sm:p-7" data-testid={`answer-${scope}`}>
            <AnalyticsAnswer
              answer={answer}
              navigationScope={scope}
              sources={[
                ...sources.map((source) => ({ ...source, preview: source })),
                {
                  n: 9,
                  available: false,
                  preview: { ...sources[0]!, n: 9, quote: "REVOKED_PREVIEW_MARKER" },
                },
              ]}
            />
          </div>
          {groups.map((group) => (
            <AnalyticsSourceCard
              key={group.key}
              group={group}
              navigationScope={scope}
              fragmentLabel="{count} istinad edilmiş fraqment"
              openLabel={group.sourceKind}
            />
          ))}
        </section>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<AnalyticsUiFixture />);
