import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/button";
import { BriefCard } from "@/components/BriefCard";
import { useBriefs } from "@/components/BriefsProvider";
import { briefHead } from "@/lib/briefs";

export const Route = createFileRoute("/")({ head: () => briefHead("Gündəlik xülasələr", "Gündəlik briflər, təsdiqlənmiş xülasələr və qaralamalar."), component: DailyBriefs });
function DailyBriefs() {
  const { briefs } = useBriefs();
  const [query, setQuery] = useState("");
  const [period, setPeriod] = useState("all");
  const [month, setMonth] = useState("");
  const [limit, setLimit] = useState(6);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const monday = new Date(now); monday.setDate(now.getDate() - (now.getDay() + 6) % 7); monday.setHours(0, 0, 0, 0);
  const filtered = briefs.filter(brief => {
    if (!`${brief.title} ${brief.body}`.toLocaleLowerCase("az").includes(query.toLocaleLowerCase("az"))) return false;
    if (period === "week" && (new Date(`${brief.date}T12:00:00`) < monday || brief.date > today)) return false;
    if (period === "month" && !brief.date.startsWith(today.slice(0, 7))) return false;
    return !month || brief.date.startsWith(month);
  });
  const visible = filtered.slice(0, limit);
  return <Shell crumb="Gündəlik xülasələr" title="Gündəlik xülasələr" badges={["Sistem aktivdir"]} actions={<Button asChild size="lg" className="glow"><Link to="/brifler/yeni"><Plus />Əlavə et</Link></Button>}>
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <input className="field sm:!w-72" aria-label="Brifdə axtarın" placeholder="Brifdə axtarın" value={query} onChange={event => { setQuery(event.target.value); setLimit(6); }} />
      <div className="flex flex-wrap gap-2">{([["all", "Hamısı"], ["week", "Bu həftə"], ["month", "Bu ay"]] as const).map(([value, label]) => <Button key={value} variant={period === value ? "secondary" : "outline"} className={`rounded-full ${period === value ? "border border-primary/40 text-primary" : ""}`} aria-pressed={period === value} onClick={() => { setPeriod(value); setMonth(""); setLimit(6); }}>{label}</Button>)}</div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">Ay: <input className="field !w-40" type="month" aria-label="Ay seçin" value={month} onChange={event => { setMonth(event.target.value); setPeriod("all"); setLimit(6); }} /></label>
    </div>
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-6">{visible.map((brief, index) => <div key={brief.id} className={index === 0 ? "lg:col-span-6" : index < 4 ? "lg:col-span-2" : "lg:col-span-3"}><BriefCard brief={brief} featured={index === 0} showStatus={index >= 4 || brief.status === "draft"} /></div>)}</div>
    {!filtered.length && <p role="status" className="py-16 text-center text-muted-foreground">Brif tapılmadı.</p>}
    {filtered.length > limit && <div className="mt-5 flex justify-center"><Button variant="outline" className="rounded-full" onClick={() => setLimit(current => current + 6)}>Daha çox göstər</Button></div>}
  </Shell>;
}