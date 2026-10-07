import { createHash } from "node:crypto";
import { z } from "zod";

const id = z.string().trim().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const positive = z.number().int().positive();

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
    turnPurpose: id,
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
  const expiresAt = new Date(
    Math.min(
      scope.authorizationExpiresAt.getTime(),
      scope.turnExpiresAt.getTime(),
      scope.investigationLease.expiresAt.getTime(),
      scope.invocationLease.expiresAt.getTime(),
      scope.policyExpiresAt.getTime(),
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
    logicalTurnKey: digest([scope.investigationId, scope.turnId]),
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

/** Every mutable authority fact must be re-resolved before admission and dispatch. */
export function assertHostedV4RelayScopeCurrent(
  saved: HostedV4RelayGrantContract,
  current: HostedV4RelayScope,
  now: Date,
): void {
  const resolved = defineHostedV4RelayGrant({
    scope: current,
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
