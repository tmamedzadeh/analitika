import { z } from "zod";

export const directions = [
  { id: "HUMINT", label: "HUMINT" },
  { id: "OSINT", label: "OSINT" },
  { id: "IMINT", label: "IMINT" },
  { id: "SIGINT", label: "SIGINT" },
  { id: "CYBINT", label: "CYBINT" },
  { id: "GEOINT", label: "GEOINT" },
  { id: "MASINT", label: "MASINT" },
  { id: "TECHINT", label: "TECHINT" },
  { id: "FININT", label: "FININT" },
  { id: "TACINT_CI", label: "TACINT / CI" },
] as const;

export type DirectionId = (typeof directions)[number]["id"];

export const directionIds = directions.map(({ id }) => id) as [DirectionId, ...DirectionId[]];
export const directionIdSchema = z.enum(directionIds);

export function directionLabel(value: string | null | undefined): string | null {
  return directions.find(({ id }) => id === value)?.label ?? null;
}
