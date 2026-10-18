import { ZirveLoader } from "@/components/ZirveLoader";
import { az } from "@/lib/i18n/az";

export function RoutePending() {
  return <ZirveLoader variant="page" label={az.loader.pageTitle} />;
}
