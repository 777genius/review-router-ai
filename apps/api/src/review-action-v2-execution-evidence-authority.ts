import {
  assertLifecycleVerificationManifest,
  assertLifecycleVerificationPreparedPlan,
} from "./review-lifecycle-verification.js";
import {
  ReviewProviderKind as EvidenceProviderKind,
  ReviewTaskKind as EvidenceTaskKind,
  ReviewTrustDomain as EvidenceTrustDomain,
  buildProviderInvocationIdentity,
  serializeProviderInvocationManifestCanonicalWireJson,
} from "@reviewrouter/features-review-evidence";
import {
  CurrentReviewExecutionRevisionStatus,
  ReviewExecutionProviderKind,
  ReviewInvocationLeaseState,
  ReviewTaskKind,
  type ReviewExecution,
  type ReviewExecutionLimits,
  type ReviewExecutionQueryPort,
  type ReviewExecutionScope,
  type ReviewExecutionSnapshot,
} from "@reviewrouter/features-review-executions";
import {
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  canonicalJson,
  type ReviewRunAuthorization,
  type ReviewRunAuthorizationTokenResolution,
} from "@reviewrouter/features-review-run-control";
import {
  canonicalizeReviewActionV2RequestForSlot,
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  type ReviewActionV2RequestMap,
  type ReviewInvocationLeaseAcquireRequest,
} from "@reviewrouter/protocol-review-action-v2";
import type { VerifiedReviewActionV2LeaseCapability } from "./review-action-v2-execution-evidence-capabilities.js";
import { assertPrDescriptionManifest } from "./review-pr-description.js";
import {
  type CommonDependencies,
  type ReviewActionV2DigestPort,
  type LeaseAuthorizationBinding,
  type ReviewActionV2ExecutionHandlerDependencies,
} from "./review-action-v2-execution-evidence-dependencies.js";
import {
  failure,
  requireEqual,
  parseManifest,
  assertCapturedReviewerManifest,
} from "./review-action-v2-execution-evidence-validation.js";

// Current execution, lease and manifest authority checks at the API boundary.

// Shared fail-closed mapping and canonical parsing helpers.
export async function requireAuthorization(
  token: string,
  d: CommonDependencies,
): Promise<ReviewRunAuthorization> {
  let result: ReviewRunAuthorizationTokenResolution;
  try {
    result = await d.authorizations.resolveReviewRunAuthorizationToken({
      token,
    });
  } catch {
    throw failure(
      401,
      ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      "authorization_token_invalid",
    );
  }
  if (result.status !== ReviewRunAuthorizationTokenResolutionStatus.Valid) {
    const gone =
      result.status === ReviewRunAuthorizationTokenResolutionStatus.Expired ||
      result.status === ReviewRunAuthorizationTokenResolutionStatus.Revoked;
    throw failure(
      gone ? 410 : 401,
      gone
        ? ReviewActionV2ProtocolErrorCode.ResourceGone
        : ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      `authorization_${result.status}`,
    );
  }
  if (
    result.authorization.state !== ReviewRunAuthorizationState.Active ||
    result.authorization.expiresAt <= d.now()
  )
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "authorization_inactive",
    );
  return result.authorization;
}

export async function requireExecution(
  id: string,
  auth: ReviewRunAuthorization,
  queries: ReviewExecutionQueryPort,
) {
  const snapshot = await queries.findExecution(id);
  if (!snapshot)
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "execution_missing",
    );
  if (!sameExecutionAuthority(snapshot.execution, auth))
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "execution_authorization_mismatch",
    );
  return snapshot;
}

export async function executionLimits(
  auth: ReviewRunAuthorization,
  d: CommonDependencies,
): Promise<ReviewExecutionLimits> {
  return executionLimitsForProfile(auth.protocolLimitsProfileId, d);
}

