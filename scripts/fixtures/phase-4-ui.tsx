import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
  Outlet,
  Link,
} from "@tanstack/react-router";
import { Analytics } from "../../src/routes/_app.axtaris";
import { ShellLayout } from "../../src/components/Shell";
import { RoutePending } from "../../src/components/RoutePending";
import { ZirveActionLabel, ZirveSkeleton } from "../../src/components/ZirveLoader";
import {
  historyResolvers,
  historySignals,
  filters,
  fixtureTransport,
  request,
} from "./phase-4-services";
import { Route as BriefsRoute } from "../../src/routes/_app.index";
import { Route as DocumentsRoute } from "../../src/routes/_app.senedler";
import { Route as SettingsRoute } from "../../src/routes/_app.ayarlar";
import { Route as LoginRoute } from "../../src/routes/login";
import type { ComponentType } from "react";
import "../../src/styles.css";

let stream: ReadableStreamDefaultController<Uint8Array>;
let releaseRoute: (() => void) | undefined;
const signals: AbortSignal[] = [];
window.fetch = async (input, init) => {
  if (input === "/api/auth/login") {
    const result = (await request("login")) as { status: number };
    return Response.json({}, { status: result.status });
  }
  if (input !== "/api/analytics/search") throw new Error("Fixture blocked unexpected fetch");
  signals.push(init!.signal!);
  return new Response(
    new ReadableStream({
      start(controller) {
        stream = controller;
      },
    }),
  );
};
Object.assign(window, {
  phase4: {
    ...fixtureTransport,
    invalidate(name: string) {
      void client.invalidateQueries({ queryKey: [name] });
    },
    emit(event: unknown) {
      stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\r\n\r\n`));
    },
    close() {
      stream.close();
    },
    finishHistory(id: string) {
      historyResolvers.get(id)?.({
        id,
        query: `Sintetik sorğu ${id}`,
        filters,
        answer: `Sintetik cavab ${id}.`,
        status: "done",
        sources: [],
        model: "test",
        durationMs: 100,
        createdAt: "2026-10-22T08:00:00Z",
      });
    },
    aborted() {
      return [...signals, ...historySignals].filter((signal) => signal.aborted).length;
    },
    releaseRoute() {
      releaseRoute?.();
    },
  },
});
const root = createRootRoute({
  component: Outlet,
});
const layout = createRoute({
  getParentRoute: () => root,
  id: "shell",
  component: () => (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  ),
});
const analytics = createRoute({
  getParentRoute: () => layout,
  path: "/axtaris",
  component: Analytics,
});
const home = createRoute({
  getParentRoute: () => layout,
  path: "/",
  loader: () =>
    new Promise<void>((resolve) => {
      releaseRoute = resolve;
    }),
  component: () => (
    <div data-testid="loaded-route">
      <h1>Bülletenlər</h1>
      <Link to="/axtaris">Analitika</Link>
      <div className="grid gap-4 sm:grid-cols-3">
        <ZirveSkeleton delayMs={0} />
        <button className="pill" aria-busy="true">
          <ZirveActionLabel busy label="Yadda saxla" pendingLabel="Yadda saxlanılır…" />
        </button>
      </div>
    </div>
  ),
});
const router = createRouter({
  routeTree: root.addChildren([
    layout.addChildren([
      analytics,
      home,
      createRoute({
        getParentRoute: () => layout,
        path: "/briefs",
        component: BriefsRoute.options.component as ComponentType,
      }),
      createRoute({
        getParentRoute: () => layout,
        path: "/senedler",
        component: DocumentsRoute.options.component as ComponentType,
      }),
      createRoute({
        getParentRoute: () => layout,
        path: "/ayarlar",
        component: SettingsRoute.options.component as ComponentType,
      }),
    ]),
    createRoute({
      getParentRoute: () => root,
      path: "/login",
      component: LoginRoute.options.component as ComponentType,
    }),
  ]),
  history: createMemoryHistory({
    initialEntries: [new URLSearchParams(location.search).get("view") ?? "/axtaris"],
  }),
  defaultPendingMs: 250,
  defaultPendingMinMs: 0,
  defaultPendingComponent: RoutePending,
});
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
