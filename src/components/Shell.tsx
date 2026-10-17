import { Link } from "@tanstack/react-router";
import { Search, Globe, FileText, SlidersHorizontal, Sun, Moon } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

function ThemeToggle() {
  const [light, setLight] = useState(false);
  useEffect(() => {
    setLight(localStorage.getItem("theme") === "light");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("light", light);
  }, [light]);
  return (
    <button
      type="button"
      aria-label={light ? "Tünd tema" : "Açıq tema"}
      onClick={() => {
        const next = !light;
        localStorage.setItem("theme", next ? "light" : "dark");
        setLight(next);
      }}
      className="grid h-[52px] w-[52px] place-items-center rounded-xl border border-border text-muted-foreground transition-colors hover:text-foreground md:mt-auto"
    >
      {light ? <Moon size={20} /> : <Sun size={20} />}
    </button>
  );
}

const nav = [
  { to: "/", icon: Search, label: "Analitika" },
  { to: "/osint", icon: Globe, label: "OSINT" },
  { to: "/senedler", icon: FileText, label: "Sənədlər" },
  { to: "/ayarlar", icon: SlidersHorizontal, label: "Ayarlar" },
] as const;

export function Shell({
  crumb,
  title,
  badges,
  children,
}: {
  crumb: string;
  title: string;
  badges: string[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="flex items-center gap-3 border-b border-border px-4 py-3 md:w-[85px] md:flex-col md:border-b-0 md:border-r md:px-0 md:py-5">
        <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-primary to-violet" />
        <nav className="flex gap-2 md:mt-7 md:flex-col md:gap-3">
          {nav.map(({ to, icon: Icon, label }) => (
            <Link
              key={to}
              to={to}
              aria-label={label}
              className="grid h-[52px] w-[52px] place-items-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:text-foreground"
              activeProps={{
                className: "panel-glow !border-primary/40 bg-accent/40 !text-primary",
              }}
              activeOptions={{ exact: true }}
            >
              <Icon size={20} />
            </Link>
          ))}
          <ThemeToggle />
        </nav>
      </aside>
      <main className="flex-1 px-4 py-6 md:px-9 md:py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="label-mono">[Layihə adı] / {crumb}</p>
            <h1 className="mt-2 text-2xl font-semibold md:text-3xl">{title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            {badges.map((b, i) => (
              <span
                key={b}
                className="label-mono flex items-center gap-2 rounded-full border border-border px-3 py-1.5"
              >
                {i === 0 && <span className="h-2 w-2 rounded-full bg-primary glow" />}
                {b}
              </span>
            ))}
          </div>
        </div>
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}
