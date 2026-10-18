import { serve } from "inngest/edge";

export function createSignedInngestHandler(options: Parameters<typeof serve>[0]) {
  return serve({ ...options, enableUnauthedSync: false });
}
