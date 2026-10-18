import { QueryClient } from "@tanstack/react-query";
import { createRouter, rootRouteId } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { routeTree } from "@/routeTree.gen";

// Match routes without running loaders or rendering: loaders may need a server or
// network the test run lacks, and jsdom never loads the stylesheets React waits on.
describe("App routing", () => {
  it("matches a page for / instead of falling back to not found", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });

    const matches = router.matchRoutes("/");

    expect(matches.at(-1)?.routeId).not.toBe(rootRouteId);
  });

  it("keeps brief details at /brifler/:id", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(
      router.matchRoutes("/brifler/2c227f83-a225-4b68-9492-979cd1d59f13").at(-1)?.routeId,
    ).toBe("/_app/brifler/$id");
  });
  it("keeps analytics search at /axtaris", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    expect(router.matchRoutes("/axtaris").at(-1)?.routeId).toBe("/_app/axtaris");
  });

  it("matches document details as a top-level route at the existing URL", () => {
    const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
    const matches = router.matchRoutes("/senedler/2c227f83-a225-4b68-9492-979cd1d59f13");

    expect(matches.at(-1)?.routeId).toBe("/_app/senedler_/$id");
    expect(matches.some((match) => match.routeId === "/_app/senedler")).toBe(false);
  });
});
