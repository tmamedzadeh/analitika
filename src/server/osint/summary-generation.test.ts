import { describe, expect, it } from "vitest";

import type { SourceSummary } from "./reports";
import { generateSummaryBatches } from "./summary-generation";

function summary(number: number): SourceSummary {
  return {
    number,
    title: `Bakı mövzusu ${number}`,
    summary: `Mənbə ${number} barədə qısa məlumat verilir.`,
    claims: [],
    entities: [],
    eventDate: null,
    publicationDate: null,
    quote: null,
    relevance: "direct",
  };
}

describe("partial OSINT summary batches", () => {
  it("keeps successful rows, retries only missing rows, and never exceeds two attempts per source", async () => {
    const sources = Array.from({ length: 12 }, (_, index) => ({ number: index + 1 }));
    const attempted: number[][] = [];
    const initialGroups: number[][] = [];
    const retryGroups: number[][] = [];
    let active = 0;
    let maximumActive = 0;

    const result = await generateSummaryBatches(sources, async (batch, stronger) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      attempted.push(batch.map((source) => source.number));
      if (stronger) retryGroups.push(batch.map((source) => source.number));
      else initialGroups.push(batch.map((source) => source.number));
      await Promise.resolve();
      active -= 1;
      const missing = batch.filter((source) =>
        stronger ? source.number === 8 : source.number % 4 === 0,
      );
      return {
        summaries: batch
          .filter((source) => !missing.includes(source))
          .map((source) => summary(source.number)),
        failures: new Map(missing.map((source) => [source.number, "language" as const])),
      };
    });

    expect(initialGroups).toHaveLength(3);
    expect(attempted).toHaveLength(6);
    expect(attempted.every((group) => group.length >= 1 && group.length <= 5)).toBe(true);
    expect(maximumActive).toBeLessThanOrEqual(3);
    expect(retryGroups).toEqual([[4], [8], [12]]);
    expect(result.summaries.size).toBe(11);
    expect(result.summaries.has(1)).toBe(true);
    expect(result.summaries.has(4)).toBe(true);
    expect(result.summaries.has(8)).toBe(false);
    expect([...result.failures.keys()]).toEqual([8]);
    expect([...result.attempts.values()].every((attemptCount) => attemptCount <= 2)).toBe(true);
    expect(result.attempts.get(1)).toBe(1);
    expect(result.attempts.get(4)).toBe(2);
  });

  it("retains a valid item when the neighboring item fails", async () => {
    const result = await generateSummaryBatches(
      [{ number: 1 }, { number: 2 }],
      async (batch, stronger) => ({
        summaries: batch
          .filter((source) => source.number === 1 || stronger)
          .map((source) => summary(source.number)),
        failures: new Map(
          batch
            .filter((source) => source.number === 2)
            .map((source) => [source.number, "schema" as const]),
        ),
      }),
    );
    expect(result.summaries.has(1)).toBe(true);
    expect(result.attempts.get(1)).toBe(1);
    expect(result.attempts.get(2)).toBe(2);
  });
});
