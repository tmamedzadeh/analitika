import { createFileRoute } from "@tanstack/react-router";

import { BriefEditor } from "@/components/BriefEditor";
import { briefHead } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";
import { getBriefFormContext } from "@/lib/briefs.functions";

export const Route = createFileRoute("/_app/brifler/yeni")({
  loader: () => getBriefFormContext(),
  head: () => briefHead(az.briefs.addTitle, az.briefs.description),
  component: NewBrief,
});

function NewBrief() {
  return <BriefEditor formContext={Route.useLoaderData()} />;
}
