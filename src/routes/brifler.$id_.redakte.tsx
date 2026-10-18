import { createFileRoute, Link } from "@tanstack/react-router";
import { BriefEditor } from "@/components/BriefEditor";
import { useBriefs } from "@/components/BriefsProvider";
import { briefHead } from "@/lib/briefs";
export const Route = createFileRoute("/brifler/$id_/redakte")({ head: () => briefHead("Brifi redaktə et", "Gündəlik brifin mətnini və fotolarını yeniləyin."), component: EditBrief });
function EditBrief() {
  const { id } = Route.useParams(); const { briefs } = useBriefs(); const brief = briefs.find(item => item.id === id);
  return brief ? <BriefEditor existing={brief} /> : <div className="p-8">Brif tapılmadı. <Link to="/" className="text-primary">Bütün briflər</Link></div>;
}