export const clearanceValues = ["open", "secret", "top_secret", "special"] as const;
export type Clearance = (typeof clearanceValues)[number];
