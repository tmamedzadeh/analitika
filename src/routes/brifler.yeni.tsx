import { createFileRoute } from "@tanstack/react-router";
import { BriefEditor } from "@/components/BriefEditor";
import { briefHead } from "@/lib/briefs";
export const Route = createFileRoute("/brifler/yeni")({ head: () => briefHead("Brif əlavə et", "Tarix, mətn və fotolarla gündəlik brif hazırlayın."), component: NewBrief });
function NewBrief() { return <BriefEditor />; }