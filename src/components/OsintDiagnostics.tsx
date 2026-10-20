import { az } from "@/lib/i18n/az";
import { osintLanguageNames, type OsintLanguage } from "@/lib/osint";
import type { OsintDiagnostics } from "@/server/osint/diagnostics";

const d = az.osint.diag;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3 gap-y-1">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function counts(values: Record<string, number>, label: (key: string) => string): string {
  const entries = Object.entries(values).filter(([, value]) => value > 0);
  return entries.length
    ? entries.map(([key, value]) => `${label(key)}: ${value}`).join(" · ")
    : d.none;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} ${d.seconds}`;
}

export function OsintDiagnosticsPanel({
  diagnostics,
  stageLabel,
  stepLabel,
}: {
  diagnostics: OsintDiagnostics;
  stageLabel?: string | undefined;
  stepLabel: string;
}) {
  const missing = diagnostics.summaries.missing as Record<string, number>;
  return (
    <details className="panel p-4 text-sm">
      <summary className="label-mono cursor-pointer">{d.title}</summary>
      <dl className="mt-3 space-y-2">
        <Row label={d.status}>{diagnostics.status + " · " + stepLabel}</Row>
        {stageLabel ? <Row label={d.stage}>{stageLabel}</Row> : null}
        {diagnostics.durationMs !== null ? (
          <Row label={d.duration}>{seconds(diagnostics.durationMs)}</Row>
        ) : null}
        <Row label={d.stageTimes}>
          {counts(diagnostics.stageMs, (key) => key).replace(
            /: (\d+)/g,
            (_, ms: string) => ": " + seconds(Number(ms)),
          )}
        </Row>
        <Row label={d.attempts}>
          {d.summaryAttempts}: {diagnostics.llmAttempts.summary} · {d.reportAttempts}:{" "}
          {diagnostics.llmAttempts.report}
        </Row>
        <Row label={d.errors}>
          {counts(
            diagnostics.errorClasses as Record<string, number>,
            (key) => d.errorClass[key as keyof typeof d.errorClass] ?? key,
          )}
        </Row>
        <Row label={d.providers}>
          {diagnostics.providers.length ? diagnostics.providers.join(", ") : d.none}
        </Row>
        <Row label={d.searchQueries}>{diagnostics.searchQueries}</Row>
        <Row label={d.sourcesFound}>{diagnostics.sourcesFound}</Row>
        <Row label={d.sourcesSelected}>{diagnostics.sourcesSelected}</Row>
        <Row label={d.summariesPresent}>{diagnostics.summaries.present}</Row>
        <Row label={d.summariesMissing}>
          {counts(
            missing,
            (key) =>
              az.osint.summaryStatus[key as keyof typeof az.osint.summaryStatus]?.replace(
                /\.$/,
                "",
              ) ?? key,
          )}
        </Row>
        <Row label={d.fetchStatus}>{counts(diagnostics.fetchStatus, (key) => key)}</Row>
        <Row label={d.expansionFallback}>
          {diagnostics.expansionFallbackLanguages.length
            ? diagnostics.expansionFallbackLanguages
                .map((language) => osintLanguageNames[language as OsintLanguage] ?? language)
                .join(", ")
            : d.none}
        </Row>
      </dl>
    </details>
  );
}
