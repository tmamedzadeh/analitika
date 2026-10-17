import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/Shell";

export const Route = createFileRoute("/sorgu")({
  head: () => ({
    meta: [
      { title: "Məlumat sorğusu" },
      { name: "description", content: "Analitika tapılmadıqda yeni məlumat sorğusu göndərin." },
      { property: "og:title", content: "Məlumat sorğusu" },
      { property: "og:description", content: "Analitika tapılmadıqda yeni məlumat sorğusu göndərin." },
    ],
  }),
  component: Sorgu,
});

const urgency = ["Adi", "Təcili", "Çox təcili"];

const myRequests = [
  { topic: "[Sorğu mövzusu]", meta: "[İdarə] · [Tarix] · Çox təcili", status: "Gözləyir", tone: "warning", open: false },
  { topic: "[Sorğu mövzusu]", meta: "[İdarə] · [Tarix] · Təcili", status: "İcradadır", tone: "primary", open: false },
  { topic: "[Sorğu mövzusu]", meta: "[İdarə] · [Tarix] · Adi", status: "Cavablandırılıb", tone: "success", open: true },
] as const;

const toneClass: Record<string, string> = {
  warning: "border-warning/50 !text-warning",
  primary: "border-primary/50 !text-primary",
  success: "border-success/50 !text-success",
};

function Sorgu() {
  const [urg, setUrg] = useState("Adi");
  const [src, setSrc] = useState("B · Adətən etibarlı");
  const [info, setInfo] = useState("6 · Qiymətləndirilmir");
  return (
    <Shell crumb="Məlumat sorğusu" title="Məlumat sorğusu" badges={["Sistem aktivdir", "[N] açıq sorğu"]}>
      <div className="grid gap-6 lg:grid-cols-[1fr_352px]">
        <form onSubmit={(e) => e.preventDefault()} className="panel space-y-5 p-6">
          <p className="text-sm text-muted-foreground">
            Axtardığınız analitika tapılmadısa, buradan sorğu göndərin. Sorğu cavablandırıldıqdan sonra nəticə Sənədlər
            bölməsinə əlavə olunur.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">İdarə</span>
              <select className="field appearance-none">
                <option>[İdarə / şöbə seçin]</option>
              </select>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Tarix</span>
              <input className="field" placeholder="[gün.ay.il]" />
            </label>
          </div>
          <fieldset className="border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">Təcillik dərəcəsi</legend>
            <div className="flex flex-wrap gap-2">
              {urgency.map((u) => (
                <button key={u} type="button" onClick={() => setUrg(u)} className={`pill ${urg === u ? "pill-active" : ""}`}>
                  {u}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Məqsəd</span>
            <textarea rows={3} className="field" placeholder="Məlumat nə üçün lazımdır?" />
          </label>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Məlumat</span>
            <textarea rows={5} className="field" placeholder="Hansı məlumat və ya analitika lazımdır? Mövzu, dövr, əhatə." />
          </label>
          <fieldset className="border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">Mənbənin etibarlılıq dərəcəsi</legend>
            <div className="flex flex-wrap gap-2">
              {sourceReliability.map((s) => (
                <button key={s} type="button" onClick={() => setSrc(s)} className={`pill ${src === s ? "pill-active" : ""}`}>
                  {s}
                </button>
              ))}
            </div>
            <p className="label-mono mt-2">İstəyə bağlı. Mənbənin əvvəlki etibarlılığı barədə fikriniz.</p>
          </fieldset>
          <fieldset className="border-0 p-0">
            <legend className="mb-2 p-0 text-sm font-semibold">Məlumatın etibarlılıq dərəcəsi</legend>
            <div className="flex flex-wrap gap-2">
              {infoReliability.map((s) => (
                <button key={s} type="button" onClick={() => setInfo(s)} className={`pill ${info === s ? "pill-active" : ""}`}>
                  {s}
                </button>
              ))}
            </div>
            <p className="label-mono mt-2">İstəyə bağlı. Məlumatın dəqiqliyi barədə fikriniz.</p>
          </fieldset>
          <label className="block">
            <span className="mb-2 block text-sm font-semibold">Xüsusi qeyd</span>
            <textarea rows={3} className="field" placeholder="Əlavə izahat, xüsusi tələblər." />
          </label>
          <label className="block cursor-pointer rounded-xl border border-dashed border-primary/30 bg-accent/20 p-7 text-center">
            <input type="file" multiple accept=".pdf,.docx,image/jpeg,image/png,image/webp" className="hidden" />
            <p className="text-sm">Fayl və ya şəkil əlavə edin · PDF, DOCX, JPG, PNG, WebP · 10 MB-a qədər</p>
            <p className="label-mono mt-1">Əlavələr sorğu ilə birlikdə saxlanılır</p>
          </label>
          <div className="flex gap-3">
            <button className="glow rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Sorğunu göndər</button>
            <button type="reset" className="pill">Ləğv et</button>
          </div>
        </form>
        <aside>
          <p className="label-mono mb-3">Mənim sorğularım</p>
          <div className="space-y-3">
            {myRequests.map((r, i) => (
              <div key={i} className="panel p-5">
                <h3 className="font-semibold">{r.topic}</h3>
                <p className="label-mono mt-2">{r.meta}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className={`label-mono inline-flex items-center rounded-full border px-3 py-1 ${toneClass[r.tone]}`}>
                    {r.status}
                  </span>
                  {r.open && <button className="pill !py-1">Sənədi aç</button>}
                </div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
