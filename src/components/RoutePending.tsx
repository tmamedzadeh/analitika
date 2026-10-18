import { Shell } from "@/components/Shell";
import { ZirveLoader } from "@/components/ZirveLoader";
import { az } from "@/lib/i18n/az";

export function RoutePending() {
  return (
    <Shell crumb={az.loader.pageTitle} title={az.loader.pageTitle} badges={[]}>
      <ZirveLoader variant="page" />
    </Shell>
  );
}
