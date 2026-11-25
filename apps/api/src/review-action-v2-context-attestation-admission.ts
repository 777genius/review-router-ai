// Authorize context gateway operations and bind them to current execution or investigation leases.
import {
  ContextLeaseAuthorityKind,
  ContextProviderKind,
  type GatewaySession,
} from "@reviewrouter/features-review-context-attestation";
import type { ReviewInvestigationLease } from "@reviewrouter/features-review-investigations";
import {
  ReviewInvestigationLeaseProtectedOperation,
  ReviewInvestigationLeaseState,
  ReviewInvestigationTurnPurpose,
  assertReviewInvestigationLeaseAllows,
  reviewInvestigationLeaseBindingIsCurrent,
} from "@reviewrouter/features-review-investigations";
import {
  ProviderExecutionProfile,
  ReviewProviderKind,
  normalizeProviderInvocationManifest,
  serializeProviderInvocationManifestCanonicalWireJson,
  type ProviderInvocationManifest,
} from "@reviewrouter/features-review-evidence";
import {
  InvestigationRolloutCapability,
  InvestigationRolloutProvider,
} from "@reviewrouter/features-review-investigation-operations";
import {
  ReviewExecutionProviderKind,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  type ReviewExecutionQueryPort,
  type ReviewExecutionSnapshot,
  type ReviewInvocationLease,
} from "@reviewrouter/features-review-executions";
import {
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ReviewRunAuthorization,
  type ReviewRunAuthorizationTokenResolution,
} from "@reviewrouter/features-review-run-control";
import {
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  canonicalizeReviewContextConfinementEvidence,
  canonicalizeReviewInvestigationContextConfinementEvidence,
  canonicalizeReviewActionV2RequestForSlot,
  type ReviewActionV2RequestMap,
  type ReviewContextGatewayOpenRequest,
  type ReviewContextGatewaySealRequest,
  type ReviewInvestigationContextGatewayOpenRequest,
  type ReviewInvestigationContextGatewaySealRequest,
} from "@reviewrouter/protocol-review-action-v2";
import type {
  ReviewActionV2ContextGatewaySealAuthority,
  ReviewActionV2InvestigationContextGatewaySealAuthority,
  VerifiedReviewActionV2LeaseCapability,
} from "./review-action-v2-execution-evidence-capabilities.js";
import {
  hasAuthorizedReviewInvestigationExtension,
  type ReviewInvestigationAuthorizedProviderKind,
} from "./review-action-v2-investigation-extension-admission.js";
import type { VerifiedReviewActionV2InvestigationLeaseCapability } from "./review-action-v2-investigation-lease-capabilities.js";
import type {
  BoundContextGatewayLease,
  ReviewActionV2ContextAttestationHandlerDependencies,
  ReviewActionV2ContextDigestPort,
} from "./review-action-v2-context-attestation-types.js";
import {
  authorizationScopeHash,
  openingIntentIdentity,
} from "./review-action-v2-context-attestation-crypto.js";
import {
  failure,
  requireEqual,
} from "./review-action-v2-context-attestation-validation.js";

