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
import { historyResolvers, historySignals, filters } from "./phase-2b-services";
import "../../src/styles.css";

let stream: ReadableStreamDefaultController<Uint8Array>;
let releaseRoute: (() => void) | undefined;
const signals: AbortSignal[] = [];
window.fetch = async (input, init) => {
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
  phase2b: {
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
  component: () => (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  ),
});
const analytics = createRoute({
  getParentRoute: () => root,
  path: "/axtaris",
  component: Analytics,
});
const home = createRoute({
  getParentRoute: () => root,
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
  routeTree: root.addChildren([analytics, home]),
  history: createMemoryHistory({ initialEntries: ["/axtaris"] }),
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
