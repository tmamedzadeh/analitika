import { createServerFn } from "@tanstack/react-start";

import { getAnalyticsOptions as getServerAnalyticsOptions } from "@/server/analytics/search";
import { getAnalyticsHistoryRecord, listAnalyticsHistory } from "@/server/analytics/history";
import { z } from "zod";

export const getAnalyticsOptions = createServerFn({ method: "GET" }).handler(async () => {
  return getServerAnalyticsOptions();
});

export const listRecentAnalyticsQueries = createServerFn({ method: "GET" }).handler(async () =>
  listAnalyticsHistory(),
);

export const getAnalyticsQueryHistory = createServerFn({ method: "GET" })
  .validator(z.object({ id: z.string().uuid() }))
  .handler(async ({ data }) => getAnalyticsHistoryRecord(data.id));