export async function resolveOpeningFacts(input: {
  readonly request:
    | ReviewContextGatewayOpenRequest
    | ReviewInvestigationContextGatewayOpenRequest;
  readonly authorization: ReviewRunAuthorization;
  readonly snapshot: ReviewExecutionSnapshot;
  readonly lease: BoundContextGatewayLease;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}) {
  const { request, authorization, snapshot, lease, dependencies: d } = input;
  if (!lease.preparedManifestCanonicalJson) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "context_manifest_not_prepared",
    );
  }
  let manifest: ProviderInvocationManifest;
  try {
    manifest = normalizeProviderInvocationManifest(
      JSON.parse(lease.preparedManifestCanonicalJson),
    );
    if (
      serializeProviderInvocationManifestCanonicalWireJson(manifest) !==
      lease.preparedManifestCanonicalJson
    ) {
      throw new Error("context_manifest_not_canonical");
    }
  } catch {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "context_manifest_invalid",
    );
  }
  if (
    manifest.executionProfile !== ProviderExecutionProfile.ContextGatewayV1 &&
    manifest.executionProfile !==
      ProviderExecutionProfile.InvestigationGatewayV1
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "context_execution_profile_required",
    );
  }
  const slot = snapshot.execution.workSlots.find(
    (candidate) => candidate.workSlotId === request.sourceWorkSlotId,
  );
  if (
    !slot ||
    slot.providerVoteIdentityHash !== lease.providerVoteIdentityHash ||
    manifest.providerKind !== evidenceProviderKind(slot.providerKind)
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "context_work_slot_authority_mismatch",
    );
  }
  const [checkoutTreeOid, release] = await Promise.all([
    d.checkoutTrees.resolveCheckoutTreeOid(authorization),
    d.producerReleases.resolve({
      producerReleaseId: authorization.producerReleaseId,
    }),
  ]);
  requireEqual(
    checkoutTreeOid,
    request.checkoutTreeOid,
    "context_checkout_tree_mismatch",
  );
  if (
    !release ||
    manifest.producerReleaseId !== authorization.producerReleaseId ||
    manifest.selectedProtocolVersion !==
      authorization.selectedProtocolVersion ||
    release.contextGatewayPolicyVersion === null ||
    release.contextGatewayEntrypointDigest === null
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "context_release_authority_mismatch",
    );
  }
  requireEqual(
    request.gatewayPolicyVersion,
    release.contextGatewayPolicyVersion,
    "context_gateway_policy_mismatch",
  );
  requireEqual(
    request.gatewayBinaryHash,
    release.contextGatewayEntrypointDigest,
    "context_gateway_binary_mismatch",
  );
  const confinementProofHash = await d.digest.digestUtf8(
    (lease.authorityKind === ContextLeaseAuthorityKind.StandardExecution
      ? canonicalizeReviewContextConfinementEvidence
      : canonicalizeReviewInvestigationContextConfinementEvidence)({
      attemptId: request.attemptId,
      sourceLeaseId: request.sourceLeaseId,
      sourceFencingToken: request.fencingToken,
      sourceExecutionId: request.sourceExecutionId,
      sourceWorkSlotId: request.sourceWorkSlotId,
      sourceReviewRevisionHash: request.sourceReviewRevisionHash,
      checkoutTreeOid: request.checkoutTreeOid,
      providerKind: manifest.providerKind,
      requestedModel: manifest.requestedModel,
      executionProfile: manifest.executionProfile,
      providerInvocationKey: lease.providerInvocationKey,
      toolPolicyHash: manifest.toolPolicyHash,
      gatewayPolicyVersion: request.gatewayPolicyVersion,
      gatewayBinaryHash: request.gatewayBinaryHash,
    }),
  );
  requireEqual(
    confinementProofHash,
    request.confinementEvidenceHash,
    "context_confinement_evidence_mismatch",
  );
  const openingIntentHash = await d.digest.digestUtf8(
    openingIntentIdentity(lease.authorityKind, request.idempotencyKey),
  );
  return Object.freeze({
    scope: {
      workspaceId: authorization.workspaceId,
      repositoryConnectionId: authorization.repositoryConnectionId,
      scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
      pullRequestNumber: authorization.pullRequestNumber,
    },
    sourceRevision: {
      baseSha: authorization.baseSha,
      mergeBaseSha: authorization.mergeBaseSha,
      headSha: authorization.headSha,
      reviewRevisionHash: authorization.reviewRevisionHash,
      checkoutTreeOid: request.checkoutTreeOid,
    },
    sourceExecutionId: request.sourceExecutionId,
    sourceWorkSlotId: request.sourceWorkSlotId,
    attemptId: request.attemptId,
    openingIntentHash,
    sourceLeaseAuthorityKind: lease.authorityKind,
    sourceLeaseId: request.sourceLeaseId,
    sourceFencingToken: request.fencingToken,
    providerKind: contextProviderKind(manifest.providerKind),
    requestedModel: manifest.requestedModel,
    trustedCapabilityProfile: release.capabilityProfile,
    gatewayBinaryHash: request.gatewayBinaryHash,
    gatewayPolicyVersion: request.gatewayPolicyVersion,
    producerReleaseId: manifest.producerReleaseId,
    selectedProtocolVersion: manifest.selectedProtocolVersion,
    confinementProofHash,
    eventChainSeedHash: "0".repeat(64),
    sessionLifetimeMs: d.config.sessionLifetimeMs,
    sessionExpiresAtLimitMs: Math.min(
      authorization.expiresAt.getTime(),
      snapshot.execution.executionDeadlineAt.getTime(),
    ),
  });
}

