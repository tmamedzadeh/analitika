import type { StoredObjectSummary } from "./types";

export function findStaleUnreferencedStorageObjects(
  candidates: readonly StoredObjectSummary[],
  referencedKeys: ReadonlySet<string>,
  now = new Date(),
): string[] {
  const cutoff = now.getTime() - 24 * 60 * 60 * 1000;
  return candidates
    .filter(({ key, lastModified }) => lastModified.getTime() <= cutoff && !referencedKeys.has(key))
    .map(({ key }) => key);
}
