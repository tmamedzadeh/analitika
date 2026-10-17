import { z } from "zod";

export const departments = [
  { id: "d1", label: "İdarə 1" },
  { id: "d2", label: "İdarə 2" },
  { id: "d3", label: "İdarə 3" },
  { id: "d4", label: "İdarə 4" },
  { id: "d5", label: "İdarə 5" },
] as const;

export type DepartmentId = (typeof departments)[number]["id"];

export const departmentIds = departments.map(({ id }) => id) as [DepartmentId, ...DepartmentId[]];
export const departmentIdSchema = z.enum(departmentIds);

export function departmentLabel(value: string | null | undefined): string | null {
  return departments.find(({ id }) => id === value)?.label ?? null;
}
