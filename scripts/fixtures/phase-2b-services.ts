import { directionIds } from "../../src/lib/directions";

export const historyResolvers = new Map<string, (value: unknown) => void>();
export const historySignals: AbortSignal[] = [];
export const filters = {
  period: "7d",
  directionIds: [...directionIds],
  minSourceReliability: "all",
  minInfoCredibility: "all",
};
export async function listRecentAnalyticsQueries() {
  return ["A", "B"].map((id) => ({
    id,
    query: `Sintetik sorğu ${id}`,
    status: "done",
    durationMs: 100,
    createdAt: "2026-10-22T08:00:00Z",
  }));
}
export function getAnalyticsQueryHistory({
  data,
  signal,
}: {
  data: { id: string };
  signal: AbortSignal;
}) {
  historySignals.push(signal);
  // Deliberately ignore abort: the UI must also reject stale completions.
  return new Promise((resolve) => historyResolvers.set(data.id, resolve));
}
export async function getSettingsIdentity() {
  return { id: "synthetic", username: "Test analitik", role: "user" };
}
