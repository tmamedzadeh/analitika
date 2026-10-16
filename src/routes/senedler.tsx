import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/Shell";

export const Route = createFileRoute("/senedler")({
  head: () => ({
    meta: [
      { title: "Sənəd əlavə et" },
      { name: "description", content: "Yeni sənəd əlavə edin və indeksləmə vəziyyətini izləyin." },
      { property: "og:title", content: "Sənəd əlavə et" },
      { property: "og:description", content: "Yeni sənəd əlavə edin və indeksləmə vəziyyətini izləyin." },
    ],
  }),
  component: AddDoc,
});

function AddDoc() {
  return (
    <Shell crumb="Sənədlər" title="Sənəd əlavə et" badges={["Sistem aktivdir", "İndeksləmə: fonda"]}>
      <div className="grid gap-6 lg:grid-cols-[1fr_352px]">
        <form onSubmit={(e) => e.preventDefault()} className="panel space-y-5 p-6">
          <label className="block"><span className="mb-2 block text-sm font-semibold">Başlıq</span><input className="field" placeholder="[Sənəd başlığı]" /></label>
          <label className="block"><span className="mb-2 block text-sm font-semibold">Mətn</span><textarea rows={7} className="field" placeholder="Mətni bura yapışdırın. Bölmələr üçün #, cədvəllər üçün | işarəsi." /></label>
          <div className="grid gap-4 sm:grid-cols-3">
            {[["Tarix", "[gün.ay.il]"], ["Müəllif", "[ad]"], ["Teqlər", "[teq1, teq2]"]].map(([l, p]) => (
              <label key={l} className="block"><span className="mb-2 block text-sm font-semibold">{l}</span><input className="field" placeholder={p} /></label>
            ))}
          </div>
          <label className="block cursor-pointer rounded-xl border border-dashed border-primary/30 bg-accent/20 p-7 text-center">
            <input type="file" multiple accept="image/jpeg,image/png,image/webp" className="hidden" />
            <p className="text-sm">Şəkilləri bura atın · JPG, PNG, WebP · 10 MB-a qədər · 10 ədəd</p>
            <p className="label-mono mt-1">Axtarışda iştirak etmir, yalnız mənbəyə baxarkən göstərilir</p>
          </label>
          <div className="flex gap-3">
            <button className="glow rounded-xl bg-primary px-6 py-3 font-semibold text-primary-foreground">Yadda saxla</button>
            <button type="reset" className="pill">Ləğv et</button>
          </div>
        </form>
        <aside>
          <p className="label-mono mb-3">Son sənədlər</p>
          <div className="space-y-3">
            <div className="panel p-5"><h3 className="font-semibold">[Sənəd 1]</h3><span className="label-mono mt-3 inline-block rounded-full border border-success/50 px-3 py-1 !text-success">Hazırdır · 42 bölmə</span></div>
            <div className="panel p-5"><h3 className="font-semibold">[Sənəd 2]</h3><span className="label-mono mt-3 inline-block rounded-full border border-warning/50 px-3 py-1 !text-warning">Emal olunur · vektorlar</span>
              <div className="mt-3 h-1 rounded-full bg-secondary"><div className="glow h-1 w-3/5 rounded-full bg-primary" /></div></div>
            <div className="panel p-5"><h3 className="font-semibold">[Sənəd 3]</h3><div className="mt-3 flex gap-2"><span className="label-mono inline-flex items-center rounded-full border border-destructive/50 px-3 py-1 !text-destructive">Xəta</span><button className="pill !py-1">Yenidən emal et</button></div></div>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
