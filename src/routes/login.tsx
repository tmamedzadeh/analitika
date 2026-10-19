import { createFileRoute } from "@tanstack/react-router";
import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState, type FormEvent } from "react";

import { ZirveLoader } from "@/components/ZirveLoader";
import { az } from "@/lib/i18n/az";

export const Route = createFileRoute("/login")({ component: LoginPage });

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const redirect = new URLSearchParams(window.location.search).get("redirect");
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, password, redirect }),
      });
      if (response.status === 429) {
        setError(az.auth.rateLimited);
        return;
      }
      if (!response.ok) {
        setError(response.status === 401 ? az.auth.invalidCredentials : az.auth.networkError);
        return;
      }
      const result = (await response.json()) as { redirect?: string };
      window.location.replace(result.redirect || "/");
    } catch {
      setError(az.auth.networkError);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10 sm:px-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-48 left-1/2 h-96 w-96 -translate-x-1/2 rounded-full bg-accent/80 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.28] [background-image:linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" />
      </div>

      <section className="relative w-full max-w-md">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img
            src="/logo.png"
            alt="ZİRVƏ"
            className="block w-19.5 shrink-0 rounded-md object-contain md:w-30"
          />
          <span className="text-[10px] font-semibold leading-[1.45] tracking-[0.14em] text-muted-foreground md:text-center md:text-[11px]">
            VAHİD ANALİTİK
            <br />
            PLATFORMA
          </span>
        </div>

        <div className="panel panel-glow rounded-3xl p-6 shadow-xl shadow-primary/5 sm:p-9">
          <div className="mb-7">
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              <LockKeyhole size={14} aria-hidden="true" /> Təhlükəsiz giriş
            </p>
          </div>

          <form onSubmit={(event) => void submit(event)} className="space-y-5">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{az.auth.username}</span>
              <input
                className="field h-12"
                name="username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                maxLength={100}
                required
                disabled={pending}
              />
            </label>

            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">{az.auth.password}</span>
              <span className="relative block">
                <input
                  className="field h-12 pr-12"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  maxLength={256}
                  required
                  disabled={pending}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 grid w-12 place-items-center rounded-r-xl text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={showPassword ? az.auth.hidePassword : az.auth.showPassword}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  {showPassword ? (
                    <EyeOff size={18} aria-hidden="true" />
                  ) : (
                    <Eye size={18} aria-hidden="true" />
                  )}
                </button>
              </span>
            </label>

            <div className="mt-1" aria-live="polite">
              {error && (
                <p
                  role="alert"
                  className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                >
                  {error}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={pending || !username.trim() || !password}
              aria-busy={pending}
              className="glow inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-70"
            >
              {pending ? (
                <>
                  <ZirveLoader variant="button" label={az.auth.signingIn} />
                  {az.auth.signingIn}
                </>
              ) : (
                az.auth.signIn
              )}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
