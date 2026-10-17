import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/Shell";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Analitika üzrə axtarış" },
      { name: "description", content: "Sənədlər üzrə mənbəli analitik axtarış və sintez." },
      { property: "og:title", content: "Analitika üzrə axtarış" },
      { property: "og:description", content: "Sənədlər üzrə mənbəli analitik axtarış və sintez." },
    ],
  }),
  component: Analytics,
});

const filters = ["Dövr: son 12 ay", "İdarə", "Teqlər"];
const sources = [
  {
    meta: "[Bölmə] · [Tarix] · [Müəllif]",
    quote: "«[Fraqmentdən qısa sitat]»",
    btn: "Sənədi aç · 2 şəkil",
  },
  { meta: "[Cədvəl] · [Tarix] · [Müəllif]", quote: "«[Cədvəldən sətir]»", btn: "Sənədi aç" },
  { meta: "[Bölmə] · [Tarix] · [Müəllif]", quote: "", btn: "Sənədi aç" },
];

function Analytics() {
  const [active, setActive] = useState(0);
  return (
    <Shell
      crumb="Analitika"
      title="Analitika üzrə axtarış"
      badges={["Sistem aktivdir", "Model: Gemini / Analitika"]}
    >
      <form
        onSubmit={(e) => e.preventDefault()}
        className="panel panel-glow flex flex-col gap-3 p-5 sm:flex-row"
      >
        <input className="field" placeholder="Sualınızı Azərbaycan dilində yazın" />
        <button className="glow rounded-xl bg-primary px-7 py-3 font-semibold text-primary-foreground">
          Axtar
        </button>
      </form>
      <div className="mt-6 flex flex-wrap gap-2">
        {filters.map((f, i) => (
          <button
            key={f}
            onClick={() => setActive(i)}
            className={`pill ${i === active ? "pill-active" : ""}`}
          >
            {f}
          </button>
        ))}
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_352px]">
        <section className="panel h-fit p-6">
          <div className="flex justify-between">
            <span className="label-mono !text-primary">Sintez</span>
            <span className="label-mono">[x.x s] · 3 mənbə</span>
          </div>
          <p className="mt-4">
            [Qısa xülasə yalnız tapılmış fraqmentlər əsasında.]<span className="cite">1</span>
          </p>
          <p className="mt-4">
            [İkinci əsas fikir, sənədlərdən birbaşa.]<span className="cite">2</span>
            <span className="cite">3</span>
          </p>
          <p className="mt-4 text-muted-foreground">
            [Məlumat çatışmırsa: «Mənbələrdə məlumat tapılmadı».]
          </p>
          <div className="mt-5 flex flex-wrap gap-2 border-t border-border pt-4">
            <button className="pill">Yalnız fraqmentləri göstər</button>
            <button className="pill">Yenidən yarat</button>
          </div>
        </section>
        <aside>
          <p className="label-mono mb-3">Mənbələr</p>
          <div className="space-y-3">
            {sources.map((s, i) => (
              <div key={i} className="panel p-5">
                <h3 className="font-semibold">
                  <span className="cite !ml-0 mr-1">{i + 1}</span>[Sənəd başlığı]
                </h3>
                <p className="label-mono mt-2">{s.meta}</p>
                {s.quote && <p className="mt-2 text-sm">{s.quote}</p>}
                <button className="pill mt-3">{s.btn}</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
