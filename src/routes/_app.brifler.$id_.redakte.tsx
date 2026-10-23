import { createFileRoute, Link } from "@tanstack/react-router";

import { BriefEditor } from "@/components/BriefEditor";
import { Button } from "@/components/ui/button";
import { getBrief, getBriefFormContext } from "@/lib/briefs.functions";
import { briefHead } from "@/lib/briefs";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/_app/brifler/$id_/redakte")({
  loader: async ({ params }) => {
    const [details, formContext] = await Promise.all([
      getBrief({ data: { briefId: params.id } }),
      getBriefFormContext(),
    ]);
    return { details, formContext };
  },
  head: () => briefHead(az.briefs.editTitle, az.briefs.description),
  component: EditBrief,
});

function EditBrief() {
  const { details: data, formContext } = Route.useLoaderData();
  if (data?.brief && data.canEdit)
    return <BriefEditor key={data.brief.id} existing={data.brief} formContext={formContext} />;
  return (
    <div className="p-8">
      {az.briefs.missing}{" "}
      <Button asChild variant="link" className="p-0">
        <Link to="/">{az.briefs.backToList}</Link>
      </Button>
    </div>
  );
}