async function requireBoundLease(input: {
  readonly authority: VerifiedReviewActionV2LeaseCapability;
  readonly authorization: ReviewRunAuthorization;
  readonly snapshot: ReviewExecutionSnapshot;
  readonly leaseId: string;
  readonly workSlotId: string;
  readonly attemptId: string;
  readonly fencingToken: string;
  readonly requireOwnership: boolean;
  readonly now: Date;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<ReviewInvocationLease> {
  const { authority, authorization, snapshot, dependencies: d } = input;
  requireEqual(
    authority.authorizationId,
    authorization.authorizationId,
    "context_lease_authorization_mismatch",
  );
  requireEqual(
    authority.scopeHash,
    await authorizationScopeHash(authorization, d.digest),
    "context_lease_scope_mismatch",
  );
  requireEqual(
    authority.mutationEpoch,
    authorization.mutationEpoch,
    "context_lease_mutation_epoch_mismatch",
  );
  requireEqual(
    authority.reviewRevisionHash,
    authorization.reviewRevisionHash,
    "context_lease_revision_mismatch",
  );
  requireEqual(authority.leaseId, input.leaseId, "context_lease_id_mismatch");
  requireEqual(
    authority.executionId,
    snapshot.execution.executionId,
    "context_lease_execution_mismatch",
  );
  requireEqual(
    authority.workSlotId,
    input.workSlotId,
    "context_lease_work_slot_mismatch",
  );
  requireEqual(
    authority.attemptId,
    input.attemptId,
    "context_lease_attempt_mismatch",
  );
  if (
    authority.purpose !== ReviewInvocationLeasePurpose.ProviderExecution ||
    (input.requireOwnership && authority.ownershipExpiresAt <= input.now) ||
    (!input.requireOwnership && authority.resultReportUntil <= input.now)
  ) {
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "context_lease_expired",
    );
  }
  const lease = await d.executionQueries.findLease(input.leaseId);
  if (
    !lease ||
    lease.leaseCapabilityId !== authority.capabilityId ||
    lease.executionId !== authority.executionId ||
    lease.workSlotId !== authority.workSlotId ||
    lease.attemptId !== authority.attemptId ||
    lease.providerInvocationKey !== authority.providerInvocationKey ||
    lease.fencingToken.toString(10) !== input.fencingToken ||
    lease.purpose !== ReviewInvocationLeasePurpose.ProviderExecution ||
    (input.requireOwnership &&
      (lease.state !== ReviewInvocationLeaseState.Active ||
        lease.expiresAt <= input.now))
  ) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "context_lease_fence_mismatch",
    );
  }
  return lease;
}

