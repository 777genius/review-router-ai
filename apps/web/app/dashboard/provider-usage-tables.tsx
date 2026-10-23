"use client";
import { useState } from "react";
import { Button } from "@reviewrouter/ui";
import type { ProviderUsageReport } from "./provider-usage-model";
import {
  currencyCostsLabel,
  count,
  providerColor,
  requestedModelLabel,
  costLabel,
  valuationLabel,
  selectedCosts,
  shortIdentity,
  humanUtcRange,
} from "./provider-usage-format";
import type { UsageTotals } from "@reviewrouter/features-provider-usage";

type ModelRow = ProviderUsageReport["overview"]["models"][number];
type RunRow = ProviderUsageReport["overview"]["runs"][number];
const cell = "px-3 py-3 align-top";
const tableClass = "w-full min-w-[780px] text-left text-xs tabular-nums";
const desktop = "hidden max-w-full overflow-x-auto @min-[56rem]:block";
const narrow = "@min-[56rem]:hidden";
function Head({ labels }: { labels: string[] }) {
  return (
    <thead>
      <tr className="border-b border-slate-600/60 text-slate-400">
        {labels.map((label) => (
          <th key={label} scope="col" className={`${cell} font-medium`}>
            {label}
          </th>
        ))}
      </tr>
    </thead>
  );
}
function Coverage({ totals }: { totals: UsageTotals }) {
  const missing =
    totals.unknownCount || totals.partialCount || totals.unknownTotalTokenCount;
  return (
    <span className={missing ? "text-amber-300" : "text-slate-400"}>
      {missing
        ? `${totals.unknownCount} unknown · ${totals.partialCount} partial${totals.unknownTotalTokenCount ? ` · ${totals.unknownTotalTokenCount} total token values unknown` : ""}`
        : "Reported observations"}
    </span>
  );
}
export function UsageCosts({
  costs,
  selectedCurrency,
  basis,
  unknownCostCount = 0,
}: {
  costs: readonly { amount: string; currency: string; basis: string }[];
  selectedCurrency?: string | undefined;
  basis?: string | undefined;
  unknownCostCount?: number | undefined;
}) {
  const values = selectedCosts(costs, selectedCurrency, basis);
  return (
    <div>
      {values.length ? (
        <div className="space-y-1">
          {values.map((cost) => (
            <p
              key={JSON.stringify([cost.currency, cost.basis])}
              className="break-words"
              title={costLabel(cost)}
            >
              <span className="font-medium text-slate-100">
                {cost.amount} {cost.currency}
              </span>{" "}
              <span
                className={
                  cost.basis === "estimated"
                    ? "font-medium text-amber-300"
                    : "font-medium text-cyan-200"
                }
              >
                {valuationLabel(cost.basis)}
              </span>
            </p>
          ))}
        </div>
      ) : (
        <span>{currencyCostsLabel(costs, selectedCurrency, basis)}</span>
      )}
      {unknownCostCount > 0 ? (
        <p className="mt-1 text-xs text-amber-300">Some cost unknown</p>
      ) : null}
    </div>
  );
}
function ModelIdentity({ row }: { row: ModelRow }) {
  const identity = `${row.provider} / ${requestedModelLabel(row.requestedModel)}`;
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <span
        className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: providerColor(row.provider) }}
      />
      <div className="min-w-0">
        <span
          className="line-clamp-2 break-words text-slate-100"
          title={identity}
        >
          {identity}
        </span>
        {identity.length > 56 ? (
          <details className="mt-1 text-xs text-slate-400">
            <summary className="min-h-9 cursor-pointer py-2 text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
              Full requested model
            </summary>
            <p className="break-all py-1">{identity}</p>
          </details>
        ) : null}
        <ModelObserved row={row} />
      </div>
    </div>
  );
}
function CompactValues({ label, values }: { label: string; values: string[] }) {
  const first = values[0] ?? "Unknown";
  if (values.length <= 1 && first.length <= 56)
    return (
      <p className="break-words text-xs text-slate-400">
        {label}: {first}
      </p>
    );
  return (
    <details className="text-xs text-slate-400">
      <summary className="min-h-9 cursor-pointer py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
        <span>
          {label}: {shortIdentity(first, 48)}
          {values.length > 1 ? ` +${values.length - 1}` : ""}
          {values.includes("Unknown") && first !== "Unknown"
            ? " · includes Unknown"
            : ""}
        </span>
      </summary>
      <div className="space-y-1 pb-2">
        {values.map((value) => (
          <p key={value} className="break-all">
            {value}
          </p>
        ))}
      </div>
    </details>
  );
}
function ModelObserved({ row }: { row: ModelRow }) {
  if (
    !row.hasUnknownObservedModel &&
    row.observedModels.length === 1 &&
    row.observedModels[0] === row.requestedModel
  )
    return null;
  return (
    <CompactValues
      label="Observed"
      values={[
        ...row.observedModels,
        ...(row.hasUnknownObservedModel ? ["Unknown"] : []),
      ]}
    />
  );
}
function KeyMetrics({
  totals,
  selectedCurrency,
}: {
  totals: UsageTotals;
  selectedCurrency?: string | undefined;
}) {
  return (
    <dl className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3 text-sm tabular-nums">
      <div>
        <dt className="text-xs text-slate-400">Requests</dt>
        <dd className="mt-1 font-medium text-slate-100">
          {count(totals.providerAttempts)}
        </dd>
      </div>
      <div>
        <dt className="text-xs text-slate-400">Known tokens</dt>
        <dd className="mt-1 font-medium text-slate-100">
          {count(totals.tokens.total)}
          {totals.tokens.total !== null && totals.unknownTotalTokenCount > 0 ? (
            <small className="mt-1 block text-xs font-normal text-amber-300">
              Known part
            </small>
          ) : null}
        </dd>
      </div>
      <div className="col-span-2 min-w-0">
        <dt className="mb-1 text-xs text-slate-400">Known cost</dt>
        <dd>
          <UsageCosts
            costs={totals.costs}
            unknownCostCount={totals.unknownCostCount}
            selectedCurrency={selectedCurrency}
          />
        </dd>
      </div>
    </dl>
  );
}
export function ModelUsageTable({
  report,
  selectedCurrency,
}: {
  report: ProviderUsageReport;
  selectedCurrency?: string | undefined;
}) {
  return (
    <div className="@container min-w-0">
      <div className={desktop}>
        <table aria-label="Requested model usage" className={tableClass}>
          <Head
            labels={[
              "Provider / requested model",
              "Route",
              "Requests",
              "Input tokens",
              "Output tokens",
              "Known cost",
              "Status",
            ]}
          />
          <tbody>
            {report.overview.models.map((row) => (
              <tr
                key={JSON.stringify([
                  row.provider,
                  row.requestedModel,
                  row.route,
                ])}
                className="border-b border-slate-700/40"
              >
                <th scope="row" className={`${cell} max-w-80 font-normal`}>
                  <ModelIdentity row={row} />
                </th>
                <td className={cell}>{row.route}</td>
                <td className={cell}>{count(row.totals.providerAttempts)}</td>
                <td className={cell}>{count(row.totals.tokens.inputTotal)}</td>
                <td className={cell}>{count(row.totals.tokens.outputTotal)}</td>
                <td className={`${cell} min-w-36`}>
                  <UsageCosts
                    costs={row.totals.costs}
                    unknownCostCount={row.totals.unknownCostCount}
                    selectedCurrency={selectedCurrency}
                  />
                </td>
                <td className={cell}>
                  <Coverage totals={row.totals} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section aria-label="Model usage summaries" className={narrow}>
        <ul aria-label="Models">
          {report.overview.models.map((row) => (
            <li
              key={JSON.stringify([
                row.provider,
                row.requestedModel,
                row.route,
              ])}
              className="border-b border-slate-700/40 py-4"
            >
              <div className="text-sm font-medium">
                <ModelIdentity row={row} />
              </div>
              <p className="mt-1 text-xs text-slate-400">{row.route}</p>
              <KeyMetrics
                totals={row.totals}
                selectedCurrency={selectedCurrency}
              />
              <details className="mt-2 text-xs text-slate-400">
                <summary className="min-h-9 cursor-pointer py-2 text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
                  Token details and status
                </summary>
                <p>
                  Input tokens: {count(row.totals.tokens.inputTotal)} · Output
                  tokens: {count(row.totals.tokens.outputTotal)}
                </p>
                <Coverage totals={row.totals} />
              </details>
            </li>
          ))}
        </ul>
      </section>
      {!report.overview.models.length ? (
        <p className="py-5 text-sm text-slate-400">
          No measured model observations for this interval.
        </p>
      ) : null}
    </div>
  );
}
function RunIdentity({ row }: { row: RunRow }) {
  const [copyStatus, setCopyStatus] = useState("");
  return (
    <div className="min-w-0">
      <p className="break-words font-medium text-slate-100" title={row.runId}>
        {shortIdentity(row.runId)}
      </p>
      <p
        className="mt-1 text-xs text-slate-400"
        title={`${row.firstOccurredAt} to ${row.lastOccurredAt}`}
      >
        {humanUtcRange(row.firstOccurredAt, row.lastOccurredAt)}
      </p>
      <details className="mt-1 text-xs text-slate-400">
        <summary className="min-h-9 cursor-pointer py-2 text-cyan-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          Run details
        </summary>
        <p className="break-all py-1">
          Full run ID: <code>{row.runId}</code>
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(row.runId);
              setCopyStatus("Run ID copied");
            } catch {
              setCopyStatus("Copy unavailable. Select the full run ID.");
            }
          }}
        >
          Copy run ID
        </Button>
        {copyStatus ? <p role="status">{copyStatus}</p> : null}
        <div className="mt-2 space-y-2">
          <CompactValues
            label="Requested"
            values={row.identities.map(
              (identity) =>
                `${identity.provider} / ${requestedModelLabel(identity.requestedModel)}`,
            )}
          />
          <CompactValues
            label="Observed"
            values={[
              ...row.observedModels,
              ...(row.hasUnknownObservedModel ? ["Unknown"] : []),
            ]}
          />
          <p>Routes: {row.routes.join(", ")}</p>
          <Coverage totals={row.totals} />
        </div>
      </details>
    </div>
  );
}
export function RunUsageTable({
  report,
  onNext,
  selectedCurrency,
}: {
  report: ProviderUsageReport;
  onNext: () => void;
  selectedCurrency?: string | undefined;
}) {
  return (
    <>
      <div className="@container min-w-0">
        <div className={desktop}>
          <table aria-label="Review run usage" className={tableClass}>
            <Head
              labels={[
                "Run / UTC interval",
                "Requested providers / models",
                "Routes",
                "Requests",
                "Known tokens",
                "Known cost",
                "Status",
              ]}
            />
            <tbody>
              {report.overview.runs.map((row) => (
                <tr key={row.runId} className="border-b border-slate-700/40">
                  <th scope="row" className={`${cell} max-w-64 font-normal`}>
                    <RunIdentity row={row} />
                  </th>
                  <td className={`${cell} max-w-72`}>
                    <CompactValues
                      label="Requested"
                      values={row.identities.map(
                        (identity) =>
                          `${identity.provider} / ${requestedModelLabel(identity.requestedModel)}`,
                      )}
                    />
                    <CompactValues
                      label="Observed"
                      values={[
                        ...row.observedModels,
                        ...(row.hasUnknownObservedModel ? ["Unknown"] : []),
                      ]}
                    />
                  </td>
                  <td className={cell}>{row.routes.join(", ")}</td>
                  <td className={cell}>{count(row.totals.providerAttempts)}</td>
                  <td className={cell}>{count(row.totals.tokens.total)}</td>
                  <td className={`${cell} min-w-36`}>
                    <UsageCosts
                      costs={row.totals.costs}
                      unknownCostCount={row.totals.unknownCostCount}
                      selectedCurrency={selectedCurrency}
                    />
                  </td>
                  <td className={cell}>
                    <Coverage totals={row.totals} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <section aria-label="Run usage summaries" className={narrow}>
          <ul aria-label="Runs">
            {report.overview.runs.map((row) => (
              <li key={row.runId} className="border-b border-slate-700/40 py-4">
                <RunIdentity row={row} />
                <KeyMetrics
                  totals={row.totals}
                  selectedCurrency={selectedCurrency}
                />
              </li>
            ))}
          </ul>
        </section>
        {!report.overview.runs.length ? (
          <p className="py-5 text-sm text-slate-400">
            No measured runs for this interval.
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400">
        <p>
          Run totals cover all matching observations in the period. Run outcome
          is not inferred.
        </p>
        {report.overview.nextRunCursor ? (
          <Button variant="ghost" size="sm" onClick={onNext}>
            Next run page
          </Button>
        ) : null}
      </div>
    </>
  );
}
export function ObservationTable({
  report,
  onNext,
  selectedCurrency,
}: {
  report: ProviderUsageReport;
  onNext: () => void;
  selectedCurrency?: string | undefined;
}) {
  return (
    <>
      <div className="max-w-full overflow-x-auto">
        <table aria-label="Usage observations" className={tableClass}>
          <Head
            labels={[
              "Day (UTC)",
              "Requested / observed provider and model",
              "Route / purpose",
              "Tokens",
              "Cost / basis",
              "Coverage / authority",
              "Latency / TTFT",
            ]}
          />
          <tbody>
            {report.rows.map((row) => (
              <tr key={row.id} className="border-b border-slate-700/40">
                <th scope="row" className={`${cell} font-normal`}>
                  {row.day}
                </th>
                <td className={`${cell} max-w-80 break-words`}>
                  Requested: {row.requestedProvider ?? row.provider} /{" "}
                  {requestedModelLabel(
                    row.requestedModel === undefined
                      ? row.model
                      : row.requestedModel,
                  )}
                  <br />
                  Observed: {row.actualProvider ?? "Unknown"} /{" "}
                  {row.actualModel ?? "Unknown"}
                </td>
                <td className={cell}>
                  {row.route} / {row.purpose}
                </td>
                <td className={cell}>
                  {count(row.total)} ({row.granularity})
                </td>
                <td className={cell}>
                  <UsageCosts
                    costs={row.cost ? [row.cost] : []}
                    selectedCurrency={selectedCurrency}
                  />
                </td>
                <td className={cell}>
                  {row.completeness} / {row.authority ?? "unavailable"}
                </td>
                <td className={cell}>
                  {count(row.durationMs)} / {count(row.ttftMs)} ms
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-400">
        Showing up to 100 observations; totals cover the entire selected period.
      </p>
      {report.hasMore ? (
        <Button variant="ghost" size="sm" onClick={onNext}>
          Next observation page
        </Button>
      ) : null}
    </>
  );
}
