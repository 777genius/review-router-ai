"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, SelectField } from "@reviewrouter/ui";
import { RefreshCw } from "lucide-react";
import {
  fetchProviderUsage,
  normalizeUsageFilters,
  ProviderUsageError,
  providerUsageKey,
} from "./provider-usage-api";
import type { ProviderUsageReport, UsageFilters } from "./provider-usage-model";
import { UsageCharts } from "./provider-usage-charts";
import { ModelUsageTable, RunUsageTable } from "./provider-usage-tables";
import { UsageDetails } from "./provider-usage-details";
import {
  valuationLabel,
  humanUtc,
  compact,
  costKey,
  costLabel,
  count,
  customInterval,
  intervalLabel,
  rollingInterval,
  type UsageMetric,
} from "./provider-usage-format";

function hasUnknownUsage(report: ProviderUsageReport): boolean {
  return (
    report.unknown > 0 ||
    report.partial > 0 ||
    report.totals.unknownCostCount > 0 ||
    report.totals.unknownTotalTokenCount > 0
  );
}

type Props = {
  workspaceId: string;
  initialReport: ProviderUsageReport;
  initialFilters: UsageFilters;
};
export function ProviderUsageView(props: Props) {
  return <ProviderUsageContext key={props.workspaceId} {...props} />;
}
function ProviderUsageContext({
  workspaceId,
  initialReport,
  initialFilters,
}: Props) {
  const [filters, setFilters] = useState(() =>
    normalizeUsageFilters(initialFilters),
  );
  const [period, setPeriod] = useState<"7" | "30" | "90" | "custom">("30");
  const [draftFrom, setDraftFrom] = useState(initialReport.from.slice(0, 10));
  const [draftTo, setDraftTo] = useState(
    new Date(Date.parse(initialReport.to) - 1).toISOString().slice(0, 10),
  );
  const [tab, setTab] = useState<"models" | "runs">("models");
  const [metric, setMetric] = useState<UsageMetric>("tokens");
  const [costSelection, setCostSelection] = useState("");
  const [currencySelection, setCurrencySelection] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  // A rejected SSR seed must remain unusable across every filter and page key.
  const [deniedSeed, setDeniedSeed] = useState<ProviderUsageReport | null>(
    null,
  );
  const denied = deniedSeed === initialReport;
  const client = useQueryClient();
  useEffect(() => {
    client.removeQueries({
      predicate: (query) =>
        query.queryKey[0] === "provider-usage" &&
        query.queryKey[1] !== workspaceId,
    });
  }, [workspaceId, client]);
  const matchesInitial =
    JSON.stringify(normalizeUsageFilters(filters)) ===
    JSON.stringify(normalizeUsageFilters(initialFilters));
  const query = useQuery({
    queryKey: denied
      ? ["provider-usage-denied", workspaceId]
      : providerUsageKey(workspaceId, filters),
    queryFn: ({ signal }) => fetchProviderUsage(workspaceId, filters, signal),
    initialData: !denied && matchesInitial ? initialReport : undefined,
    enabled: !denied,
    staleTime: 30_000,
    retry: (failureCount, error) =>
      !(
        error instanceof ProviderUsageError && [401, 403].includes(error.status)
      ) && failureCount < 2,
    refetchInterval: (query) => {
      const data = query.state.data;
      return data && hasUnknownUsage(data) ? 30_000 : false;
    },
    refetchIntervalInBackground: false,
  });
  const accessFailure =
    query.error instanceof ProviderUsageError &&
    [401, 403].includes(query.error.status);
  useEffect(() => {
    if (!accessFailure) return;
    setDeniedSeed(initialReport);
    void client
      .cancelQueries({ queryKey: ["provider-usage", workspaceId] })
      .then(() =>
        client.removeQueries({ queryKey: ["provider-usage", workspaceId] }),
      );
  }, [accessFailure, client, workspaceId, initialReport]);
  const data = denied || accessFailure ? undefined : query.data;
  const currencies = [
    ...new Set(data?.totals.costs.map((cost) => cost.currency) ?? []),
  ].sort();
  const currency = currencies.includes(currencySelection)
    ? currencySelection
    : currencies.includes("USD")
      ? "USD"
      : currencies[0];
  const buckets =
    data?.totals.costs
      .filter((cost) => cost.currency === currency)
      .sort((a, b) => costKey(a).localeCompare(costKey(b))) ?? [];
  useEffect(() => {
    if (currency && currency !== currencySelection)
      setCurrencySelection(currency);
  }, [currency, currencySelection]);
  const bucket =
    buckets.find((cost) => costKey(cost) === costSelection) ?? buckets[0];
  // Preserve the last valid bucket, including while the report is loading.
  useEffect(() => {
    if (bucket && costKey(bucket) !== costSelection)
      setCostSelection(costKey(bucket));
  }, [bucket, costSelection]);
  const applyFilters = (changes: Partial<UsageFilters>) =>
    setFilters((current) =>
      normalizeUsageFilters({
        ...current,
        ...changes,
        after: undefined,
        runAfter: undefined,
      }),
    );
  const refresh = () => {
    if (period === "custom") void query.refetch();
    else applyFilters(rollingInterval(Number(period) as 7 | 30 | 90));
  };
  const custom = customInterval(draftFrom, draftTo);
  const initialIdentity = useRef(initialReport);
  useEffect(() => {
    if (initialIdentity.current === initialReport) return;
    initialIdentity.current = initialReport;
    setFilters(normalizeUsageFilters(initialFilters));
    setPeriod("30");
    setDraftFrom(initialReport.from.slice(0, 10));
    setDraftTo(
      new Date(Date.parse(initialReport.to) - 1).toISOString().slice(0, 10),
    );
    setTab("models");
    setMetric("tokens");
    setCostSelection("");
    setCurrencySelection("");
    setDetailsOpen(false);
  }, [initialReport, initialFilters]);
  const unavailable = denied || accessFailure;
  const hasUnknown = data && hasUnknownUsage(data);
  return (
    <section aria-label="Provider usage" className="min-w-0 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-5">
        <div className="shrink-0">
          <h2 className="text-2xl font-semibold tracking-tight text-slate-100">
            Usage
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            Provider activity and token usage.
          </p>
        </div>
        <div className="grid w-full min-w-0 basis-full grid-cols-2 items-end gap-2 sm:grid-cols-3 xl:w-auto xl:max-w-4xl xl:flex-1 xl:basis-auto xl:grid-cols-[1.2fr_1fr_1.2fr_1fr_auto]">
          <SelectField
            name="usage-period"
            label="Period"
            value={period}
            disabled={unavailable}
            options={[
              { value: "7", label: "Last 7 days" },
              { value: "30", label: "Last 30 days" },
              { value: "90", label: "Last 90 days" },
              { value: "custom", label: "Custom dates" },
            ]}
            onValueChange={(value) => {
              const selected = value as typeof period;
              setPeriod(selected);
              if (selected !== "custom")
                applyFilters(rollingInterval(Number(selected) as 7 | 30 | 90));
            }}
          />
          <SelectField
            name="usage-provider"
            label="Provider"
            value={filters.provider ?? ""}
            disabled={unavailable}
            options={[
              { value: "", label: "All providers" },
              ...[
                ...new Set([
                  ...(data?.overview.facets.providers ?? []),
                  ...(filters.provider ? [filters.provider] : []),
                ]),
              ].map((value) => ({ value, label: value })),
            ]}
            onValueChange={(provider) =>
              applyFilters({
                provider: provider || undefined,
                model: undefined,
              })
            }
          />
          <SelectField
            name="usage-model"
            label="Requested model"
            value={filters.model ?? ""}
            disabled={unavailable}
            options={[
              { value: "", label: "All models" },
              ...[
                ...new Set([
                  ...(data?.overview.facets.models
                    .filter(
                      (row) =>
                        !filters.provider || row.provider === filters.provider,
                    )
                    .map((row) => row.requestedModel)
                    .filter((model): model is string => model !== null) ?? []),
                  ...(filters.model ? [filters.model] : []),
                ]),
              ]
                .sort()
                .map((value) => ({ value, label: value })),
            ]}
            onValueChange={(model) =>
              applyFilters({ model: model || undefined })
            }
          />
          <SelectField
            name="usage-route"
            label="Route"
            value={filters.route ?? ""}
            disabled={unavailable}
            options={[
              { value: "", label: "All routes" },
              { value: "gateway", label: "Gateway" },
              { value: "direct", label: "Direct" },
            ]}
            onValueChange={(route) =>
              applyFilters({
                route: (route || undefined) as UsageFilters["route"],
              })
            }
          />
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl"
            disabled={unavailable || query.isFetching}
            aria-busy={query.isFetching}
            onClick={refresh}
          >
            <RefreshCw
              className={`h-4 w-4${query.isFetching ? " animate-spin" : ""}`}
              aria-hidden="true"
            />
            <span aria-live="polite">
              {query.isFetching ? "Refreshing…" : "Refresh"}
            </span>
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p
          className="min-w-0 text-xs text-slate-400"
          title={`UTC interval [${filters.from}, ${filters.to})`}
        >
          {intervalLabel(filters.from, filters.to)}
          {period !== "custom" ? " · Current UTC day is partial" : ""}
        </p>
        <div className="w-36">
          <SelectField
            name="usage-purpose"
            label="Purpose"
            className="[&>span]:sr-only"
            value={filters.purpose ?? "review"}
            disabled={unavailable}
            options={[
              { value: "review", label: "Review" },
              { value: "diagnostic", label: "Diagnostics" },
            ]}
            onValueChange={(purpose) =>
              applyFilters({ purpose: purpose as UsageFilters["purpose"] })
            }
          />
        </div>
        {data && currencies.length > 1 ? (
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-xs text-slate-400">
              Cost currency
            </span>
            <SelectField
              name="usage-currency"
              label="Cost currency"
              className="w-24 [&>span]:sr-only"
              value={currency ?? ""}
              options={currencies.map((value) => ({ value, label: value }))}
              onValueChange={setCurrencySelection}
            />
          </div>
        ) : data && currency ? (
          <p className="text-xs text-slate-400">Cost currency: {currency}</p>
        ) : null}
        {filters.provider || filters.model || filters.route ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={unavailable}
            onClick={() =>
              applyFilters({
                provider: undefined,
                model: undefined,
                route: undefined,
              })
            }
          >
            Reset filters
          </Button>
        ) : null}
      </div>
      {period === "custom" ? (
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-700/50 pb-4">
          <label className="grid gap-1 text-xs text-slate-400">
            From (UTC)
            <input
              aria-label="Usage from"
              type="date"
              value={draftFrom}
              onChange={(event) => setDraftFrom(event.target.value)}
              className="min-h-11 min-w-0 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-slate-200 [color-scheme:dark]"
            />
          </label>
          <label className="grid gap-1 text-xs text-slate-400">
            Through (inclusive UTC)
            <input
              aria-label="Usage to"
              type="date"
              value={draftTo}
              onChange={(event) => setDraftTo(event.target.value)}
              className="min-h-11 min-w-0 rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-slate-200 [color-scheme:dark]"
            />
          </label>
          <Button
            variant="outline"
            size="sm"
            disabled={unavailable || "error" in custom}
            onClick={() => {
              if (!("error" in custom)) applyFilters(custom);
            }}
          >
            Apply dates
          </Button>
          <p
            className="basis-full break-words text-xs text-slate-400"
            role={"error" in custom ? "alert" : undefined}
          >
            {"error" in custom
              ? custom.error
              : `Preview UTC [${custom.from}, ${custom.to})`}
          </p>
        </div>
      ) : null}
      {filters.from &&
      Date.parse(filters.from) < Date.now() - 365 * 86_400_000 ? (
        <p className="text-xs text-amber-300">
          Observations are retained for 365 days. Earlier dates may be
          unavailable; missing data does not mean zero usage.
        </p>
      ) : null}
      {unavailable ? (
        <p role="alert" className="py-10 text-sm text-amber-200">
          Usage access is no longer available. Open a newly authorized workspace
          report to continue.
        </p>
      ) : !data ? (
        <p
          role={query.isError ? "alert" : "status"}
          className="py-10 text-sm text-slate-400"
        >
          {query.isError
            ? "Usage report unavailable. Try Refresh."
            : "Loading usage…"}
        </p>
      ) : (
        <>
          {query.isError ? (
            <p role="alert" className="text-sm text-amber-300">
              Refresh failed. Showing the last available report for this
              interval.
            </p>
          ) : null}
          <dl
            aria-label="Period usage summary"
            className="grid grid-cols-2 gap-y-6 md:grid-cols-4"
          >
            <Kpi
              label="Known tokens"
              value={compact(data.totals.tokens.total)}
              exact={count(data.totals.tokens.total)}
              description={
                data.totals.tokens.total === null
                  ? "No total token measurements"
                  : data.totals.unknownTotalTokenCount > 0
                    ? "Known part; some total tokens unknown"
                    : "Known token subtotal"
              }
            />
            <Kpi
              label="Provider requests"
              value={compact(data.totals.providerAttempts)}
              exact={count(data.totals.providerAttempts)}
              description="Measured requests to providers"
            />
            <Kpi
              label={filters.purpose === "diagnostic" ? "Runs" : "Review runs"}
              value={compact(data.totals.logicalRuns)}
              exact={count(data.totals.logicalRuns)}
              description="Distinct runs in this period"
            />
            <div className="min-w-0 border-l border-slate-600/60 pl-4 sm:pl-5">
              <dt className="text-sm font-medium text-slate-200">Known cost</dt>
              <dd className="mt-2 space-y-1 text-lg font-semibold tabular-nums text-slate-50">
                {buckets.length
                  ? buckets.map((cost) => (
                      <div
                        key={costKey(cost)}
                        className="break-words"
                        title={costLabel(cost)}
                      >
                        <span>
                          {cost.amount} {cost.currency}
                        </span>
                        <span className="ml-1 text-xs font-normal text-slate-400">
                          {valuationLabel(cost.basis)}
                        </span>
                      </div>
                    ))
                  : "Unknown"}
              </dd>
              <p className="mt-1 text-xs text-slate-500">
                {currency
                  ? `${currency} only · no currency conversion`
                  : "No known cost amounts"}
                {data.totals.unknownCostCount ? " · Excludes unknown cost" : ""}
              </p>
            </div>
          </dl>
          {buckets.length ? (
            <p className="text-xs text-slate-400">
              Reported is a provider-supplied valuation; Estimated is a
              calculated valuation. Neither is an invoice. Bases stay separate;
              no currency conversion.
            </p>
          ) : null}
          {!data.overview.daily.length ? (
            <p className="text-sm text-slate-400">
              No measured observations for this interval. Telemetry and coverage
              are unknown.
            </p>
          ) : null}
          <div className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div
                className="inline-flex overflow-hidden rounded-lg border border-cyan-200/20"
                role="group"
                aria-label="Usage metric"
              >
                {(["tokens", "requests", "cost"] as const).map((value) => (
                  <Button
                    key={value}
                    variant="ghost"
                    size="sm"
                    aria-pressed={metric === value}
                    className={`rounded-none border-0 border-r border-cyan-200/15 last:border-r-0 ${metric === value ? "bg-cyan-300/10 text-cyan-200" : "text-slate-400"}`}
                    onClick={() => setMetric(value)}
                  >
                    {value === "tokens"
                      ? "Tokens"
                      : value === "requests"
                        ? "Requests"
                        : "Cost"}
                  </Button>
                ))}
              </div>
              {metric === "cost" && buckets.length > 1 ? (
                <div className="w-64">
                  <SelectField
                    name="usage-cost"
                    label="Cost basis"
                    value={bucket ? costKey(bucket) : ""}
                    options={buckets.map((cost) => ({
                      value: costKey(cost),
                      label: valuationLabel(cost.basis),
                    }))}
                    onValueChange={setCostSelection}
                  />
                </div>
              ) : null}
            </div>
            <UsageCharts report={data} metric={metric} bucket={bucket} />
          </div>
          <div>
            <div
              role="tablist"
              aria-label="Usage breakdown"
              className="flex border-b border-slate-600/60"
            >
              {(["models", "runs"] as const).map((value) => (
                <button
                  key={value}
                  id={`usage-tab-${value}`}
                  type="button"
                  role="tab"
                  aria-selected={tab === value}
                  aria-controls="usage-table-panel"
                  tabIndex={tab === value ? 0 : -1}
                  className={`min-h-11 border-b-2 px-4 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300 ${tab === value ? "border-cyan-300 text-cyan-200" : "border-transparent text-slate-400"}`}
                  onClick={() => setTab(value)}
                  onKeyDown={(event) => {
                    if (
                      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                        event.key,
                      )
                    ) {
                      event.preventDefault();
                      const next =
                        event.key === "Home"
                          ? "models"
                          : event.key === "End"
                            ? "runs"
                            : value === "models"
                              ? "runs"
                              : "models";
                      setTab(next);
                      document.getElementById(`usage-tab-${next}`)?.focus();
                    }
                  }}
                >
                  {value === "models" ? "Models" : "Runs"}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id="usage-table-panel"
              aria-labelledby={`usage-tab-${tab}`}
              tabIndex={0}
            >
              {tab === "models" ? (
                <ModelUsageTable report={data} selectedCurrency={currency} />
              ) : (
                <RunUsageTable
                  report={data}
                  selectedCurrency={currency}
                  onNext={() =>
                    setFilters((current) => ({
                      ...current,
                      runAfter: data.overview.nextRunCursor ?? undefined,
                    }))
                  }
                />
              )}
            </div>
          </div>
          <details
            className="border-t border-slate-700/50 pt-3"
            open={detailsOpen}
            onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
          >
            <summary
              aria-label="Details"
              className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"
            >
              <span
                className={hasUnknown ? "text-amber-300" : "text-slate-400"}
              >
                {hasUnknown
                  ? "△ Some usage is unknown or partial"
                  : "Reported observations; coverage is not guaranteed"}
              </span>
              <span className="ml-auto text-slate-400">
                {data.asOf
                  ? `Updated ${humanUtc(data.asOf)}`
                  : "Freshness unavailable"}
              </span>
              <span className="text-cyan-200">Details ⌄</span>
            </summary>
            <div className="mt-4">
              <UsageDetails
                workspaceId={workspaceId}
                report={data}
                selectedCurrency={currency}
                bucket={metric === "cost" ? bucket : undefined}
                onNext={() =>
                  setFilters((current) => ({
                    ...current,
                    after: data.nextCursor ?? undefined,
                  }))
                }
                controls={
                  <div className="flex flex-wrap gap-3">
                    {(["bindingId", "runId"] as const).map((key) => (
                      <label key={key} className="grid gap-1">
                        {key === "bindingId" ? "Binding" : "Run"}
                        <input
                          aria-label={
                            key === "bindingId" ? "Usage binding" : "Usage run"
                          }
                          value={filters[key] ?? ""}
                          onChange={(event) =>
                            applyFilters({
                              [key]: event.target.value || undefined,
                            })
                          }
                          className="min-h-11 max-w-full rounded-lg border border-cyan-200/20 bg-slate-950 px-3 text-slate-200"
                        />
                      </label>
                    ))}
                    <p className="basis-full">
                      Unknown token field values:{" "}
                      {data.totals.unknownTokenValues}. Optional cache,
                      reasoning and timing fields may be unavailable.
                    </p>
                  </div>
                }
              />
            </div>
          </details>
        </>
      )}
    </section>
  );
}
function Kpi({
  label,
  value,
  exact,
  description,
}: {
  label: string;
  value: string;
  exact: string;
  description: string;
}) {
  return (
    <div className="min-w-0 border-l border-slate-600/60 pl-4 sm:pl-5">
      <dt className="text-sm font-medium text-slate-200">{label}</dt>
      <dd
        className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-slate-50"
        title={exact}
        aria-label={exact}
      >
        {value}
      </dd>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}
