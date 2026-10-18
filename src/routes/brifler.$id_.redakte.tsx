import { createFileRoute, Link } from "@tanstack/react-router";

import { BriefEditor } from "@/components/BriefEditor";
import { Button } from "@/components/ui/button";
import { getBrief } from "@/lib/briefs.functions";
import { briefHead } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/brifler/$id_/redakte")({
  loader: ({ params }) => getBrief({ data: { briefId: params.id } }),
  head: () => briefHead(az.briefs.editTitle, az.briefs.description),
  component: EditBrief,
});

function EditBrief() {
  const data = Route.useLoaderData();
  if (data?.brief) return <BriefEditor existing={data.brief} />;
  return (
    <div className="p-8">
      {az.briefs.missing}{" "}
      <Button asChild variant="link" className="p-0">
        <Link to="/">{az.briefs.backToList}</Link>
      </Button>
    </div>
  );
}
