import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRoute,
  createRouter,
  createBrowserHistory,
  RouterProvider,
  Outlet,
} from "@tanstack/react-router";
import { DailyBriefs } from "../../src/routes/_app.index";
import { DocumentLibrary } from "../../src/routes/_app.senedler";
import { Analytics } from "../../src/routes/_app.axtaris";
import { BriefEditor } from "../../src/components/BriefEditor";
import { ShellLayout } from "../../src/components/Shell";
import { calls } from "./unified-services";
import { Route as DocumentCreate } from "../../src/routes/_app.senedler_.yeni";
import { Route as DocumentDetail } from "../../src/routes/_app.senedler_.$id";
import { Route as BriefDetail } from "../../src/routes/_app.brifler.$id";
import { Route as BriefEdit } from "../../src/routes/_app.brifler.$id_.redakte";
import "../../src/styles.css";
const root = createRootRoute({
  component: () => (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  ),
});
const app = createRoute({ getParentRoute: () => root, id: "_app", component: Outlet });
const brief = createRoute({ getParentRoute: () => app, path: "/", component: DailyBriefs });
const documents = createRoute({
  getParentRoute: () => app,
  path: "/senedler",
  component: DocumentLibrary,
});
const analytics = createRoute({
  getParentRoute: () => app,
  path: "/axtaris",
  component: Analytics,
});
const editor = createRoute({
  getParentRoute: () => app,
  path: "/brifler/yeni",
  component: () => <BriefEditor />,
});
const router = createRouter({
  routeTree: root.addChildren([
    app.addChildren([
      brief,
      documents,
      analytics,
      editor,
      DocumentCreate.update({
        id: "/senedler_/yeni",
        path: "/senedler/yeni",
        getParentRoute: () => app,
      } as never),
      DocumentDetail.update({
        id: "/senedler_/$id",
        path: "/senedler/$id",
        getParentRoute: () => app,
      } as never),
      BriefDetail.update({
        id: "/brifler/$id",
        path: "/brifler/$id",
        getParentRoute: () => app,
      } as never),
      BriefEdit.update({
        id: "/brifler/$id_/redakte",
        path: "/brifler/$id/redakte",
        getParentRoute: () => app,
      } as never),
    ]),
  ]),
  history: createBrowserHistory(),
});
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
Object.assign(window, { unified: { calls } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <RouterProvider router={router} />
  </QueryClientProvider>,
);
