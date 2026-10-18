import { createFileRoute } from "@tanstack/react-router";

import { functions } from "../server/inngest/functions";
import { inngest } from "../server/inngest/client";
import { createSignedInngestHandler } from "../server/inngest/handler";

export const inngestHandler = createSignedInngestHandler({
  client: inngest,
  functions,
});

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: async ({ request }) => inngestHandler(request),
      POST: async ({ request }) => inngestHandler(request),
      PUT: async ({ request }) => inngestHandler(request),
    },
  },
});
