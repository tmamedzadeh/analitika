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
  return { id: "synthetic", username: "Test analitik", role: "admin", clearance: "special" };
}

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
const pending = new Map<string, Pending[]>();
export function request(name: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const queue = pending.get(name) ?? [];
    queue.push({ resolve, reject });
    pending.set(name, queue);
  });
}
export const fixtureTransport = {
  count: (name: string) => pending.get(name)?.length ?? 0,
  finish({ name, value, error }: { name: string; value?: unknown; error?: string }) {
    const item = pending.get(name)?.shift();
    if (!item) throw new Error(`No pending synthetic request: ${name}`);
    if (error) item.reject(new Error(error));
    else item.resolve(value);
  },
};
export const listBriefs = () => request("briefs");
export const listDocuments = () => request("documents");
export const listManagedUsers = () => request("users");
export const changeOwnPassword = () => request("password");
export const createManagedUser = () => request("createUser");
export const resetManagedUserPassword = () => request("resetPassword");
export const updateManagedUserActive = () => request("active");
export const updateManagedUserClearance = () => request("clearance");
export const retryDocumentIndexing = () => request("indexing");
