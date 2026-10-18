import { createFileRoute } from "@tanstack/react-router";

import { BriefEditor } from "@/components/BriefEditor";
import { briefHead } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/brifler/yeni")({
  head: () => briefHead(az.briefs.addTitle, az.briefs.description),
  component: () => <BriefEditor />,
});