export async function executionLimitsForProfile(
  profileId: string,
  d: CommonDependencies,
): Promise<ReviewExecutionLimits> {
  const profile =
    await d.protocolLimits.findProtocolLimitsProfileById(profileId);
  if (!profile)
    throw failure(
      503,
      ReviewActionV2ProtocolErrorCode.ServiceUnavailable,
      "protocol_limits_missing",
    );
  return {
    profileId: profile.protocolLimitsProfileId,
    maxWorkSlots: profile.maxWorkSlots,
    maxAttemptBudget: profile.maxAttemptsPerSlot,
    maxProjectionBytes: profile.maxProjectionBytes,
    maxFindingCount: profile.maxProjectionFindings,
    maxLeaseDurationMs: profile.maxLeaseDurationMs,
    maxResultReportDurationMs: profile.maxResultReportDurationMs,
  };
}

export async function requireProtocolLimits(
  auth: ReviewRunAuthorization,
  d: CommonDependencies,
) {
  const profile = await d.protocolLimits.findProtocolLimitsProfileById(
    auth.protocolLimitsProfileId,
  );
  if (!profile)
    throw failure(
      503,
      ReviewActionV2ProtocolErrorCode.ServiceUnavailable,
      "protocol_limits_missing",
    );
  return profile;
}

export async function assertBodyHash<O extends ReviewActionV2OperationId>(
  operation: O,
  request: ReviewActionV2RequestMap[O],
  digest: ReviewActionV2DigestPort,
) {
  if (
    (await digest.digestUtf8(
      canonicalizeReviewActionV2RequestForSlot(operation, request),
    )) !== (request as { requestBodyHash?: string }).requestBodyHash
  )
    throw failure(
      400,
      ReviewActionV2ProtocolErrorCode.InvalidRequest,
      "request_body_hash_mismatch",
    );
}

export async function verifyLease(
  token: string,
  now: Date,
  d: CommonDependencies,
) {
  try {
    return await d.capabilities.verifyLease(token, now);
  } catch {
    throw failure(
      401,
      ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      "lease_capability_invalid",
    );
  }
}

export async function requireLease(
  authority: VerifiedReviewActionV2LeaseCapability,
  queries: ReviewExecutionQueryPort,
  requireActive: boolean,
  now: Date,
) {
  const lease = await queries.findLease(authority.leaseId);
  if (!lease)
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "lease_missing",
    );
  if (
    lease.leaseCapabilityId !== authority.capabilityId ||
    lease.ownerIdHash !== authority.ownerIdHash ||
    lease.executionId !== authority.executionId ||
    lease.workSlotId !== authority.workSlotId ||
    lease.providerInvocationKey !== authority.providerInvocationKey
  )
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "lease_capability_mismatch",
    );
  if (
    requireActive &&
    (lease.state !== ReviewInvocationLeaseState.Active ||
      lease.expiresAt <= now)
  )
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "lease_not_active",
    );
  return lease;
}

export function requireLeaseRequest(
  authority: VerifiedReviewActionV2LeaseCapability,
  leaseId: string,
  ownerIdHash: string,
) {
  requireEqual(authority.leaseId, leaseId, "lease_id_mismatch");
  requireEqual(authority.ownerIdHash, ownerIdHash, "lease_owner_mismatch");
}

export function requireLeaseOwnership(
  authority: VerifiedReviewActionV2LeaseCapability,
  now: Date,
) {
  if (authority.ownershipExpiresAt <= now) {
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "lease_ownership_expired",
    );
  }
}

export async function assertLeaseAuthorization(
  authority: LeaseAuthorizationBinding,
  authorization: ReviewRunAuthorization,
  d: CommonDependencies,
) {
  requireEqual(
    authority.authorizationId,
    authorization.authorizationId,
    "lease_authorization_mismatch",
  );
  requireEqual(
    authority.scopeHash,
    await authorizationScopeHash(authorization, d.digest),
    "lease_scope_mismatch",
  );
  requireEqual(
    authority.reviewRevisionHash,
    authorization.reviewRevisionHash,
    "lease_revision_mismatch",
  );
  requireEqual(
    authority.mutationEpoch,
    authorization.mutationEpoch,
    "lease_mutation_epoch_mismatch",
  );
}

