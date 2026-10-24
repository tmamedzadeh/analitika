import { z } from "zod";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import type { Dispatch, SetStateAction } from "react";
import { periodShape, resolvePeriod, defaultCatalogPeriod } from "./period";
import { directionIdSchema, directionIds } from "./directions";
import { reliabilityFilterShape, parseHistoryFilters, type AnalyticsFilters } from "./analytics";

export const periodSearchSchema = z.object(periodShape).superRefine((value, ctx) => {
  try {
    resolvePeriod(value);
  } catch {
    ctx.addIssue({ code: "custom", message: "Tarix intervalını yoxlayın." });
  }
});
export const ratingsSearchSchema = z.object(reliabilityFilterShape);
export const directionSearchSchema = z.union([directionIdSchema, z.literal("")]);
export const filterRouteSearchSchema = z.object({
  period: periodSearchSchema.optional().catch(undefined),
  ratings: ratingsSearchSchema.optional().catch(undefined),
  direction: directionSearchSchema.optional().catch(undefined),
  // This field also holds the UI's empty-direction draft. The API remains strict.
  filters: z.unknown().optional(),
});
export const parsePeriodSearch = (value: unknown) =>
  value === undefined
    ? defaultCatalogPeriod
    : (periodSearchSchema.safeParse(value).data ?? defaultCatalogPeriod);
export const parseRatingsSearch = (value: unknown) =>
  ratingsSearchSchema.safeParse(value).data ?? { sourceReliabilities: [], infoCredibilities: [] };
export const parseDirectionSearch = (value: unknown) =>
  directionSearchSchema.safeParse(value).data ?? "";
export function parseAnalyticsSearch(value: unknown, fallback: AnalyticsFilters): AnalyticsFilters {
  if (
    value &&
    typeof value === "object" &&
    "filterVersion" in value &&
    value.filterVersion === 2 &&
    "directionIds" in value &&
    Array.isArray(value.directionIds) &&
    value.directionIds.length === 0
  ) {
    const draft = parseHistoryFilters({ ...value, directionIds: [directionIds[0]] });
    if (draft.success) return { ...draft.data, directionIds: [] };
  }
  const parsed = parseHistoryFilters(value);
  return parsed.success ? parsed.data : fallback;
}

/** URL owns filter state, including SSR, reload and Back. Questions/answers stay out of URLs.
 * Replacement avoids a history entry per checkbox. No cursor is persisted.
 */
export function useFilterSearchState<T>(
  key: string,
  parse: (value: unknown) => T,
): [T, Dispatch<SetStateAction<T>>] {
  const search = useRouterState({ select: (state) => state.location.search }) as Record<
    string,
    unknown
  >;
  const navigate = useNavigate();
  const value = parse(search[key]);
  const setValue: Dispatch<SetStateAction<T>> = (action) => {
    void navigate({
      search: (previous) => {
        const current = previous as Record<string, unknown>;
        const next =
          typeof action === "function" ? (action as (value: T) => T)(parse(current[key])) : action;
        // Shared dynamic keys cross three route types; each route validates its search.
        return { ...current, [key]: next } as never;
      },
      replace: true,
      resetScroll: false,
    });
  };
  return [value, setValue];
}
