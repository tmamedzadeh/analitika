import { createFileRoute } from "@tanstack/react-router";

import { handleAnalyticsSearchRequest } from "@/server/analytics/endpoint";

export const Route = createFileRoute("/api/analytics/search")({
  server: {
    handlers: {
      POST: async ({ request }) => handleAnalyticsSearchRequest(request),
    },
  },
});
