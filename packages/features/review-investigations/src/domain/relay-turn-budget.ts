import {
  assertDigest,
  canonicalJson,
  ReviewInvestigationDomainError,
} from "./canonicalization";

/** Finite disposable-cohort policy; these are allocations, not provider prices. */
export const relayTurnBudgetCeilings = Object.freeze({
  maxRequests: 1,
  maxRequestBytes: 1_000_000,
  maxResponseBytes: 8_000_000,
  maxOutputTokens: 4_096,
  maxGatewayOperations: 128,
  maxOutputFindings: 32,
  maxOutputProposals: 64,
});

export type RelayTurnBudget = Readonly<{
  version: 1;
  maxRequests: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
  maxGatewayOperations: number;
  maxOutputFindings: number;
  maxOutputProposals: number;
  deadline: string;
}>;

export async function verifyRelayTurnBudget(input: {
  canonicalJson: string;
  hash: string;
  digestUtf8(value: string): Promise<string>;
  now: Date;
  turnExpiresAt: Date;
}): Promise<RelayTurnBudget> {
  assertDigest(input.hash, "relay_turn_budget_hash");
  if (input.canonicalJson.length > 2_048) {
    throw new ReviewInvestigationDomainError("relay_turn_budget_invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.canonicalJson);
  } catch {
    throw new ReviewInvestigationDomainError("relay_turn_budget_invalid");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    canonicalJson(parsed) !== input.canonicalJson
  ) {
    throw new ReviewInvestigationDomainError("relay_turn_budget_not_canonical");
  }
  const fields = Object.keys(parsed).sort();
  const expected = [
    "version",
    ...Object.keys(relayTurnBudgetCeilings),
    "deadline",
  ].sort();
  if (
    fields.length !== expected.length ||
    fields.some((field, index) => field !== expected[index])
  ) {
    throw new ReviewInvestigationDomainError("relay_turn_budget_invalid");
  }
  const budget = parsed as Record<string, unknown>;
  if (budget.version !== 1) {
    throw new ReviewInvestigationDomainError("relay_turn_budget_invalid");
  }
  for (const [field, ceiling] of Object.entries(relayTurnBudgetCeilings)) {
    const value = budget[field];
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < 1 ||
      (value as number) > ceiling
    ) {
      throw new ReviewInvestigationDomainError(
        "relay_turn_budget_limit_invalid",
      );
    }
  }
  const deadline = budget.deadline;
  if (
    typeof deadline !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(deadline) ||
    !Number.isFinite(Date.parse(deadline)) ||
    new Date(deadline).toISOString() !== deadline ||
    Date.parse(deadline) <= input.now.getTime() ||
    Date.parse(deadline) > input.turnExpiresAt.getTime()
  ) {
    throw new ReviewInvestigationDomainError(
      "relay_turn_budget_deadline_invalid",
    );
  }
  if ((await input.digestUtf8(input.canonicalJson)) !== input.hash) {
    throw new ReviewInvestigationDomainError("relay_turn_budget_hash_mismatch");
  }
  return budget as RelayTurnBudget;
}
