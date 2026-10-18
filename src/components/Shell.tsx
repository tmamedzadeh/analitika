import { Link, useRouterState } from "@tanstack/react-router";
import {
  Search,
  Globe,
  MessageSquareText,
  FileText,
  SlidersHorizontal,
  PanelsTopLeft,
  LogOut,
} from "lucide-react";
import { type ReactNode } from "react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { az } from "@/lib/i18n/az";

const nav = [
  { to: "/", icon: PanelsTopLeft, label: az.navigation.dailyBriefs },
  { to: "/axtaris", icon: Search, label: az.navigation.analyticsSearch },
  { to: "/osint", icon: Globe, label: az.navigation.osint },
  { to: "/senedler", icon: FileText, label: az.navigation.documents },
  { to: "/sorgu", icon: MessageSquareText, label: az.navigation.requests },
  { to: "/ayarlar", icon: SlidersHorizontal, label: az.navigation.settings },
] as const;

function LogoutAction({ iconOnly = false }: { iconOnly?: boolean }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label={az.actions.logout}
          className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-lg border border-border bg-card px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/20 hover:bg-accent hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:px-3"
        >
          <LogOut size={16} aria-hidden="true" />
          <span className={iconOnly ? "sr-only" : "hidden sm:inline"}>{az.actions.logout}</span>
        </button>
      </DialogTrigger>
      <DialogContent className="rounded-2xl border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{az.actions.logoutManagedTitle}</DialogTitle>
          <DialogDescription className="pt-2 leading-6">
            {az.actions.logoutManagedDescription}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{az.actions.close}</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Shell({
  crumb,
  title,
  badges = [],
  actions,
  children,
}: {
  crumb: string;
  title: string;
  badges?: string[];
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-x-5 gap-y-4 border-b border-border pb-5 md:mb-8">
        <div className="min-w-0 flex-1">
          {crumb !== title && (
            <p className="mb-1 text-xs font-semibold tracking-[0.1em] text-muted-foreground">
              {crumb}
            </p>
          )}
          <h1 className="text-[1.55rem] font-semibold leading-tight tracking-[-0.025em] text-foreground sm:text-3xl">
            {title}
          </h1>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          {badges.map((badge) => (
            <span
              key={badge}
              className="inline-flex min-h-8 items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"
            >
              {badge}
            </span>
          ))}
          {actions}
        </div>
      </header>
      <div>{children}</div>
    </>
  );
}

function navItemIsActive(pathname: string, to: (typeof nav)[number]["to"]): boolean {
  if (to === "/") return pathname === "/" || pathname.startsWith("/brifler/");
  if (to === "/senedler") return pathname === to || pathname.startsWith(`${to}/`);
  if (to === "/sorgu") return pathname === to || pathname.startsWith(`${to}/`);
  return pathname === to;
}

export function ShellLayout({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return (
    <div className="min-h-screen md:flex">
      <aside className="flex w-full flex-col border-b border-border bg-card px-4 py-3 md:min-h-screen md:w-58 md:shrink-0 md:border-b-0 md:border-r md:px-5 md:py-6">
        <div className="flex items-center justify-between gap-3 md:flex-col md:justify-start md:gap-0">
          <Link to="/" className="flex min-w-0 items-center gap-2 md:flex-col md:gap-3">
            <img
              src="/logo.png"
              alt="ZİRVƏ"
              className="block w-19.5 shrink-0 rounded-md bg-white object-contain md:w-30"
            />
            <span className="text-[10px] font-semibold leading-[1.45] tracking-[0.14em] text-muted-foreground md:text-center md:text-[11px]">
              VAHİD ANALİTİK
              <br />
              PLATFORMA
            </span>
          </Link>
        </div>

        <nav
          aria-label={az.navigation.primary}
          className="mt-4 flex gap-1 overflow-x-auto pb-1 md:mt-7 md:block md:space-y-1.5 md:overflow-visible md:pb-0"
        >
          {nav.map(({ to, icon: Icon, label }) => {
            const active = navItemIsActive(pathname, to);
            return (
              <Link
                key={to}
                to={to}
                aria-label={label}
                title={label}
                className={
                  "flex h-10 min-w-max items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 md:h-11 md:w-full md:min-w-0 md:gap-3 md:px-3.5 " +
                  (active ? "bg-accent text-primary" : "text-muted-foreground")
                }
                aria-current={active ? "page" : undefined}
              >
                <Icon size={18} className="shrink-0" aria-hidden="true" />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto hidden md:block">
          <div className="mt-5 flex items-center gap-3 border-t border-border pt-5">
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold">{az.actions.user}</span>
            </span>
            <span className="ml-auto">
              <LogoutAction iconOnly />
            </span>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 md:px-9 md:py-8">{children}</main>
    </div>
  );
}
