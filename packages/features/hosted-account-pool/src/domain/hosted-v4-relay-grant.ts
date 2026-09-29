import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const positive = z.number().int().positive();
const canaryLimits = Object.freeze({
  maxRequests: 1,
  maxRequestBytes: 1_000_000,
  maxResponseBytes: 8_000_000,
  maxOutputTokens: 4_096,
  maxGatewayOperations: 128,
  maxOutputFindings: 32,
  maxOutputProposals: 64,
});

export const hostedV4RelayCanaryPolicyVersion = "hosted-v4-disposable-eight-v1";
export const hostedV4RelayCanaryAccountRequestAllocation = 8;

/** Finite, server-owned allocation bound to the selected account and runtime config. */
export function hostedV4RelayCanaryPolicyFingerprint(input: {
  accountId: string;
  runtimeConfigVersion: number;
  model: string;
  maxRequests: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
}): string {
  if (
    !Number.isSafeInteger(input.runtimeConfigVersion) ||
    input.runtimeConfigVersion < 1 ||
    !Number.isSafeInteger(input.maxRequests) ||
    input.maxRequests < 1 ||
    !Number.isSafeInteger(input.maxRequestBytes) ||
    input.maxRequestBytes < 1 ||
    !Number.isSafeInteger(input.maxResponseBytes) ||
    input.maxResponseBytes < 1 ||
    !Number.isSafeInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1
  ) {
    throw new Error("hosted_v4_relay_policy_facts_invalid");
  }
  return createHash("sha256")
    .update(
      JSON.stringify({
        version: hostedV4RelayCanaryPolicyVersion,
        accountRequestAllocation: hostedV4RelayCanaryAccountRequestAllocation,
        accountId: id.parse(input.accountId),
        runtimeConfigVersion: input.runtimeConfigVersion,
        model: id.parse(input.model),
        maxRequests: input.maxRequests,
        maxRequestBytes: input.maxRequestBytes,
        maxResponseBytes: input.maxResponseBytes,
        maxOutputTokens: input.maxOutputTokens,
      }),
    )
    .digest("hex");
}

/** Immutable server-resolved facts. IDs supplied by a caller are lookup hints only. */
export const hostedV4RelayScopeSchema = z
  .object({
    version: z.literal(4),
    authorizationId: id,
    authorizationState: z.literal("active"),
    mutationEpoch: z.bigint().positive(),
    trustDomain: z.literal("trusted_managed"),
    investigationCodexRecordingAllowed: z.literal(true),
    workspaceId: id,
    repositoryConnectionId: id,
    scmRepositoryIdentityId: id,
    githubRepositoryId: id,
    githubInstallationId: id,
    pullRequestNumber: positive,
    baseSha: sha,
    mergeBaseSha: sha,
    headSha: sha,
    reviewRevisionHash: hash,
    producerReleaseId: id,
    producerReleaseRegistered: z.literal(true),
    actionIdentityHash: hash,
    runtimeIdentityHash: hash,
    gatewayIdentityHash: hash,
    protocolVersion: id,
    schemaDigest: hash,
    protocolLimitsProfileId: id,
    providerInstanceId: id,
    repositoryBindingId: id,
    bindingRevision: positive,
    bindingActive: z.literal(true),
    repositorySelected: z.literal(true),
    poolId: id,
    poolActive: z.literal(true),
    poolAuthzEpoch: z.bigint().positive(),
    runtimeGateActive: z.literal(true),
    runtimeAuthzEpoch: z.bigint().positive(),
    model: id,
    policyFingerprint: hash,
    investigationId: id,
    investigationVersion: z.bigint().positive(),
    turnId: id,
    turnBudgetCanonicalJson: z.string().min(2).max(2_048),
    turnBudgetHash: hash,
    turnPurpose: z.enum(["discovery", "critic"]),
    planningInputDossierDigest: hash,
    dossierDigest: hash,
    investigationManifestHash: hash,
    executionId: id,
    workSlotId: id,
    providerVoteLaneId: id,
    providerStrategyId: id,
    attemptId: id,
    investigationLease: z
      .object({
        leaseId: id,
        capabilityId: id,
        ownerIdHash: hash,
        fencingToken: z.bigint().positive(),
        purpose: z.literal("relay_turn"),
        expiresAt: z.date(),
      })
      .strict(),
    invocationLease: z
      .object({
        leaseId: id,
        capabilityId: id,
        ownerIdHash: hash,
        fencingToken: z.bigint().positive(),
        purpose: z.literal("provider_execution"),
        attemptId: id.nullable(),
        providerInvocationKey: id,
        expiresAt: z.date(),
      })
      .strict(),
    authorizationExpiresAt: z.date(),
    turnExpiresAt: z.date(),
    policyExpiresAt: z.date(),
  })
  .strict();

export type HostedV4RelayScope = z.infer<typeof hostedV4RelayScopeSchema>;

export type HostedV4RelayGrantContract = Readonly<{
  kind: "v4_relay_turn";
  logicalTurnKey: string;
  scopeHash: string;
  scope: HostedV4RelayScope;
  expiresAt: Date;
  maxConcurrentRequests: 1;
  maxRequests: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
}>;