export async function validatePreparedManifest(
  request: Pick<
    ReviewInvocationLeaseAcquireRequest,
    | "manifestCanonicalJson"
    | "manifestKey"
    | "providerInvocationKey"
    | "providerVoteIdentityHash"
  >,
  authorization: ReviewRunAuthorization,
  slot: ReviewExecution["workSlots"][number],
  dependencies: Pick<CommonDependencies, "digest">,
  assignmentManifestCanonicalJson?: string | null,
) {
  const manifest = parseManifest(request.manifestCanonicalJson);
  assertCapturedReviewerManifest(authorization, slot, manifest);
  if (
    serializeProviderInvocationManifestCanonicalWireJson(manifest) !==
    request.manifestCanonicalJson
  ) {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "manifest_not_canonical",
    );
  }
  const scopeHash = await authorizationScopeHash(
    authorization,
    dependencies.digest,
  );
  requireEqual(manifest.scopeHash, scopeHash, "manifest_scope_mismatch");
  requireEqual(
    manifest.producerReleaseId,
    authorization.producerReleaseId,
    "manifest_release_mismatch",
  );
  requireEqual(
    manifest.selectedProtocolVersion,
    authorization.selectedProtocolVersion,
    "manifest_protocol_mismatch",
  );
  requireEqual(
    manifest.providerKind,
    evidenceProviderForExecution(slot.providerKind),
    "manifest_provider_mismatch",
  );
  if (!manifest.taskKindSet.includes(evidenceTaskForExecution(slot.taskKind))) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "manifest_task_mismatch",
    );
  }
  assertPrDescriptionManifest(authorization, slot, manifest);
  assertLifecycleVerificationManifest(authorization, slot, manifest);
  assertLifecycleVerificationPreparedPlan(
    authorization,
    assignmentManifestCanonicalJson
      ? JSON.parse(assignmentManifestCanonicalJson)
      : null,
    slot,
    manifest,
  );
  requireEqual(
    request.providerVoteIdentityHash,
    slot.providerVoteIdentityHash,
    "provider_vote_slot_mismatch",
  );
  requireEqual(
    slot.providerVoteIdentityHash,
    authorizedVote(authorization, request.providerVoteIdentityHash),
    "provider_vote_not_authorized",
  );
  const identity = await buildProviderInvocationIdentity(dependencies.digest, {
    manifest,
    providerVoteIdentityHash: request.providerVoteIdentityHash,
  });
  requireEqual(
    request.manifestKey,
    identity.manifestKey,
    "manifest_key_mismatch",
  );
  requireEqual(
    request.providerInvocationKey,
    identity.providerInvocationKey,
    "provider_invocation_key_mismatch",
  );
  return { manifest, identity, scopeHash } as const;
}

export function toExecutionScope(
  a: Pick<
    ReviewRunAuthorization,
    | "workspaceId"
    | "repositoryConnectionId"
    | "scmRepositoryIdentityId"
    | "pullRequestNumber"
  >,
): ReviewExecutionScope {
  return {
    workspaceId: a.workspaceId,
    repositoryConnectionId: a.repositoryConnectionId,
    scmRepositoryIdentityId: a.scmRepositoryIdentityId,
    pullRequestNumber: a.pullRequestNumber,
  };
}

export function scopeFromSnapshot(
  snapshot: ReviewExecutionSnapshot,
): ReviewExecutionScope {
  return {
    workspaceId: snapshot.stream.workspaceId,
    repositoryConnectionId: snapshot.stream.repositoryConnectionId,
    scmRepositoryIdentityId: snapshot.stream.scmRepositoryIdentityId,
    pullRequestNumber: snapshot.stream.pullRequestNumber,
  };
}