export async function resolveBoundContextGatewayLease(input: {
  readonly authorityKind: ContextLeaseAuthorityKind;
  readonly leaseCapability: string;
  readonly authorization: ReviewRunAuthorization;
  readonly leaseId: string;
  readonly workSlotId: string | null;
  readonly attemptId: string;
  readonly fencingToken: string;
  readonly sourceExecutionId: string | null;
  readonly requireOwnership: boolean;
  readonly operation: ReviewInvestigationLeaseProtectedOperation;
  readonly now: Date;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<
  Readonly<{
    snapshot: ReviewExecutionSnapshot;
    lease: BoundContextGatewayLease;
  }>
> {
  const { authorization, dependencies: d } = input;
  switch (input.authorityKind) {
    case ContextLeaseAuthorityKind.StandardExecution: {
      const authority = await verifyLeaseCapability(
        input.leaseCapability,
        input.now,
        d,
      );
      const snapshot = await requireExecution(
        authority.executionId,
        authorization,
        d.executionQueries,
      );
      if (
        (input.sourceExecutionId !== null &&
          input.sourceExecutionId !== authority.executionId) ||
        (input.workSlotId !== null && input.workSlotId !== authority.workSlotId)
      ) {
        throw failure(
          412,
          ReviewActionV2ProtocolErrorCode.StalePrecondition,
          "context_lease_request_binding_mismatch",
        );
      }
      const lease = await requireBoundLease({
        authority,
        authorization,
        snapshot,
        leaseId: input.leaseId,
        workSlotId: authority.workSlotId,
        attemptId: input.attemptId,
        fencingToken: input.fencingToken,
        requireOwnership: input.requireOwnership,
        now: input.now,
        dependencies: d,
      });
      if (!lease.preparedManifestCanonicalJson) {
        throw failure(
          412,
          ReviewActionV2ProtocolErrorCode.StalePrecondition,
          "context_manifest_not_prepared",
        );
      }
      return Object.freeze({
        snapshot,
        lease: Object.freeze({
          authorityKind: ContextLeaseAuthorityKind.StandardExecution,
          capabilityId: authority.capabilityId,
          authorizationId: authority.authorizationId,
          mutationEpoch: authority.mutationEpoch,
          scopeHash: authority.scopeHash,
          executionId: authority.executionId,
          workSlotId: authority.workSlotId,
          leaseId: authority.leaseId,
          attemptId: input.attemptId,
          providerInvocationKey: lease.providerInvocationKey,
          providerVoteIdentityHash: lease.providerVoteIdentityHash,
          preparedManifestCanonicalJson: lease.preparedManifestCanonicalJson,
          investigationRolloutCapability: null,
        }),
      });
    }
    case ContextLeaseAuthorityKind.InvestigationShadow:
      return resolveBoundInvestigationContextGatewayLease(input);
  }
}

async function resolveBoundInvestigationContextGatewayLease(input: {
  readonly leaseCapability: string;
  readonly authorization: ReviewRunAuthorization;
  readonly leaseId: string;
  readonly workSlotId: string | null;
  readonly attemptId: string;
  readonly fencingToken: string;
  readonly sourceExecutionId: string | null;
  readonly requireOwnership: boolean;
  readonly operation: ReviewInvestigationLeaseProtectedOperation;
  readonly now: Date;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<
  Readonly<{
    snapshot: ReviewExecutionSnapshot;
    lease: BoundContextGatewayLease;
  }>
> {
  const d = input.dependencies;
  let authority: VerifiedReviewActionV2InvestigationLeaseCapability;
  try {
    authority = await d.investigationLeaseCapabilities.verify(
      input.leaseCapability,
      input.now,
    );
  } catch {
    throw failure(
      401,
      ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      "context_investigation_lease_capability_invalid",
    );
  }
  const snapshot = await requireExecution(
    authority.executionId,
    input.authorization,
    d.executionQueries,
  );
  const lease = await d.investigationLeaseQueries.findLease(input.leaseId);
  const aggregate = lease
    ? await d.investigationQueries.findById(lease.investigationId)
    : null;
  if (
    !lease ||
    !aggregate ||
    authority.authorizationId !== input.authorization.authorizationId ||
    authority.scopeHash !==
      (await authorizationScopeHash(input.authorization, d.digest)) ||
    authority.mutationEpoch !== input.authorization.mutationEpoch ||
    authority.reviewRevisionHash !== input.authorization.reviewRevisionHash ||
    authority.capabilityId !== lease.leaseCapabilityId ||
    authority.authorizationId !== lease.authorizationId ||
    authority.mutationEpoch !== lease.mutationEpoch ||
    authority.executionId !== lease.executionId ||
    authority.workSlotId !== lease.workSlotId ||
    authority.leaseId !== lease.leaseId ||
    authority.attemptId !== lease.attemptId ||
    authority.fencingToken !== lease.fencingToken ||
    authority.investigationId !== lease.investigationId ||
    authority.investigationVersion !== lease.investigationVersion ||
    authority.turnId !== lease.turnId ||
    authority.turnPurpose !== lease.turnPurpose ||
    authority.providerVoteLaneId !== lease.providerVoteLaneId ||
    authority.providerStrategyId !== lease.providerStrategyId ||
    authority.investigationManifestHash !== lease.investigationManifestHash ||
    authority.ownerIdHash !== lease.ownerIdHash ||
    lease.leaseId !== input.leaseId ||
    lease.attemptId !== input.attemptId ||
    lease.fencingToken.toString(10) !== input.fencingToken ||
    (input.sourceExecutionId !== null &&
      lease.executionId !== input.sourceExecutionId) ||
    (input.workSlotId !== null && lease.workSlotId !== input.workSlotId) ||
    lease.state !== ReviewInvestigationLeaseState.Active ||
    (input.requireOwnership
      ? new Date(lease.expiresAt) <= input.now ||
        authority.ownershipExpiresAt <= input.now
      : new Date(lease.resultReportUntil) <= input.now ||
        authority.resultReportUntil <= input.now) ||
    !reviewInvestigationLeaseBindingIsCurrent(lease, aggregate)
  ) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "context_investigation_lease_stale",
    );
  }
  try {
    assertReviewInvestigationLeaseAllows(lease, input.operation);
  } catch {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "context_investigation_lease_operation_forbidden",
    );
  }
  return Object.freeze({
    snapshot,
    lease: investigationContextGatewayLease(authority, lease),
  });
}

function investigationContextGatewayLease(
  authority: VerifiedReviewActionV2InvestigationLeaseCapability,
  lease: ReviewInvestigationLease,
): BoundContextGatewayLease {
  return Object.freeze({
    authorityKind: ContextLeaseAuthorityKind.InvestigationShadow,
    capabilityId: authority.capabilityId,
    authorizationId: authority.authorizationId,
    mutationEpoch: authority.mutationEpoch,
    scopeHash: authority.scopeHash,
    executionId: authority.executionId,
    workSlotId: authority.workSlotId,
    leaseId: authority.leaseId,
    attemptId: authority.attemptId,
    providerInvocationKey: lease.providerStrategyId,
    providerVoteIdentityHash: lease.providerVoteLaneId,
    preparedManifestCanonicalJson: lease.investigationManifestCanonicalJson,
    investigationRolloutCapability:
      lease.turnPurpose === ReviewInvestigationTurnPurpose.Critic
        ? InvestigationRolloutCapability.ContextCritic
        : InvestigationRolloutCapability.Recording,
  });
}

export async function assertInvestigationShadowGatewayAllowed(input: {
  readonly authorization: ReviewRunAuthorization;
  readonly bound: Readonly<{
    snapshot: ReviewExecutionSnapshot;
    lease: BoundContextGatewayLease;
  }>;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<void> {
  const { authorization, bound, dependencies: d } = input;
  if (
    bound.lease.authorityKind !== ContextLeaseAuthorityKind.InvestigationShadow
  ) {
    return;
  }
  const capability = bound.lease.investigationRolloutCapability;
  const slot = bound.snapshot.execution.workSlots.find(
    (candidate) => candidate.workSlotId === bound.lease.workSlotId,
  );
  const providerKind = slot ? extensionProvider(slot.providerKind) : null;
  if (
    capability === null ||
    providerKind === null ||
    !slot ||
    slot.providerVoteIdentityHash !== bound.lease.providerVoteIdentityHash ||
    !hasAuthorizedReviewInvestigationExtension(authorization, {
      providerKind,
      capability,
      providerVoteIdentityHash: slot.providerVoteIdentityHash,
    })
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.CapabilityDisabled,
      "review_investigation_extension_not_authorized",
    );
  }
  await d.investigationRollout.assertAllowed({
    capability,
    target: {
      workspaceId: authorization.workspaceId,
      repositoryConnectionId: authorization.repositoryConnectionId,
      scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
      provider: rolloutProvider(slot.providerKind),
      trustDomain: authorization.trustDomain,
      producerReleaseId: authorization.producerReleaseId,
    },
  });
}

function extensionProvider(
  provider: ReviewExecutionProviderKind,
): ReviewInvestigationAuthorizedProviderKind | null {
  switch (provider) {
    case ReviewExecutionProviderKind.Codex:
      return "codex";
    case ReviewExecutionProviderKind.ClaudeCode:
      return "claude_code";
    // These engines have no RR investigation authorization.
    case ReviewExecutionProviderKind.OpenRouter:
    case ReviewExecutionProviderKind.Ocr:
      return null;
  }
}

function rolloutProvider(
  provider: ReviewExecutionProviderKind,
): InvestigationRolloutProvider {
  switch (provider) {
    case ReviewExecutionProviderKind.Codex:
      return InvestigationRolloutProvider.Codex;
    case ReviewExecutionProviderKind.ClaudeCode:
      return InvestigationRolloutProvider.Claude;
    case ReviewExecutionProviderKind.OpenRouter:
    case ReviewExecutionProviderKind.Ocr:
      return InvestigationRolloutProvider.Unknown;
  }
}

export async function assertSealAuthority(input: {
  readonly request:
    | ReviewContextGatewaySealRequest
    | ReviewInvestigationContextGatewaySealRequest;
  readonly authorization: ReviewRunAuthorization;
  readonly leaseAuthority: BoundContextGatewayLease;
  readonly sealAuthority:
    | ReviewActionV2ContextGatewaySealAuthority
    | ReviewActionV2InvestigationContextGatewaySealAuthority;
  readonly session: GatewaySession;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}) {
  const { request, authorization, leaseAuthority, sealAuthority, session } =
    input;
  const expected = {
    authorizationId: authorization.authorizationId,
    mutationEpoch: authorization.mutationEpoch,
    scopeHash: await authorizationScopeHash(
      authorization,
      input.dependencies.digest,
    ),
    sessionId: request.sessionId,
    sourceExecutionId: session.sourceExecutionId,
    sourceWorkSlotId: session.sourceWorkSlotId,
    attemptId: request.attemptId,
    sourceLeaseId: request.sourceLeaseId,
    sourceFencingToken: request.fencingToken,
    sourceReviewRevisionHash: authorization.reviewRevisionHash,
    checkoutTreeOid: session.sourceRevision.checkoutTreeOid,
    gatewayPolicyVersion: session.gatewayPolicyVersion,
    gatewayBinaryHash: session.gatewayBinaryHash,
    confinementEvidenceHash: session.confinementProofHash,
  };
  for (const key of Object.keys(
    expected,
  ) as readonly (keyof typeof expected)[]) {
    requireEqual(
      sealAuthority[key],
      expected[key],
      `context_seal_${key}_mismatch`,
    );
  }
  if (
    session.sourceLeaseAuthorityKind ===
    ContextLeaseAuthorityKind.InvestigationShadow
  ) {
    requireEqual(
      "sourceLeaseAuthorityKind" in sealAuthority
        ? sealAuthority.sourceLeaseAuthorityKind
        : null,
      "investigation_shadow",
      "context_seal_authority_kind_mismatch",
    );
  } else if ("sourceLeaseAuthorityKind" in sealAuthority) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "context_seal_authority_kind_mismatch",
    );
  }
  requireEqual(
    leaseAuthority.authorityKind,
    session.sourceLeaseAuthorityKind,
    "context_seal_lease_authority_kind_mismatch",
  );
  requireEqual(
    leaseAuthority.executionId,
    session.sourceExecutionId,
    "context_seal_execution_mismatch",
  );
  requireEqual(
    leaseAuthority.workSlotId,
    session.sourceWorkSlotId,
    "context_seal_slot_mismatch",
  );
}

