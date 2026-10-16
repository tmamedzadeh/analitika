import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Shell } from "@/components/Shell";

export const Route = createFileRoute("/osint")({
  head: () => ({
    meta: [
      { title: "OSINT: dərin axtarış" },
      { name: "description", content: "Altı dildə açıq mənbələrdə dərin axtarış və Azərbaycan dilində xülasə." },
      { property: "og:title", content: "OSINT: dərin axtarış" },
      { property: "og:description", content: "Altı dildə açıq mənbələrdə dərin axtarış və Azərbaycan dilində xülasə." },
    ],
  }),
  component: Osint,
});

const langs = ["فارسی", "Հայերեն", "Русский", "中文", "English", "Français"];
const nodes = [["EN", 70, 30], ["FR", 145, 30], ["FA", 182, 95], ["HY", 145, 160], ["RU", 70, 160], ["ZH", 32, 95]] as const;
const sources = [
  ["FA · SMİ", "[Azərbaycan dilində xülasə, 3–5 cümlə]"],
  ["HY · Analitik mərkəz", "[Azərbaycan dilində xülasə]"],
  ["RU · Rəsmi sənəd", "[Azərbaycan dilində xülasə]"],
];

function Osint() {
  const [on, setOn] = useState<boolean[]>(langs.map(() => true));
  return (
    <Shell crumb="OSINT" title="OSINT: dərin axtarış" badges={["Sistem aktivdir", "Model: Gemini / OSINT"]}>
      <form onSubmit={(e) => e.preventDefault()} className="panel panel-glow p-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <input className="field" placeholder="Sorğunu Azərbaycan dilində yazın" />
          <button className="glow whitespace-nowrap rounded-xl bg-primary px-7 py-3 font-semibold text-primary-foreground">Dərin axtarış</button>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="label-mono mr-1">Dillər</span>
          {langs.map((l, i) => (
            <button type="button" key={l} onClick={() => setOn(on.map((v, j) => (j === i ? !v : v)))} className={`pill ${on[i] ? "pill-active" : ""}`}>{l}</button>
          ))}
          <button type="button" className="pill">Dövr: 30 gün</button>
        </div>
      </form>
      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_366px]">
        <div className="space-y-6">
          <section className="panel flex flex-col items-center gap-6 p-6 sm:flex-row">
            <svg viewBox="0 0 214 190" className="w-52 shrink-0">
              <circle cx="107" cy="95" r="76" fill="none" className="stroke-muted-foreground/30" strokeDasharray="3 5" />
              {nodes.map(([, x, y]) => <line key={`${x}${y}`} x1="107" y1="95" x2={x} y2={y} className="stroke-primary/40" />)}
              {nodes.map(([n, x, y]) => (
                <g key={n}><circle cx={x} cy={y} r="16" className="fill-card stroke-violet" strokeWidth="1.5" />
                  <text x={x} y={y + 3.5} textAnchor="middle" className="fill-foreground font-mono text-[10px]">{n}</text></g>
              ))}
              <circle cx="107" cy="95" r="22" className="fill-accent stroke-primary" strokeWidth="2" />
              <text x="107" y="99" textAnchor="middle" className="fill-primary font-mono text-[10px]">AZ</text>
            </svg>
            <div className="w-full">
              <p className="label-mono !text-primary">Gedişat</p>
              <ul className="mt-3 space-y-3">
                <li className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-success" />Sorğunun tərcüməsi</li>
                <li className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-success" />6 dildə axtarış</li>
                <li><div className="flex items-center gap-3"><span className="h-2 w-2 rounded-full bg-primary" />Səhifələrin oxunması · 12 / 18</div>
                  <div className="mt-3 h-1 rounded-full bg-secondary"><div className="glow h-1 w-2/3 rounded-full bg-gradient-to-r from-primary to-violet" /></div></li>
                <li className="flex items-center gap-3 text-muted-foreground"><span className="h-2 w-2 rounded-full bg-muted-foreground/50" />Mənbə xülasələri · yekun xülasə</li>
              </ul>
            </div>
          </section>
          <section className="panel p-6">
            <p className="label-mono !text-primary">Yekun xülasə</p>
            <p className="mt-4 text-lg">[Əsas nəticələr Azərbaycan dilində.]<span className="cite">1</span><span className="cite">4</span></p>
            <p className="mt-3 text-lg">[Mənbələr arasındakı fərqlər və ziddiyyətlər.]<span className="cite">2</span><span className="cite">3</span></p>
            <p className="label-mono mt-4">Mənbələr yoxlanılmayıb · yalnız açıq mənbələr</p>
          </section>
        </div>
        <aside>
          <p className="label-mono mb-3">Mənbələr · 18</p>
          <div className="space-y-3">
            {sources.map(([m, s], i) => (
              <div key={i} className="panel p-5">
                <h3 className="font-semibold"><span className="cite !ml-0 mr-1">{i + 1}</span>[Məqalə başlığı]</h3>
                <p className="label-mono mt-2">[domain.example] · {m}</p>
                <p className="mt-2 text-sm">{s}</p>
                <button className="pill mt-3">Orijinalı aç</button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </Shell>
  );
}
