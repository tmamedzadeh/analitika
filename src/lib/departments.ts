import { z } from "zod";

export const departments = [
  { id: "d1", label: "1" },
  { id: "d2", label: "2" },
  { id: "d3", label: "3" },
  { id: "d4", label: "4" },
  { id: "d5", label: "5" },
] as const;

export type DepartmentId = (typeof departments)[number]["id"];

export const departmentIds = departments.map(({ id }) => id) as [DepartmentId, ...DepartmentId[]];
export const departmentIdSchema = z.enum(departmentIds);

export function departmentLabel(value: string | null | undefined): string | null {
  return departments.find(({ id }) => id === value)?.label ?? null;
}
