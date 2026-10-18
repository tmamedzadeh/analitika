import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { type ReactNode } from "react";

import { Shell } from "@/components/Shell";
import appCss from "../styles.css?url";
import { az } from "../lib/i18n/az";

function NotFoundComponent() {
  return (
    <Shell crumb={az.notFound.title} title={az.notFound.title}>
      <div className="panel flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
        <p className="text-6xl font-semibold tracking-tight text-primary">404</p>
        <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
          {az.notFound.description}
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {az.actions.home}
          </Link>
        </div>
      </div>
    </Shell>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  // Route errors may include SQL parameters or submitted content.
  void error;
  console.error("A route failed to render.");
  const router = useRouter();

  return (
    <Shell crumb={az.error.title} title={az.error.title}>
      <div className="panel flex min-h-72 flex-col items-center justify-center px-6 py-12 text-center">
        <p className="max-w-md text-sm leading-6 text-muted-foreground">{az.error.description}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            {az.actions.retry}
          </button>
          <a
            href="/"
            className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-card px-4 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            {az.actions.home}
          </a>
        </div>
      </div>
    </Shell>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
      { rel: "icon", href: "/logo.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="az" className="light">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
