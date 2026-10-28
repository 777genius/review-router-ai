import { loadOperatorProviderUsage } from "../../../src/server/provider-usage-operator-report";
export const dynamic = "force-dynamic";

export default async function OperatorProviderUsagePage() {
  let report;
  try {
    report = await loadOperatorProviderUsage();
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return (
      <main className="mx-auto max-w-6xl p-8">
        <h1 className="text-2xl font-semibold">Operator provider usage</h1>
        <p>
          {code === "usage_sign_in_required"
            ? "Sign in to view this report."
            : code === "usage_access_denied"
              ? "Operator administrator access required."
              : "Usage report is unavailable."}
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-8">
      <header>
        <h1 className="text-2xl font-semibold">Operator provider usage</h1>
        <p>
          All users across active workspaces. UTC [{report.from}, {report.to}).
        </p>
        <p className="text-sm">
          Known usage is not a provider billing statement. Refresh this page to
          update the report.
        </p>
      </header>
      <dl className="flex flex-wrap gap-8 border-y py-4">
        <div>
          <dt>Provider attempts</dt>
          <dd>{report.attempts}</dd>
        </div>
        <div>
          <dt>Logical runs</dt>
          <dd>{report.logicalRuns}</dd>
        </div>
        <div>
          <dt>Known total tokens</dt>
          <dd>{report.totals.tokens.total ?? "Unknown"}</dd>
        </div>
        <div>
          <dt>Unknown usage</dt>
          <dd>{report.unknown}</dd>
        </div>
        <div>
          <dt>Partial usage</dt>
          <dd>{report.partial}</dd>
        </div>
        <div>
          <dt>Diagnostic requests</dt>
          <dd>{report.totals.diagnosticCount}</dd>
        </div>
      </dl>
      <section aria-label="Cost and coverage">
        <h2 className="text-lg font-semibold">Known cost and coverage</h2>
        {report.totals.costs.length ? (
          <ul>
            {report.totals.costs.map((cost) => (
              <li key={cost.currency + cost.basis}>
                {cost.amount} {cost.currency} ({cost.basis})
              </li>
            ))}
          </ul>
        ) : (
          <p>Cost unknown.</p>
        )}
        <p>
          {report.totals.unknownCostCount} records with unknown cost. Currency
          and cost basis are kept separate.
        </p>
        <p>
          Covered from: {report.coveredFrom ?? "Unknown"}. Source lag:{" "}
          {report.sourceLag}. Report generated: {report.asOf}.
        </p>
        <p>Quota and subscription reset: unknown.</p>
      </section>
      <section aria-label="Provider model totals">
        <h2 className="text-lg font-semibold">Provider and model totals</h2>
        <div className="overflow-auto">
          <table className="w-full text-left">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Model</th>
                <th>UTC day</th>
                <th>Known tokens</th>
                <th>Unknown usage</th>
                <th>Partial usage</th>
              </tr>
            </thead>
            <tbody>
              {report.groups.map((group) => (
                <tr
                  key={JSON.stringify([group.provider, group.model, group.day])}
                  className="border-t"
                >
                  <td>{group.provider}</td>
                  <td>{group.model ?? "Unknown"}</td>
                  <td>{group.day}</td>
                  <td>{group.totals.tokens.total ?? "Unknown"}</td>
                  <td>{group.totals.unknownCount}</td>
                  <td>{group.totals.partialCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!report.groups.length && (
          <p>
            No usage facts in this period. Missing telemetry is not evidence of
            zero upstream usage.
          </p>
        )}
      </section>
    </main>
  );
}
