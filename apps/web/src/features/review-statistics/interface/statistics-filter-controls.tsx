"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, SelectField } from "@reviewrouter/ui";
import type { StatisticsFilter } from "@reviewrouter/features-review-statistics";
import {
  severities,
  severityLabels,
} from "../application/statistics-presentation";
import {
  defaultStatisticsFilter,
  statisticsFilterFromUrl,
  statisticsFilterUrl,
} from "../application/statistics-url";
import styles from "./statistics.module.css";

export function StatisticsFilterControls({
  filter,
  disabled = false,
  onChange,
}: {
  filter: StatisticsFilter;
  disabled?: boolean;
  onChange: (changes: Partial<StatisticsFilter>) => void;
}) {
  return (
    <>
      <SelectField
        name="statistics-period"
        label="Period"
        value={String(filter.days)}
        disabled={disabled}
        options={[
          { value: "7", label: "Last 7 days" },
          { value: "30", label: "Last 30 days" },
          { value: "90", label: "Last 90 days" },
        ]}
        onValueChange={(value) =>
          onChange({ days: Number(value) as StatisticsFilter["days"] })
        }
        className={styles.periodControl ?? ""}
      />
      <SelectField
        name="statistics-severity"
        label="Severity"
        value={filter.severity}
        disabled={disabled}
        options={[
          { value: "all", label: "All severities" },
          ...severities.map((value) => ({
            value,
            label: severityLabels[value],
          })),
        ]}
        onValueChange={(value) =>
          onChange({ severity: value as StatisticsFilter["severity"] })
        }
        className={styles.periodControl ?? ""}
      />
    </>
  );
}
/** Initial server-read errors have no private seed; changing a filter requests a new SSR read. */
export function StatisticsFilterRecovery({
  filter,
}: {
  filter: StatisticsFilter;
}) {
  return (
    <StatisticsFilterRecoveryState
      key={JSON.stringify([filter.days, filter.severity])}
      filter={filter}
    />
  );
}
function StatisticsFilterRecoveryState({
  filter,
}: {
  filter: StatisticsFilter;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(filter);
  const latest = useRef(filter);
  useEffect(() => {
    const pop = () => {
      const restored = statisticsFilterFromUrl(
        new URLSearchParams(window.location.search),
      );
      if (!restored) return;
      latest.current = restored;
      setCurrent(restored);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return (
    <div className={styles.controls}>
      <StatisticsFilterControls
        filter={current}
        onChange={(changes) => {
          const next = { ...latest.current, ...changes };
          latest.current = next;
          setCurrent(next);
          router.replace(statisticsFilterUrl(window.location.href, next));
        }}
      />
    </div>
  );
}
export function StatisticsInvalidFilters() {
  const router = useRouter();
  return (
    <div role="alert" className={styles.status}>
      Choose a valid statistics period and severity, or reset the filters.
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          router.replace(
            statisticsFilterUrl(window.location.href, defaultStatisticsFilter),
          )
        }
      >
        Reset statistics filters
      </Button>
    </div>
  );
}
