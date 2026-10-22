"use client";
import { dashboardSectionHref } from "./dashboard-section";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchProviderUsage, providerUsageKey } from "./provider-usage-api";
import {
  type ProviderUsageReport,
  type UsageFilters,
} from "./provider-usage-model";
export function ProviderUsageView({
  workspaceId,
  initialReport,
}: {
  workspaceId: string;
  initialReport: ProviderUsageReport;
}) {
  const [filters, setFilters] = useState<UsageFilters>({
    from: initialReport.from,
    to: initialReport.to,
  });
  const queryClient = useQueryClient();
  useEffect(() => {
    queryClient.removeQueries({
      predicate: (q) =>
        q.queryKey[0] === "provider-usage" && q.queryKey[1] !== workspaceId,
    });
  }, [workspaceId, queryClient]);
  const report = useQuery({
    queryKey: providerUsageKey(workspaceId, filters),
    queryFn: ({ signal }) => fetchProviderUsage(workspaceId, filters, signal),
    initialData:
      filters.from === initialReport.from &&
      filters.to === initialReport.to &&
      Object.keys(filters).length === 2
        ? initialReport
        : undefined,
    staleTime: 30_000,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.unknown > 0 || d.partial > 0) ? 30_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const data = report.data;
  return (
    <section aria-label="Provider usage" className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold">Provider usage</h2>
        <p className="text-sm text-slate-400">
          UTC interval, inclusive start and exclusive end. Known usage is not a
          provider billing statement.
        </p>
      </header>
      <div className="flex flex-wrap gap-3">
        <label>
          Route{" "}
          <select
            aria-label="Usage route"
            value={filters.route ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                after: undefined,
                route: (e.target.value as UsageFilters["route"]) || undefined,
              }))
            }
          >
            <option value="">All routes</option>
            <option value="gateway">Gateway</option>
            <option value="direct">Direct</option>
          </select>
        </label>
        <label>
          Purpose{" "}
          <select
            aria-label="Usage purpose"
            value={filters.purpose ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                after: undefined,
                purpose:
                  (e.target.value as UsageFilters["purpose"]) || undefined,
              }))
            }
          >
            <option value="">All purposes</option>
            <option value="review">Review</option>
            <option value="diagnostic">Diagnostic</option>
          </select>
        </label>
        <label>
          From{" "}
          <input
            aria-label="Usage from"
            type="date"
            value={filters.from?.slice(0, 10) ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                after: undefined,
                from: e.target.value + "T00:00:00.000Z",
              }))
            }
          />
        </label>
        <label>
          To (exclusive){" "}
          <input
            aria-label="Usage to"
            type="date"
            value={filters.to?.slice(0, 10) ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                after: undefined,
                to: e.target.value + "T00:00:00.000Z",
              }))
            }
          />
        </label>
        <label>
          Provider{" "}
          <input
            aria-label="Usage provider"
            value={filters.provider ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                provider: e.target.value || undefined,
                after: undefined,
              }))
            }
          />
        </label>
        <label>
          Binding{" "}
          <input
            aria-label="Usage binding"
            value={filters.bindingId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                bindingId: e.target.value || undefined,
                after: undefined,
              }))
            }
          />
        </label>
        <label>
          Run{" "}
          <input
            aria-label="Usage run"
            value={filters.runId ?? ""}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                runId: e.target.value || undefined,
                after: undefined,
              }))
            }
          />
        </label>
        <button type="button" onClick={() => void report.refetch()}>
          Refresh
        </button>
      </div>
      {report.isError ? (
        <p role="alert">
          Usage report unavailable. Your access is checked for every request.
        </p>
      ) : null}
      {data ? (
        <>
          <p>
            {data.attempts} measured attempts · {data.logicalRuns} logical runs
            · {data.unknown} unknown · {data.partial} partial ·{" "}
            {data.unboundedSummaries} separate reported summaries
          </p>
          <p className="text-sm text-slate-400">
            Source as of {data.asOf ?? "unknown"} · All reported source windows
            from {data.coveredFrom ?? "unknown"} · Source lag: {data.sourceLag}{" "}
            ·{" "}
            <a
              className="underline"
              href={dashboardSectionHref("setup", workspaceId)}
            >
              Account limits are shown in Accounts
            </a>{" "}
            · Unattributed observations: {data.unattributed ?? "unknown"}
          </p>
          <ul aria-label="Producer delivery coverage">
            {data.deliveryCoverage.map((source) => (
              <li key={source.invocationId}>
                Runtime delivery:{" "}
                {source.coverage
                  ? `partial (${source.coverage.reason}, ${source.coverage.droppedEvents} dropped events)`
                  : "unknown (no producer coverage report)"}
              </li>
            ))}
          </ul>
          <ul aria-label="Usage source coverage">
            {data.sources.map((source) => (
              <li key={source.sourceInstance}>
                Native source coverage from {source.coveredFrom}; as of{" "}
                {source.asOf ?? "unknown"}; lag{" "}
                {source.lagMs === null ? "unknown" : `${source.lagMs}ms`} ·{" "}
                {source.deadLetteredAt
                  ? `dead letter since ${source.deadLetteredAt}`
                  : source.nextAttemptAt
                    ? `retry at ${source.nextAttemptAt}`
                    : "reconciled"}
                {source.lastErrorCode
                  ? ` · last source error: ${source.lastErrorCode}`
                  : ""}
              </li>
            ))}
            <li>
              Direct runtime source coverage:{" "}
              {data.rows.some((r) => r.route === "direct")
                ? "reported observations only; transport completeness varies"
                : "unknown"}
            </li>
          </ul>
          {data.rows.length === 0 &&
          data.attempts === 0 &&
          data.totals.reportedSummaries === 0 ? (
            <p>
              Telemetry unavailable for this interval. No measured usage is
              available.
            </p>
          ) : (
            <>
              <p>
                Period known token subtotal:{" "}
                {data.totals.tokens.total?.toLocaleString() ?? "unknown"}{" "}
                {data.totals.unknownTokenValues > 0
                  ? "(known part; some usage is unknown)"
                  : ""}
              </p>
              <p>
                Period known cost:{" "}
                {data.totals.costs
                  .map((c) => `${c.amount} ${c.currency} (${c.basis})`)
                  .join(" · ") || "unknown"}
                {data.totals.unknownCostCount > 0 ? " · incomplete" : ""}
              </p>
              <p>
                Diagnostics: {data.totals.diagnosticCount} observations in this
                period
              </p>
              <details>
                <summary>Provider, model and UTC day totals</summary>
                <div className="overflow-x-auto">
                  <table
                    aria-label="Usage grouped totals"
                    className="w-full text-left text-sm"
                  >
                    <thead>
                      <tr>
                        <th>Provider / model group (requested fallback)</th>
                        <th>Day (UTC)</th>
                        <th>Known tokens</th>
                        <th>Known cost</th>
                        <th>Unknown / partial</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.groups.map((group) => (
                        <tr
                          key={JSON.stringify([
                            group.provider,
                            group.model,
                            group.day,
                          ])}
                        >
                          <td>
                            {group.provider} / {group.model ?? "unknown"}
                          </td>
                          <td>{group.day}</td>
                          <td>{group.totals.tokens.total ?? "unknown"}</td>
                          <td>
                            {group.totals.costs
                              .map(
                                (cost) =>
                                  `${cost.amount} ${cost.currency} (${cost.basis})`,
                              )
                              .join(" · ") || "unknown"}
                          </td>
                          <td>
                            {group.totals.unknownCount} /{" "}
                            {group.totals.partialCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="overflow-x-auto">
                <table
                  aria-label="Usage observations"
                  className="w-full text-left text-sm"
                >
                  <thead>
                    <tr>
                      {[
                        "Day (UTC)",
                        "Requested / observed provider and model",
                        "Route / purpose",
                        "Tokens",
                        "Cost / basis",
                        "Coverage / authority",
                        "Latency / TTFT",
                      ].map((h) => (
                        <th key={h} className="border-b px-2 py-3">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="border-b px-2 py-3">{row.day}</td>
                        <td>
                          Requested: {row.requestedProvider ?? row.provider} /{" "}
                          {(row.requestedModel === undefined
                            ? row.model
                            : row.requestedModel) ?? "unknown"}
                          <br />
                          Observed: {row.actualProvider ?? "unknown"} /{" "}
                          {row.actualModel ?? "unknown"}
                        </td>
                        <td>
                          {row.route} / {row.purpose}
                        </td>
                        <td>
                          {row.total ?? "unknown"} ({row.granularity})
                        </td>
                        <td>
                          {row.cost
                            ? `${row.cost.amount} ${row.cost.currency} (${row.cost.basis})`
                            : "unknown"}
                        </td>
                        <td>
                          {row.completeness} / {row.authority ?? "unavailable"}
                        </td>
                        <td>
                          {row.durationMs ?? "unknown"} /{" "}
                          {row.ttftMs ?? "unknown"} ms
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {data.hasMore ? (
            <p>
              Showing up to 100 observations; totals cover the entire selected
              period.{" "}
              <button
                type="button"
                onClick={() =>
                  setFilters((f) => ({
                    ...f,
                    after: data.nextCursor ?? undefined,
                  }))
                }
              >
                Next page
              </button>
            </p>
          ) : null}
        </>
      ) : (
        <p>Loading usage…</p>
      )}
    </section>
  );
}
