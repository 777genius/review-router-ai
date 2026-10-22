"use client";
import { Button } from "@reviewrouter/ui";
import type { ProviderUsageReport } from "./provider-usage-model";
import {
  costsLabel,
  currencyCostsLabel,
  count,
  observedLabel,
  providerColor,
  requestedModelLabel,
} from "./provider-usage-format";

const cell = "px-3 py-3 align-top";
const tableClass = "w-full min-w-[780px] text-left text-xs tabular-nums";
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
function Coverage({
  unknown,
  partial,
  unknownTotal,
}: {
  unknown: number;
  partial: number;
  unknownTotal: number;
}) {
  return (
    <span
      className={
        unknown || partial || unknownTotal ? "text-amber-300" : "text-slate-400"
      }
    >
      {unknown || partial || unknownTotal
        ? `${unknown} unknown · ${partial} partial${unknownTotal ? ` · ${unknownTotal} total token values unknown` : ""}`
        : "Reported observations"}
    </span>
  );
}
function ModelObserved({
  row,
}: {
  row: ProviderUsageReport["overview"]["models"][number];
}) {
  if (
    !row.hasUnknownObservedModel &&
    row.observedModels.length === 1 &&
    row.observedModels[0] === row.requestedModel
  )
    return null;
  const observed = observedLabel(
    row.observedModels,
    row.hasUnknownObservedModel,
  );
  if (observed.length > 80 || row.observedModels.length > 2)
    return (
      <details className="mt-1 text-[11px] text-slate-500">
        <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300">
          Observed:{" "}
          {row.observedModels.length === 1
            ? row.observedModels[0] === row.requestedModel
              ? "1 model"
              : "different model"
            : `${row.observedModels.length} models`}
          {row.hasUnknownObservedModel ? ", Unknown" : ""}
        </summary>
        <p className="mt-1 break-words">{observed}</p>
      </details>
    );
  return (
    <p
      className="mt-1 line-clamp-2 break-words text-[11px] text-slate-500"
      title={`Observed: ${observed}`}
    >
      Observed: {observed}
    </p>
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
    <div className="max-w-full overflow-x-auto">
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
                <div className="flex items-start gap-2.5">
                  <span
                    className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: providerColor(row.provider) }}
                  />
                  <div className="min-w-0">
                    <span
                      className="line-clamp-2 break-words text-slate-100"
                      title={`${row.provider} / ${requestedModelLabel(row.requestedModel)}`}
                    >
                      {row.provider} / {requestedModelLabel(row.requestedModel)}
                    </span>
                    <ModelObserved row={row} />
                  </div>
                </div>
              </th>
              <td className={cell}>{row.route}</td>
              <td className={cell}>{count(row.totals.providerAttempts)}</td>
              <td className={cell}>{count(row.totals.tokens.inputTotal)}</td>
              <td className={cell}>{count(row.totals.tokens.outputTotal)}</td>
              <td className={`${cell} min-w-36`}>
                {costsLabel(row.totals, selectedCurrency)}
                {row.totals.unknownCostCount ? (
                  <span className="mt-1 block text-amber-300">
                    Some cost unknown
                  </span>
                ) : null}
              </td>
              <td className={cell}>
                <Coverage
                  unknown={row.totals.unknownCount}
                  partial={row.totals.partialCount}
                  unknownTotal={row.totals.unknownTotalTokenCount}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!report.overview.models.length ? (
        <p className="py-7 text-sm text-slate-400">
          No measured model observations for this interval.
        </p>
      ) : null}
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
      <div className="max-w-full overflow-x-auto">
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
                  <span className="break-all text-slate-100">{row.runId}</span>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {row.firstOccurredAt} to {row.lastOccurredAt}
                  </p>
                </th>
                <td className={`${cell} max-w-80 break-words`}>
                  {row.identities.map((identity) => (
                    <p key={JSON.stringify(identity)}>
                      {identity.provider} /{" "}
                      {requestedModelLabel(identity.requestedModel)}
                    </p>
                  ))}
                  <p className="mt-1 text-[11px] text-slate-500">
                    Observed:{" "}
                    {observedLabel(
                      row.observedModels,
                      row.hasUnknownObservedModel,
                    )}
                  </p>
                </td>
                <td className={cell}>{row.routes.join(", ")}</td>
                <td className={cell}>{count(row.totals.providerAttempts)}</td>
                <td className={cell}>{count(row.totals.tokens.total)}</td>
                <td className={cell}>
                  {costsLabel(row.totals, selectedCurrency)}
                </td>
                <td className={cell}>
                  <Coverage
                    unknown={row.totals.unknownCount}
                    partial={row.totals.partialCount}
                    unknownTotal={row.totals.unknownTotalTokenCount}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!report.overview.runs.length ? (
          <p className="py-7 text-sm text-slate-400">
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
                  {currencyCostsLabel(
                    row.cost ? [row.cost] : [],
                    selectedCurrency,
                  )}
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
