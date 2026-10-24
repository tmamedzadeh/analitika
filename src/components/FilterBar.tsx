import type { ReactNode } from "react";

/** Shared compact wrapping surface; selected values remain visible at all widths. */
export function FilterBar({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label="Axtarış filtrləri"
      className={`filter-bar flex min-w-0 flex-wrap items-center gap-2 ${className}`}
    >
      {children}
    </section>
  );
}
