import { dashboardSectionHref } from "./dashboard-section";
import type { ReactNode } from "react";
import type { ProviderUsageReport } from "./provider-usage-model";
import { DailyUsageTable } from "./provider-usage-charts";
import { ObservationTable } from "./provider-usage-tables";
import { humanUtc } from "./provider-usage-format";
import type { CostBucket } from "./provider-usage-format";

export function UsageDetails({
  workspaceId,
  report,
  controls,
  onNext,
  selectedCurrency,
  bucket,
}: {
  workspaceId: string;
  report: ProviderUsageReport;
  controls: ReactNode;
  onNext: () => void;
  selectedCurrency?: string | undefined;
  bucket?: CostBucket | undefined;
}) {
  return (
    <div className="space-y-5 border-t border-slate-700/50 pt-5 text-xs text-slate-400">
      <p className="break-words">
        UTC interval [{report.from}, {report.to}), inclusive start and exclusive
        end.
      </p>
      <p>
        Source windows below are source-wide checkpoints; they do not prove
        completeness for a selected model, route or UTC day. Known usage is not
        a provider billing statement.{" "}
        <a
          className="text-cyan-200 underline"
          href={dashboardSectionHref("setup", workspaceId)}
        >
          Account limits are shown in Accounts
        </a>
      </p>
      <p>
        {report.unknown} unknown · {report.partial} partial ·{" "}
        {report.unboundedSummaries} separate reported summaries · Unattributed
        observations: {report.unattributed ?? "unknown"} · Observations without
        run ID: {report.overview.observationsWithoutRunId}
      </p>
      <p>
        Source lag: {report.sourceLag} · All reported source windows from{" "}
        {report.coveredFrom ?? "unknown"}
      </p>
      <ul aria-label="Producer delivery coverage" className="space-y-1">
        {report.deliveryCoverage.map((source) => (
          <li key={source.invocationId}>
            Runtime delivery:{" "}
            {source.coverage
              ? `partial (${source.coverage.reason}, ${source.coverage.droppedEvents} dropped events)`
              : "unknown (no producer coverage report)"}
          </li>
        ))}
      </ul>
      <ul aria-label="Usage source coverage" className="space-y-1">
        {report.sources.map((source) => (
          <li key={source.sourceInstance}>
            Native source coverage from {humanUtc(source.coveredFrom)}; as of{" "}
            {source.asOf ? humanUtc(source.asOf) : "unavailable"}; lag{" "}
            {source.lagMs === null ? "unknown" : `${source.lagMs}ms`} ·{" "}
            {source.deadLetteredAt
              ? `dead letter since ${humanUtc(source.deadLetteredAt)}`
              : source.nextAttemptAt
                ? `retry at ${humanUtc(source.nextAttemptAt)}`
                : "reconciled"}
            {source.lastErrorCode
              ? ` · last source error: ${source.lastErrorCode}`
              : ""}
          </li>
        ))}
        <li>
          Direct runtime source coverage:{" "}
          {report.overview.hasDirectObservations
            ? "reported observations only; transport completeness varies"
            : "unknown"}
        </li>
      </ul>
      {controls}
      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">
          Daily values
        </h3>
        <DailyUsageTable
          report={report}
          selectedCurrency={selectedCurrency}
          bucket={bucket}
        />
      </div>
      <div>
        <h3 className="mb-2 text-sm font-medium text-slate-200">
          Raw observations
        </h3>
        <ObservationTable
          report={report}
          onNext={onNext}
          selectedCurrency={selectedCurrency}
        />
      </div>
    </div>
  );
}
