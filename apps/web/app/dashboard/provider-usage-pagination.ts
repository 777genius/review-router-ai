import { useState } from "react";
import { normalizeUsageFilters } from "./provider-usage-api";
import type { UsageFilters } from "./provider-usage-model";

export type UsagePageCursor = "after" | "runAfter" | "coverageAfter";

/** Each independently paged list retains its cursor; changing filters resets all. */
export function useUsagePagination(initialFilters: UsageFilters) {
  const [{ filters, cursorHistory }, setSelection] = useState(() => ({
    filters: normalizeUsageFilters(initialFilters),
    cursorHistory: {
      after: [] as (string | undefined)[],
      runAfter: [] as (string | undefined)[],
      coverageAfter: [] as (string | undefined)[],
    },
  }));
  const applyFilters = (changes: Partial<UsageFilters>) =>
    setSelection((current) => ({
      filters: normalizeUsageFilters({
        ...current.filters,
        ...changes,
        after: undefined,
        runAfter: undefined,
        coverageAfter: undefined,
      }),
      cursorHistory: { after: [], runAfter: [], coverageAfter: [] },
    }));
  const nextPage = (key: UsagePageCursor, cursor: string | null) => {
    if (!cursor) return;
    setSelection((current) => ({
      filters: { ...current.filters, [key]: cursor },
      cursorHistory: {
        ...current.cursorHistory,
        [key]: [...current.cursorHistory[key], current.filters[key]],
      },
    }));
  };
  const previousPage = (key: UsagePageCursor) => {
    setSelection((current) => {
      const history = current.cursorHistory[key];
      if (!history.length) return current;
      return {
        filters: normalizeUsageFilters({
          ...current.filters,
          [key]: history.at(-1),
        }),
        cursorHistory: {
          ...current.cursorHistory,
          [key]: history.slice(0, -1),
        },
      };
    });
  };
  return { filters, cursorHistory, applyFilters, nextPage, previousPage };
}
