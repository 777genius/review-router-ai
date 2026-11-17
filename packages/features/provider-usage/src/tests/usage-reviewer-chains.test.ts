import { describe, expect, it } from "vitest";
import { buildUsagePeriodReport } from "../application/report-usage";
import { reviewerChainScenario } from "./gateway-call-fixture";

const query = {
  workspaceId: "chain",
  actorId: null,
  access: "admin" as const,
  from: new Date("2026-11-01T00:00:00.000Z"),
  to: new Date("2026-11-18T00:00:00.000Z"),
};
const report = (reconciled: boolean) => {
  const chain = reviewerChainScenario("chain", "2026-11-17", reconciled);
  return {
    chain,
    report: buildUsagePeriodReport(
      [chain.refused, chain.quota, chain.accepted, chain.rerun],
      query,
    ),
  };
};

describe("reviewer chains in the usage report", () => {
  it("counts a failed first reviewer, its fallback and a rerun once each in one run", () => {
    const { chain, report: reconciled } = report(true);
    // The refusal never reached the provider; the quota call and both
    // completed calls did. Only the two completed calls reported tokens.
    expect(reconciled.totals).toMatchObject({
      providerAttempts: 3,
      logicalRuns: 1,
      tokens: { total: 260 },
      partialCount: 1,
      unknownCount: 0,
    });
    expect(reconciled.overview.runs).toHaveLength(1);
    expect(reconciled.overview.runs[0]).toMatchObject({
      identities: [chain.fallback, chain.primary],
      totals: { providerAttempts: 3, tokens: { total: 260 } },
    });
    expect(
      reconciled.overview.models.map((row) => [
        row.provider,
        row.totals.providerAttempts,
        row.totals.tokens.total,
      ]),
    ).toEqual([
      ["nvidia", 2, 260],
      ["openrouter", 1, null],
    ]);
  });

  it("does not count an unreconciled call with an unknown effect as a request yet", () => {
    const { report: pending } = report(false);
    // Lifecycle alone proves dispatch only for the completed calls; the quota
    // call stays a call without a usage report until native reconciliation.
    expect(pending.totals).toMatchObject({
      providerAttempts: 2,
      logicalRuns: 1,
      tokens: { total: null },
      unknownCount: 3,
      partialCount: 0,
    });
  });
});
