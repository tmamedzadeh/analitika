import { createFileRoute } from "@tanstack/react-router";
import { serve } from "inngest/edge";

import { functions } from "../server/inngest/functions";
import { inngest } from "../server/inngest/client";
import { signReadOnlyGetForIntrospection } from "../server/inngest/read-only-get";

const handler = serve({ client: inngest, functions });

export const Route = createFileRoute("/api/inngest")({
  server: {
    handlers: {
      GET: async ({ request }) => handler(signReadOnlyGetForIntrospection(request)),
      POST: async ({ request }) => handler(request),
      PUT: async ({ request }) => handler(request),
    },
  },
});
