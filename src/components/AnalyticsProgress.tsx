import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import type { AnalyticsProgressStage } from "@/lib/analytics";
import { az } from "@/lib/i18n/az";

/** Operational milestones only; never estimates model completion or exposes reasoning. */
export function AnalyticsProgress({
  stage,
  sourceOnly,
}: {
  stage: AnalyticsProgressStage;
  sourceOnly: boolean;
}) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(
      () => setSeconds(Math.floor((performance.now() - started) / 1000)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const stages = sourceOnly
    ? (["retrieval", "sources"] as const)
    : (["retrieval", "sources", "generation", "validation"] as const);
  const current = stages.findIndex((item) => item === stage);
  return (
    <div className="analytics-progress" data-stage={stage}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" aria-live="polite" className="text-sm font-medium">
          {az.analytics.progress[stage]}
        </p>
        <span className="label-mono tabular-nums" aria-hidden="true">
          {az.analytics.timing.replace("{seconds}", String(seconds))}
        </span>
      </div>
      <ol aria-label={az.analytics.progress.label} className="analytics-progress-steps">
        {stages.map((item, index) => (
          <li
            key={item}
            data-state={index < current ? "complete" : index === current ? "active" : "pending"}
            aria-current={index === current ? "step" : undefined}
          >
            <span className="analytics-progress-dot" aria-hidden="true">
              {index < current ? <Check size={12} /> : index + 1}
            </span>
            <span>{az.analytics.progress[item]}</span>
          </li>
        ))}
      </ol>
      {!sourceOnly && (
        <p className="mt-4 text-xs text-muted-foreground">{az.analytics.progress.validatedOnly}</p>
      )}
    </div>
  );
}
