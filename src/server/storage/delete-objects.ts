export async function deleteObjectsBestEffort(
  keys: readonly string[],
  remove: (key: string) => Promise<void>,
): Promise<boolean> {
  // Database records are already committed; the orphan sweep retries failed object deletions.
  const results = await Promise.allSettled(
    keys.map((key) => Promise.resolve().then(() => remove(key))),
  );
  const failedCount = results.filter((result) => result.status === "rejected").length;
  if (failedCount > 0) {
    console.warn("Storage cleanup incomplete after record deletion.", {
      objectCount: keys.length,
      failedCount,
    });
  }
  return failedCount > 0;
}
