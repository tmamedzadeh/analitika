import { useEffect, useState } from "react";

import { az } from "@/lib/i18n/az";

type ZirveLoaderProps = {
  variant?: "inline" | "button" | "compact" | "page";
  label?: string;
  delayMs?: number;
  className?: string;
};

export function ZirveLoader({
  variant = "compact",
  label = az.loader.loading,
  delayMs = 180,
  className = "",
}: ZirveLoaderProps) {
  const [visible, setVisible] = useState(delayMs <= 0);

  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }

    setVisible(false);
    const timeout = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);

  const mark = (
    <span
      className={`zirve-loader-mark ${
        variant === "inline"
          ? "w-7"
          : variant === "button"
            ? "w-4"
            : variant === "page"
              ? "w-40 sm:w-48"
              : "w-28"
      }`}
    >
      <img src="/logo.png" alt="" aria-hidden="true" className="block h-auto w-full" />
      <span className="zirve-loader-scan" />
    </span>
  );

  if (variant === "inline") {
    return (
      <span
        aria-hidden="true"
        className={`zirve-loader-inline ${visible ? "is-visible" : ""} ${className}`.trim()}
      >
        {mark}
      </span>
    );
  }

  if (variant === "button") {
    return (
      <span aria-hidden="true" className={`zirve-loader-button ${visible ? "is-visible" : ""}`}>
        <span className="zirve-loader-button-core" />
      </span>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-hidden={!visible}
      aria-label={label}
      data-visible={visible}
      className={`zirve-loader ${variant === "page" ? "zirve-loader-page" : "zirve-loader-compact"} ${className}`.trim()}
    >
      {mark}
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

export function ZirveSkeleton({
  label = az.loader.loading,
  rows = 3,
  delayMs = 180,
  className = "",
}: {
  label?: string;
  rows?: number;
  delayMs?: number;
  className?: string;
}) {
  const [visible, setVisible] = useState(delayMs <= 0);
  useEffect(() => {
    if (delayMs <= 0) {
      setVisible(true);
      return;
    }
    const timeout = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs]);
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label}
      data-visible={visible}
      style={{ opacity: visible ? 1 : 0 }}
      className={`zirve-skeleton ${className}`.trim()}
    >
      {Array.from({ length: Math.max(1, Math.min(rows, 8)) }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`zirve-skeleton-line ${index === 0 ? "zirve-skeleton-line-heading" : ""}`}
        />
      ))}
    </div>
  );
}

/** Both labels occupy the same grid cell so pending actions keep their width. */
export function ZirveActionLabel({
  busy,
  label,
  pendingLabel,
}: {
  busy: boolean;
  label: string;
  pendingLabel: string;
}) {
  return (
    <span className="zirve-action-label">
      <span className="zirve-action-text">
        <span aria-hidden={busy} style={{ visibility: busy ? "hidden" : "visible" }}>
          {label}
        </span>
        <span aria-hidden={!busy} style={{ visibility: busy ? "visible" : "hidden" }}>
          {pendingLabel}
        </span>
      </span>
    </span>
  );
}

export function ZirveQueryIndicator({ fetching }: { fetching: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(false);
    if (!fetching) return;
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, [fetching]);
  return (
    <div className="flex min-h-8 items-center gap-2 text-xs text-muted-foreground" role="status">
      {fetching && visible && (
        <>
          <ZirveLoader variant="inline" delayMs={0} />
          {az.loader.updating}
        </>
      )}
    </div>
  );
}
