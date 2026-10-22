import { az } from "@/lib/i18n/az";

export function ClassificationBadge({ classification }: { classification: string }) {
  const label =
    az.documents.classification[classification as keyof typeof az.documents.classification];
  return (
    <span className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground">
      {label}
    </span>
  );
}
