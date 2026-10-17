export const departments = ["İdarə 1", "İdarə 2", "İdarə 3", "İdarə 4", "İdarə 5"] as const;

export type Department = (typeof departments)[number];
