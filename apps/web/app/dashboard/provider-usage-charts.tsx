"use client";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { UsageCosts } from "./provider-usage-tables";
import type { ProviderUsageReport } from "./provider-usage-model";
import {
  chartNumber,
  costAxisLabel,
  compact,
  costKey,
  dayLabel,
  metricLabel,
  metricValue,
  providerColor,
  requestedModelLabel,
  utcDays,
  shortIdentity,
  type CostBucket,
  type UsageMetric,
} from "./provider-usage-format";

type Props = {
  report: ProviderUsageReport;
  metric: UsageMetric;
  bucket: CostBucket | undefined;
};
const tooltipClass =
  "max-w-80 rounded-lg border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-3 text-xs text-slate-200 shadow-xl";

export function UsageCharts({ report, metric, bucket }: Props) {
  if (!report.overview.daily.length) return null;
  if (metric === "cost" && !bucket)
    return (
      <p className="py-3 text-sm text-slate-400">
        No known costs for this period. Missing cost measurements do not mean
        zero cost.
      </p>
    );
  const providers = [
    ...new Set(report.overview.daily.map((row) => row.provider)),
  ].sort();
  const calendar = utcDays(report.from, report.to).map(({ day, partial }) => {
    const rows = report.overview.daily.filter((row) => row.day === day);
    const values = Object.fromEntries(
      providers.map((provider, i) => {
        const row = rows.find((row) => row.provider === provider);
        return [
          `provider${i}`,
          row ? chartNumber(metricValue(row.totals, metric, bucket)) : null,
        ];
      }),
    );
    return { day, partial, rows, ...values };
  });
  const top =
    metric === "cost"
      ? (report.overview.topModels.costs.find(
          (cost) => bucket && costKey(cost) === costKey(bucket),
        )?.models ?? [])
      : report.overview.topModels[metric];
  const max =
    Math.max(
      0,
      ...top.map(
        (row) => chartNumber(metricValue(row.totals, metric, bucket)) ?? 0,
      ),
    ) || 1;
  const knownValues = report.overview.daily
    .map((row) => chartNumber(metricValue(row.totals, metric, bucket)))
    .filter((value): value is number => value !== null);
  if (!knownValues.length)
    return (
      <p className="py-3 text-sm text-slate-400">
        No known{" "}
        {metric === "tokens"
          ? "token"
          : metric === "requests"
            ? "request"
            : "cost"}{" "}
        values for this period. Measurements are unavailable, not zero.
      </p>
    );
  if (knownValues.every((value) => value === 0))
    return (
      <p className="py-3 text-sm text-slate-400">
        Known {metric} values are zero for reported observations; other usage
        may be unknown.
      </p>
    );
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2.4fr)_minmax(0,1fr)]">
      <section className="min-w-0" aria-label="Daily provider usage">
        <h3 className="sr-only">Daily usage by requested provider</h3>
        <p id="usage-chart-help" className="sr-only">
          UTC daily {metric}. Focus the chart and use left and right arrows for
          values. Circles mark missing or unknown values. Daily data is also
          available in Details.
        </p>
        <div className="h-64 w-full min-w-0 sm:h-72">
          <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <BarChart
              data={calendar}
              accessibilityLayer
              aria-label="Daily usage chart"
              aria-describedby="usage-chart-help"
              margin={{ top: 14, right: 9, bottom: 5, left: 0 }}
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--rr-color-border)"
                strokeDasharray="3 3"
              />
              <XAxis
                dataKey="day"
                tickFormatter={dayLabel}
                minTickGap={28}
                tick={{ fill: "var(--rr-color-text-subtle)", fontSize: 12 }}
                axisLine={{ stroke: "var(--rr-color-border-strong)" }}
                tickLine={false}
              />
              <YAxis
                tickFormatter={metric === "cost" ? costAxisLabel : compact}
                width={48}
                tick={{ fill: "var(--rr-color-text-subtle)", fontSize: 12 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                filterNull={false}
                cursor={{ fill: "rgba(148,163,184,0.07)" }}
                content={({ active, label }) => {
                  const day = calendar.find((row) => row.day === label);
                  if (!active || !day) return null;
                  return (
                    <div
                      className={tooltipClass}
                      role="status"
                      aria-live="polite"
                    >
                      <p className="mb-2 font-medium">
                        {day.day} UTC{day.partial ? " · partial day" : ""}
                      </p>
                      {day.rows.length ? (
                        day.rows.map((row) => (
                          <p key={row.provider}>
                            {row.provider}:{" "}
                            {metricLabel(row.totals, metric, bucket)}
                            {row.totals.unknownCount || row.totals.partialCount
                              ? " · unknown or partial observations"
                              : ""}
                            {metric === "cost" && row.totals.unknownCostCount
                              ? " · some cost unknown"
                              : ""}
                          </p>
                        ))
                      ) : (
                        <p>No observations; coverage unknown</p>
                      )}
                    </div>
                  );
                }}
              />
              {providers.map((provider, i) => (
                <Bar
                  key={provider}
                  dataKey={`provider${i}`}
                  name={provider}
                  stackId="providers"
                  fill={providerColor(provider)}
                  maxBarSize={24}
                  isAnimationActive={false}
                />
              ))}
              {calendar
                .filter(
                  (day) =>
                    !day.rows.length ||
                    day.rows.some(
                      (row) => metricValue(row.totals, metric, bucket) === null,
                    ),
                )
                .map((day) => (
                  <ReferenceDot
                    key={day.day}
                    x={day.day}
                    y={0}
                    r={3}
                    fill="var(--rr-color-void)"
                    stroke="var(--rr-color-text-subtle)"
                  />
                ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <ul
          className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-300"
          aria-label="Requested provider legend"
        >
          {providers.map((provider) => (
            <li key={provider} className="flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: providerColor(provider) }}
              />
              {provider}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-slate-500">
          UTC days · ○ No observations or unknown value · Partial days at period
          boundaries
        </p>
      </section>
      <section
        className="min-w-0 border-t border-slate-700/60 pt-5 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-3"
        aria-label="Requested models chart"
      >
        <h3 className="mb-5 text-sm font-medium text-slate-100">
          {metric === "tokens"
            ? "Tokens"
            : metric === "requests"
              ? "Requests"
              : "Known cost"}{" "}
          by requested model <span className="text-slate-400">(top 3)</span>
        </h3>
        {top.length ? (
          <div className="space-y-5">
            {top.map((row) => {
              const value = chartNumber(
                metricValue(row.totals, metric, bucket),
              );
              return (
                <div
                  key={JSON.stringify([row.provider, row.requestedModel])}
                  className="min-w-0"
                >
                  {requestedModelLabel(row.requestedModel).length > 56 ? (
                    <details className="text-sm text-slate-200">
                      <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                        {shortIdentity(
                          requestedModelLabel(row.requestedModel),
                          48,
                        )}
                      </summary>
                      <p className="break-all py-2">
                        {requestedModelLabel(row.requestedModel)}
                      </p>
                    </details>
                  ) : (
                    <p className="break-words text-sm text-slate-200">
                      {requestedModelLabel(row.requestedModel)}
                    </p>
                  )}
                  <p className="mb-1 text-xs text-slate-500">{row.provider}</p>
                  <div>
                    <div className="h-6 w-full min-w-0 bg-slate-800/30">
                      <ResponsiveContainer
                        width="100%"
                        height="100%"
                        minWidth={0}
                      >
                        <BarChart
                          layout="vertical"
                          data={[{ value }]}
                          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
                          accessibilityLayer
                          aria-label={`${row.provider} / ${requestedModelLabel(row.requestedModel)}`}
                        >
                          <XAxis type="number" hide domain={[0, max]} />
                          <YAxis
                            type="category"
                            hide
                            dataKey={() => row.provider}
                          />
                          <Tooltip
                            cursor={false}
                            content={({ active }) =>
                              active ? (
                                <div
                                  className={tooltipClass}
                                  role="status"
                                  aria-live="polite"
                                >
                                  {row.provider} /{" "}
                                  {requestedModelLabel(row.requestedModel)}:{" "}
                                  {metricLabel(row.totals, metric, bucket)}
                                </div>
                              ) : null
                            }
                          />
                          <Bar
                            dataKey="value"
                            fill={providerColor(row.provider)}
                            radius={[0, 2, 2, 0]}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div
                      className="mt-2 block break-words text-right text-sm tabular-nums text-slate-100"
                      title={metricLabel(row.totals, metric, bucket)}
                    >
                      {metric === "cost" ? (
                        <UsageCosts
                          costs={row.totals.costs}
                          unknownCostCount={row.totals.unknownCostCount}
                          selectedCurrency={bucket?.currency}
                          basis={bucket?.basis}
                        />
                      ) : (
                        compact(value)
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-400">
            No measured model values for this period.
          </p>
        )}
      </section>
    </div>
  );
}

export function DailyUsageTable({
  report,
  selectedCurrency,
  bucket,
}: {
  report: ProviderUsageReport;
  selectedCurrency?: string | undefined;
  bucket?: CostBucket | undefined;
}) {
  return (
    <div className="max-w-full overflow-x-auto">
      <table
        aria-label="Daily usage data"
        className="w-full min-w-[680px] text-left text-xs"
      >
        <caption className="sr-only">
          UTC daily values. Missing days have unknown coverage.
        </caption>
        <thead className="text-slate-400">
          <tr>
            {[
              "UTC day",
              "Requested provider",
              "Known tokens",
              "Requests",
              "Known cost",
              "Status",
            ].map((label) => (
              <th
                key={label}
                scope="col"
                className="border-b border-slate-700/60 px-2 py-3 font-medium"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {utcDays(report.from, report.to).flatMap((day) => {
            const rows = report.overview.daily.filter(
              (row) => row.day === day.day,
            );
            return rows.length
              ? rows.map((row) => (
                  <tr
                    key={`${day.day}/${row.provider}`}
                    className="border-b border-slate-800/70"
                  >
                    <th scope="row" className="px-2 py-2 font-normal">
                      {day.day}
                      {day.partial ? " (partial)" : ""}
                    </th>
                    <td>{row.provider}</td>
                    <td>{metricLabel(row.totals, "tokens", undefined)}</td>
                    <td>{row.totals.providerAttempts}</td>
                    <td>
                      <UsageCosts
                        costs={row.totals.costs}
                        unknownCostCount={row.totals.unknownCostCount}
                        selectedCurrency={selectedCurrency}
                        basis={bucket?.basis}
                      />
                    </td>
                    <td>
                      {row.totals.unknownCount} unknown /{" "}
                      {row.totals.partialCount} partial
                    </td>
                  </tr>
                ))
              : [
                  <tr key={day.day} className="border-b border-slate-800/70">
                    <th scope="row" className="px-2 py-2 font-normal">
                      {day.day}
                      {day.partial ? " (partial)" : ""}
                    </th>
                    <td colSpan={5}>No observations; coverage unknown</td>
                  </tr>,
                ];
          })}
        </tbody>
      </table>
    </div>
  );
}