export async function requireAuthorization(
  token: string,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
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
    throw failure(
      result.status === ReviewRunAuthorizationTokenResolutionStatus.Expired ||
        result.status === ReviewRunAuthorizationTokenResolutionStatus.Revoked
        ? 410
        : 401,
      result.status === ReviewRunAuthorizationTokenResolutionStatus.Expired ||
        result.status === ReviewRunAuthorizationTokenResolutionStatus.Revoked
        ? ReviewActionV2ProtocolErrorCode.ResourceGone
        : ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      `authorization_${result.status}`,
    );
  }
  if (
    result.authorization.state !== ReviewRunAuthorizationState.Active ||
    result.authorization.expiresAt <= d.now()
  ) {
    throw failure(
      410,
      ReviewActionV2ProtocolErrorCode.ResourceGone,
      "authorization_inactive",
    );
  }
  return result.authorization;
}

export async function requireExecution(
  executionId: string,
  authorization: ReviewRunAuthorization,
  queries: ReviewExecutionQueryPort,
): Promise<ReviewExecutionSnapshot> {
  const snapshot = await queries.findExecution(executionId);
  if (!snapshot) {
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "execution_missing",
    );
  }
  const execution = snapshot.execution;
  if (
    execution.authorizationId !== authorization.authorizationId ||
    execution.workspaceId !== authorization.workspaceId ||
    execution.repositoryConnectionId !== authorization.repositoryConnectionId ||
    execution.scmRepositoryIdentityId !==
      authorization.scmRepositoryIdentityId ||
    execution.pullRequestNumber !== authorization.pullRequestNumber ||
    execution.revision.reviewRevisionHash !== authorization.reviewRevisionHash
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "execution_authorization_mismatch",
    );
  }
  return snapshot;
}

