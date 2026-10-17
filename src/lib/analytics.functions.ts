import { createServerFn } from "@tanstack/react-start";

import { getAnalyticsOptions as getServerAnalyticsOptions } from "@/server/analytics/search";

export const getAnalyticsOptions = createServerFn({ method: "GET" }).handler(async () => {
  return getServerAnalyticsOptions();
});
