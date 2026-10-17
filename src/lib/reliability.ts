import { az } from "./i18n/az";

export const sourceReliabilityValues = ["A", "B", "C", "D", "E", "F"] as const;
export type SourceReliability = (typeof sourceReliabilityValues)[number];
export const sourceReliabilityLabels = az.reliability.source;
export const sourceReliability = sourceReliabilityValues.map(
  (value) => value + " · " + sourceReliabilityLabels[value],
);

export const infoCredibilityValues = [1, 2, 3, 4, 5, 6] as const;
export type InfoCredibility = (typeof infoCredibilityValues)[number];
export const infoCredibilityLabels = az.reliability.information;
export const infoReliability = infoCredibilityValues.map(
  (value) => value + " · " + infoCredibilityLabels[value],
);

export const defaultSourceReliability: SourceReliability = "F";
export const defaultInfoCredibility: InfoCredibility = 6;

export function isLowReliability(
  sourceReliability: SourceReliability | null | undefined,
  infoCredibility: InfoCredibility | null | undefined,
): boolean {
  return (
    sourceReliability === "D" ||
    sourceReliability === "E" ||
    infoCredibility === 4 ||
    infoCredibility === 5
  );
}