export async function requireCurrentExecutionRevision(
  input: { readonly scope: ReviewExecutionScope; readonly executionId: string },
  d: ReviewActionV2ExecutionHandlerDependencies,
): Promise<void> {
  const status = await d.executions.currentRevision.execute(input);
  switch (status) {
    case CurrentReviewExecutionRevisionStatus.Current:
      return;
    case CurrentReviewExecutionRevisionStatus.Missing:
      throw failure(
        404,
        ReviewActionV2ProtocolErrorCode.NotFound,
        "execution_revision_missing",
      );
    case CurrentReviewExecutionRevisionStatus.Stale:
      throw failure(
        412,
        ReviewActionV2ProtocolErrorCode.StalePrecondition,
        "execution_revision_stale",
      );
    case CurrentReviewExecutionRevisionStatus.Unavailable:
      throw failure(
        503,
        ReviewActionV2ProtocolErrorCode.ServiceUnavailable,
        "execution_revision_unavailable",
      );
  }
}

export function toExecutionRevision(a: ReviewRunAuthorization) {
  return {
    baseSha: a.baseSha,
    mergeBaseSha: a.mergeBaseSha,
    headSha: a.headSha,
    reviewRevisionHash: a.reviewRevisionHash,
  };
}

export function toEvidenceRevision(a: ReviewRunAuthorization) {
  return toExecutionRevision(a);
}

export function toEvidenceScope(
  a: ReviewRunAuthorization,
  authorizationScopeHash: string,
) {
  return { ...toExecutionScope(a), authorizationScopeHash };
}

export function evidenceTrustDomain(
  value: ReviewTrustDomain,
): EvidenceTrustDomain {
  return value as unknown as EvidenceTrustDomain;
}

function evidenceProviderForExecution(
  value: ReviewExecutionProviderKind,
): EvidenceProviderKind {
  switch (value) {
    case ReviewExecutionProviderKind.Codex:
      return EvidenceProviderKind.Codex;
    case ReviewExecutionProviderKind.ClaudeCode:
      return EvidenceProviderKind.ClaudeCode;
    case ReviewExecutionProviderKind.OpenRouter:
      return EvidenceProviderKind.OpenRouter;
    case ReviewExecutionProviderKind.Ocr:
      return EvidenceProviderKind.Ocr;
    default:
      throw failure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        "execution_provider_unknown",
      );
  }
}

function evidenceTaskForExecution(value: ReviewTaskKind): EvidenceTaskKind {
  switch (value) {
    case ReviewTaskKind.PrDescription:
      return EvidenceTaskKind.PrDescription;
    case ReviewTaskKind.FindingDiscovery:
      return EvidenceTaskKind.FindingDiscovery;
    case ReviewTaskKind.LifecycleRevalidation:
      return EvidenceTaskKind.LifecycleRevalidation;
    default:
      throw failure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        "execution_task_unknown",
      );
  }
}

export function sameExecutionAuthority(
  e: ReviewExecution,
  a: ReviewRunAuthorization,
) {
  const scope = toExecutionScope(a);
  return (
    e.authorizationId === a.authorizationId &&
    e.workspaceId === scope.workspaceId &&
    e.repositoryConnectionId === scope.repositoryConnectionId &&
    e.scmRepositoryIdentityId === scope.scmRepositoryIdentityId &&
    e.pullRequestNumber === scope.pullRequestNumber
  );
}

export async function authorizationScopeHash(
  a: ReviewRunAuthorization,
  digest: ReviewActionV2DigestPort,
) {
  return digest.digestUtf8(canonicalJson(toExecutionScope(a)));
}

export function authorizedVote(a: ReviewRunAuthorization, hash: string) {
  if (
    !a.providerVoteLanes.some((lane) => lane.providerVoteIdentityHash === hash)
  )
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "provider_vote_not_authorized",
    );
  return hash;
}
