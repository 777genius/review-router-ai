import type {
  UsageFact,
  UsageIdentity,
  UsageProjection,
} from "../domain/usage";

/** Finite source states shared by pure reporting and database aggregation. */
export interface UsageContributionProfile {
  granularity: UsageIdentity["granularity"];
  purpose: UsageIdentity["purpose"];
  usage: Pick<UsageFact, "state" | "dispatchEffect" | "completeness"> | null;
  lifecycle: Pick<UsageFact, "state" | "dispatchEffect"> | null;
}
export interface UsageContributionDecision {
  includeSpend: boolean;
  providerAttempt: boolean;
  partialWeight: 0 | 1;
  unknownWeight: 0 | 1;
  diagnosticWeight: 0 | 1;
  summaryWeight: 0 | 1;
}
export function usageContributionProfile(
  p: UsageProjection,
): UsageContributionProfile {
  return {
    granularity: p.identity.granularity,
    purpose: p.identity.purpose,
    usage: p.usage
      ? {
          state: p.usage.state,
          dispatchEffect: p.usage.dispatchEffect,
          completeness: p.usage.completeness,
        }
      : null,
    lifecycle: p.lifecycle
      ? { state: p.lifecycle.state, dispatchEffect: p.lifecycle.dispatchEffect }
      : null,
  };
}
export function provenNotDispatched(
  p: Pick<UsageContributionProfile, "usage" | "lifecycle">,
): boolean {
  return (
    p.usage?.dispatchEffect === "not_dispatched" ||
    (p.lifecycle?.dispatchEffect === "not_dispatched" &&
      p.lifecycle.state !== "prepared")
  );
}
export function classifyUsageContribution(
  p: UsageContributionProfile,
): UsageContributionDecision {
  const includeSpend = !provenNotDispatched(p);
  return {
    includeSpend,
    providerAttempt:
      p.granularity === "call" &&
      includeSpend &&
      ((p.lifecycle?.dispatchEffect === "dispatched" &&
        p.lifecycle.state !== "prepared") ||
        (p.usage !== null &&
          p.usage.dispatchEffect !== "not_dispatched" &&
          p.usage.state !== "prepared")),
    partialWeight: p.usage?.completeness === "partial" ? 1 : 0,
    unknownWeight: !p.usage || p.usage.completeness === "unknown" ? 1 : 0,
    diagnosticWeight: p.purpose === "diagnostic" ? 1 : 0,
    summaryWeight: p.granularity === "turn" ? 1 : 0,
  };
}