async function verifyLeaseCapability(
  token: string,
  now: Date,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
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

export async function assertBodyHash<O extends ReviewActionV2OperationId>(
  operation: O,
  request: ReviewActionV2RequestMap[O],
  digest: ReviewActionV2ContextDigestPort,
) {
  if (
    (await digest.digestUtf8(
      canonicalizeReviewActionV2RequestForSlot(operation, request),
    )) !== (request as { requestBodyHash?: string }).requestBodyHash
  ) {
    throw failure(
      400,
      ReviewActionV2ProtocolErrorCode.InvalidRequest,
      "request_body_hash_mismatch",
    );
  }
}

function evidenceProviderKind(value: string): ReviewProviderKind {
  if (value === ReviewProviderKind.Codex) return ReviewProviderKind.Codex;
  if (value === ReviewProviderKind.ClaudeCode)
    return ReviewProviderKind.ClaudeCode;
  if (value === ReviewProviderKind.OpenRouter)
    return ReviewProviderKind.OpenRouter;
  throw failure(
    422,
    ReviewActionV2ProtocolErrorCode.InvariantViolation,
    "context_provider_unknown",
  );
}

function contextProviderKind(value: ReviewProviderKind): ContextProviderKind {
  switch (value) {
    case ReviewProviderKind.Codex:
      return ContextProviderKind.Codex;
    case ReviewProviderKind.ClaudeCode:
      return ContextProviderKind.ClaudeCode;
    case ReviewProviderKind.OpenRouter:
      return ContextProviderKind.OpenRouter;
    default:
      throw failure(
        422,
        ReviewActionV2ProtocolErrorCode.InvariantViolation,
        "context_provider_unknown",
      );
  }
}