/** The current shadow_turn lease is deliberately rejected by the schema. */
export function defineHostedV4RelayGrant(input: {
  scope: HostedV4RelayScope;
  now: Date;
  maxRequests: number;
  maxRequestBytes: number;
  maxResponseBytes: number;
  maxOutputTokens: number;
}): HostedV4RelayGrantContract {
  const scope = hostedV4RelayScopeSchema.parse(input.scope);
  let budget: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(scope.turnBudgetCanonicalJson);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("invalid");
    }
    budget = parsed as Record<string, unknown>;
  } catch {
    throw new Error("hosted_v4_relay_turn_budget_invalid");
  }
  if (
    Object.keys(budget).sort().join(",") !==
      "deadline,maxGatewayOperations,maxOutputFindings,maxOutputProposals,maxOutputTokens,maxRequestBytes,maxRequests,maxResponseBytes,version" ||
    budget.version !== 1 ||
    JSON.stringify(
      Object.fromEntries(
        Object.entries(budget).sort(([a], [b]) => a.localeCompare(b)),
      ),
    ) !== scope.turnBudgetCanonicalJson ||
    createHash("sha256").update(scope.turnBudgetCanonicalJson).digest("hex") !==
      scope.turnBudgetHash ||
    budget.maxRequests !== input.maxRequests ||
    budget.maxRequestBytes !== input.maxRequestBytes ||
    budget.maxResponseBytes !== input.maxResponseBytes ||
    budget.maxOutputTokens !== input.maxOutputTokens ||
    !Number.isSafeInteger(budget.maxGatewayOperations) ||
    (budget.maxGatewayOperations as number) < 1 ||
    !Number.isSafeInteger(budget.maxOutputFindings) ||
    (budget.maxOutputFindings as number) < 1 ||
    !Number.isSafeInteger(budget.maxOutputProposals) ||
    (budget.maxOutputProposals as number) < 1 ||
    typeof budget.deadline !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(budget.deadline) ||
    !Number.isFinite(Date.parse(budget.deadline)) ||
    new Date(budget.deadline).toISOString() !== budget.deadline ||
    Date.parse(budget.deadline) > scope.turnExpiresAt.getTime()
  ) {
    throw new Error("hosted_v4_relay_turn_budget_mismatch");
  }
  for (const [field, ceiling] of Object.entries(canaryLimits)) {
    const value = budget[field];
    if (
      !Number.isSafeInteger(value) ||
      (value as number) < 1 ||
      (value as number) > ceiling
    ) {
      throw new Error("hosted_v4_relay_turn_budget_limit_invalid");
    }
  }
  const expiresAt = new Date(
    Math.min(
      scope.authorizationExpiresAt.getTime(),
      scope.turnExpiresAt.getTime(),
      scope.investigationLease.expiresAt.getTime(),
      scope.invocationLease.expiresAt.getTime(),
      scope.policyExpiresAt.getTime(),
      Date.parse(budget.deadline as string),
    ),
  );
  if (expiresAt <= input.now) throw new Error("hosted_v4_relay_scope_expired");
  for (const value of [
    input.maxRequests,
    input.maxRequestBytes,
    input.maxResponseBytes,
    input.maxOutputTokens,
  ]) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("hosted_v4_relay_budget_invalid");
  }
  if (
    scope.investigationLease.leaseId === scope.invocationLease.leaseId ||
    scope.investigationLease.capabilityId === scope.invocationLease.capabilityId
  ) {
    throw new Error("hosted_v4_relay_lease_domains_overlap");
  }
  return {
    kind: "v4_relay_turn",
    logicalTurnKey: hostedV4LogicalTurnKey(scope.investigationId, scope.turnId),
    scopeHash: digest([canonicalScope(scope)]),
    scope,
    expiresAt,
    maxConcurrentRequests: 1,
    maxRequests: input.maxRequests,
    maxRequestBytes: input.maxRequestBytes,
    maxResponseBytes: input.maxResponseBytes,
    maxOutputTokens: input.maxOutputTokens,
  };
}

export function hostedV4LogicalTurnKey(
  investigationId: string,
  turnId: string,
): string {
  return digest([id.parse(investigationId), id.parse(turnId)]);
}

/** Every mutable authority fact must be re-resolved before admission and dispatch. */
export function assertHostedV4RelayScopeCurrent(
  saved: HostedV4RelayGrantContract,
  current: HostedV4RelayScope,
  now: Date,
): void {
  if (
    current.authorizationExpiresAt <= now ||
    current.investigationLease.expiresAt <= now ||
    current.invocationLease.expiresAt <= now
  ) {
    throw new Error("hosted_v4_relay_scope_stale");
  }
  // Live renewal extends ownership only. It never rewrites issue-time grant
  // scope, bearer expiry or the unique logical-turn reservation.
  const comparable = {
    ...current,
    authorizationExpiresAt: saved.scope.authorizationExpiresAt,
    investigationLease: {
      ...current.investigationLease,
      expiresAt: saved.scope.investigationLease.expiresAt,
    },
    invocationLease: {
      ...current.invocationLease,
      expiresAt: saved.scope.invocationLease.expiresAt,
    },
  };
  const resolved = defineHostedV4RelayGrant({
    scope: comparable,
    now,
    maxRequests: saved.maxRequests,
    maxRequestBytes: saved.maxRequestBytes,
    maxResponseBytes: saved.maxResponseBytes,
    maxOutputTokens: saved.maxOutputTokens,
  });
  if (
    saved.logicalTurnKey !== resolved.logicalTurnKey ||
    saved.scopeHash !== resolved.scopeHash ||
    now >= saved.expiresAt
  ) {
    throw new Error("hosted_v4_relay_scope_stale");
  }
}

export function canonicalScope(scope: HostedV4RelayScope): string {
  return JSON.stringify(scope, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );
}

function digest(parts: readonly string[]): string {
  const value = createHash("sha256");
  for (const part of parts) value.update(`${part.length}:${part}`);
  return value.digest("hex");
}
