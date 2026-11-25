// Re-evaluate current reuse authority and source bindings before accepting replay evidence.
import {
  TargetReplayProofVerificationStatus,
  VerifyTargetReplayProof,
  type ContextGatewayV4Manifest,
  type GatewaySession,
} from "@reviewrouter/features-review-context-attestation";
import {
  ReuseEligibility,
  ReviewReuseDenialReason,
  ReviewReuseEffectMode,
  ReviewReuseTier,
  canonicalizeReviewContextReusePolicyVector,
  decideReviewReuseEligibility,
  normalizeProviderInvocationManifest,
  reviewReuseEligibilityPolicyVersion,
  stableJson,
  type ProviderInvocationManifest,
  type ReviewObservation,
  type ReviewTrustDomain,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewObservationAttachmentKind,
  type ReviewExecutionSnapshot,
} from "@reviewrouter/features-review-executions";
import {
  canonicalJson,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { ReviewActionV2ProtocolErrorCode } from "@reviewrouter/protocol-review-action-v2";
import type {
  ReviewActionV2ContextReplayAuthority,
  ReviewActionV2InvestigationReceiptReplayAuthority,
  ReviewActionV2ReusableAttachmentAuthority,
} from "./review-action-v2-execution-evidence-capabilities.js";
import type {
  ReviewActionV2ContextAttestationHandlerDependencies,
  ReviewActionV2ContextReplayPrepareInput,
} from "./review-action-v2-context-attestation-types.js";
import {
  authorizationScopeHash,
  deriveGatewaySessionSecret,
  gatewaySecretIdentity,
  hashReplayProof,
  replayMaterialAssociatedData,
} from "./review-action-v2-context-attestation-crypto.js";
import {
  parseReplayMaterial,
  selectGatewayV4ReplayOperations,
  targetManifestMatchesGatewayV4Plan,
} from "./review-action-v2-context-attestation-replay-material.js";
import { failure } from "./review-action-v2-context-attestation-validation.js";

export async function verifyInvestigationReceiptReplayAuthorityCurrent(input: {
  readonly authorization: ReviewRunAuthorization;
  readonly authority: ReviewActionV2InvestigationReceiptReplayAuthority;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<boolean> {
  const { authorization, authority, dependencies: d } = input;
  const attestation = await d.store.findAcceptedAttestation(
    authority.attestationId,
  );
  const session = attestation
    ? await d.store.findSession(attestation.sessionId)
    : null;
  const release = await d.producerReleases.resolve({
    producerReleaseId: authority.producerReleaseId,
  });
  const scopeHash = await authorizationScopeHash(authorization, d.digest);
  const policy = await d.reusePolicy.resolveReviewReusePolicy({
    scope: {
      workspaceId: authorization.workspaceId,
      repositoryConnectionId: authorization.repositoryConnectionId,
      scmRepositoryIdentityId: authorization.scmRepositoryIdentityId,
      pullRequestNumber: authorization.pullRequestNumber,
      authorizationScopeHash: scopeHash,
    },
    revision: {
      baseSha: authorization.baseSha,
      mergeBaseSha: authorization.mergeBaseSha,
      headSha: authorization.headSha,
      reviewRevisionHash: authorization.reviewRevisionHash,
    },
    providerKind: authority.providerKind,
    taskKindSet: authority.taskKindSet,
    trustDomain: authorization.trustDomain as unknown as ReviewTrustDomain,
    producerReleaseId: authority.producerReleaseId,
  });
  if (
    !attestation ||
    !session ||
    !release ||
    !policy ||
    attestation.attestationHash !== authority.attestationHash ||
    attestation.reuseExpiresAtMs <= d.now().getTime() ||
    attestation.actualModel !== authority.requestedModel ||
    policy.safetyDecision.contextGatewayReuseMode !==
      ReviewReuseEffectMode.Enabled ||
    release.capabilityProfile !== session.trustedCapabilityProfile ||
    release.contextGatewayPolicyVersion !== authority.gatewayPolicyVersion ||
    release.contextGatewayEntrypointDigest !== authority.gatewayBinaryHash
  ) {
    return false;
  }
  const currentVector = await d.digest.digestUtf8(
    canonicalizeReviewContextReusePolicyVector({
      safetyDecision: policy.safetyDecision,
      compatibility: policy.compatibility,
      eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      gatewayPolicyVersion: session.gatewayPolicyVersion,
      gatewayBinaryHash: session.gatewayBinaryHash,
      trustedCapabilityProfile: session.trustedCapabilityProfile,
      producerReleaseId: authority.producerReleaseId,
      providerKind: authority.providerKind,
      requestedModel: authority.requestedModel,
      actualModel: attestation.actualModel,
    }),
  );
  return currentVector === authority.reusePolicyVectorHash;
}

export async function verifyInvestigationReceiptReplayPlanBinding(input: {
  readonly authority: ReviewActionV2InvestigationReceiptReplayAuthority;
  readonly replayedManifest: ContextGatewayV4Manifest;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<boolean> {
  const { authority, replayedManifest, dependencies: d } = input;
  try {
    const [attestation, material] = await Promise.all([
      d.store.findAcceptedAttestation(authority.attestationId),
      d.store.findReplayMaterialByAttestationId(authority.attestationId),
    ]);
    if (
      !attestation ||
      !material ||
      attestation.attestationHash !== authority.attestationHash ||
      attestation.manifest.manifestVersion !== 3
    ) {
      return false;
    }
    const session = await d.store.findSession(attestation.sessionId);
    if (!session) return false;
    const plaintext = await d.cipher.decrypt({
      material,
      associatedDataCanonicalJson: replayMaterialAssociatedData(session),
    });
    const replayMaterial = parseReplayMaterial(
      plaintext,
      attestation.manifest,
      session,
      deriveGatewaySessionSecret(
        d.sessionSecretKey,
        gatewaySecretIdentity(session),
      ),
    );
    if (!("entries" in replayMaterial)) return false;
    const sourceOperationReceiptIds = [
      ...new Set(authority.sourceOperationReceiptIds),
    ].sort();
    if (
      sourceOperationReceiptIds.length !==
        authority.sourceOperationReceiptIds.length ||
      sourceOperationReceiptIds.some(
        (value, index) => value !== authority.sourceOperationReceiptIds[index],
      )
    ) {
      return false;
    }
    const sourceOperationReceiptIdsHash = await d.digest.digestUtf8(
      canonicalJson({ operationReceiptIds: sourceOperationReceiptIds }),
    );
    if (
      sourceOperationReceiptIdsHash !== authority.sourceOperationReceiptIdsHash
    ) {
      return false;
    }
    const operations = selectGatewayV4ReplayOperations(
      attestation.manifest,
      replayMaterial,
      sourceOperationReceiptIds,
    );
    if (!operations || operations.length === 0) return false;
    const plan = Object.freeze({
      planVersion: 2 as const,
      attestationId: authority.attestationId,
      attestationHash: authority.attestationHash,
      gatewayPolicyVersion: authority.gatewayPolicyVersion,
      gatewayBinaryHash: authority.gatewayBinaryHash,
      sourceOperationReceiptIds,
      sourceOperationReceiptIdsHash,
      operations,
    });
    if (
      (await d.digest.digestUtf8(stableJson(plan as never))) !==
      authority.contextReplayPlanHash
    ) {
      return false;
    }
    return targetManifestMatchesGatewayV4Plan(replayedManifest, operations);
  } catch {
    return false;
  }
}

export async function verifyReplayAuthorityCurrent(input: {
  readonly authorization: ReviewRunAuthorization;
  readonly snapshot: ReviewExecutionSnapshot;
  readonly replayAuthority: ReviewActionV2ContextReplayAuthority;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}): Promise<boolean> {
  const { replayAuthority, dependencies: d } = input;
  const observation = await d.observations.findById(
    replayAuthority.attachment.observationId,
  );
  const attestation = await d.store.findAcceptedAttestation(
    replayAuthority.attestationId,
  );
  const session = attestation
    ? await d.store.findSession(attestation.sessionId)
    : null;
  if (
    !observation ||
    !attestation ||
    !session ||
    observation.contextDependencyAttestationId !==
      replayAuthority.attestationId ||
    observation.contextDependencyAttestationHash !==
      replayAuthority.attestationHash ||
    replayAuthority.attachment.observationId !== observation.observationId ||
    replayAuthority.attachment.manifestKey !== observation.manifestKey ||
    replayAuthority.attachment.providerInvocationKey !==
      observation.providerInvocationKey ||
    replayAuthority.attachment.providerVoteIdentityHash !==
      observation.providerVoteIdentityHash
  ) {
    return false;
  }
  const current = await resolveCurrentCandidate({
    authorization: input.authorization,
    snapshot: input.snapshot,
    workSlotId: replayAuthority.attachment.targetWorkSlotId,
    manifest: replayAuthority.attachment.manifest,
    manifestKey: replayAuthority.attachment.manifestKey,
    providerInvocationKey: replayAuthority.attachment.providerInvocationKey,
    providerVoteIdentityHash:
      replayAuthority.attachment.providerVoteIdentityHash,
    trustDomain: replayAuthority.attachment.trustDomain,
    observation,
    targetCheckoutTreeOid: replayAuthority.targetCheckoutTreeOid,
    session,
    dependencies: d,
  });
  return (
    current?.reusePolicyVectorHash === replayAuthority.reusePolicyVectorHash
  );
}

export async function verifyContextAttachment(
  input: {
    readonly authorization: ReviewRunAuthorization;
    readonly snapshot: ReviewExecutionSnapshot;
    readonly authority: ReviewActionV2ReusableAttachmentAuthority;
  },
  d: ReviewActionV2ContextAttestationHandlerDependencies,
): Promise<boolean> {
  if (
    input.authority.attachmentKind !==
      ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse ||
    !input.authority.contextReplayProofId ||
    !input.authority.contextReplayProofHash ||
    !input.authority.contextAttestationId ||
    !input.authority.contextAttestationHash ||
    !input.authority.targetCheckoutTreeOid ||
    !input.authority.replayBinaryHash ||
    !input.authority.replayPolicyVersion
  ) {
    return false;
  }
  const observation = await d.observations.findById(
    input.authority.observationId,
  );
  if (
    !observation ||
    observation.contextDependencyAttestationId !==
      input.authority.contextAttestationId ||
    observation.contextDependencyAttestationHash !==
      input.authority.contextAttestationHash
  ) {
    return false;
  }
  const attestation = await d.store.findAcceptedAttestation(
    input.authority.contextAttestationId,
  );
  const session = attestation
    ? await d.store.findSession(attestation.sessionId)
    : null;
  const targetTree = await d.checkoutTrees.resolveCheckoutTreeOid(
    input.authorization,
  );
  if (
    !attestation ||
    !session ||
    !targetTree ||
    targetTree !== input.authority.targetCheckoutTreeOid
  ) {
    return false;
  }
  const current = await resolveCurrentCandidate({
    authorization: input.authorization,
    snapshot: input.snapshot,
    workSlotId: input.authority.targetWorkSlotId,
    manifest: input.authority.manifest,
    manifestKey: input.authority.manifestKey,
    providerInvocationKey: input.authority.providerInvocationKey,
    providerVoteIdentityHash: input.authority.providerVoteIdentityHash,
    trustDomain: input.authority.trustDomain,
    observation,
    targetCheckoutTreeOid: targetTree,
    session,
    dependencies: d,
  });
  if (
    !current ||
    current.reusePolicyVectorHash !== input.authority.reuseSafetyDecisionHash
  ) {
    return false;
  }
  const verifier = new VerifyTargetReplayProof({
    store: d.store,
    clock: { nowMs: () => d.now().getTime() },
  });
  const verified = await verifier.execute({
    replayProofId: input.authority.contextReplayProofId,
    sourceAttestationId: input.authority.contextAttestationId,
    sourceAttestationHash: input.authority.contextAttestationHash,
    targetExecutionId: input.authority.targetExecutionId,
    targetWorkSlotId: input.authority.targetWorkSlotId,
    targetReviewRevisionHash: input.authority.targetReviewRevisionHash,
    targetCheckoutTreeOid: input.authority.targetCheckoutTreeOid,
    replayBinaryHash: input.authority.replayBinaryHash,
    replayPolicyVersion: input.authority.replayPolicyVersion,
    reusePolicyVectorHash: current.reusePolicyVectorHash,
  });
  return (
    verified.status === TargetReplayProofVerificationStatus.Accepted &&
    verified.proof !== null &&
    (await hashReplayProof(verified.proof, d.digest)) ===
      input.authority.contextReplayProofHash
  );
}

export async function assertCurrentContextReusePolicy(
  input: {
    readonly authorization: ReviewRunAuthorization;
    readonly snapshot: ReviewExecutionSnapshot;
  },
  d: ReviewActionV2ContextAttestationHandlerDependencies,
): Promise<void> {
  const refs = input.snapshot.observationRefs.filter(
    (ref) =>
      ref.attachmentKind ===
      ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse,
  );
  for (const ref of refs) {
    const observation = await d.observations.findById(ref.observationId);
    if (
      !observation ||
      !observation.contextDependencyAttestationId ||
      !ref.reuseSafetyDecisionHash
    ) {
      throw stalePolicy();
    }
    const attestation = await d.store.findAcceptedAttestation(
      observation.contextDependencyAttestationId,
    );
    const session = attestation
      ? await d.store.findSession(attestation.sessionId)
      : null;
    const slot = input.snapshot.execution.workSlots.find(
      (candidate) => candidate.workSlotId === ref.workSlotId,
    );
    const lease = await findPreparedLeaseForObservation(observation, d);
    if (
      !attestation ||
      !session ||
      !slot ||
      !lease?.preparedManifestCanonicalJson
    ) {
      throw stalePolicy();
    }
    let manifest: ProviderInvocationManifest;
    try {
      manifest = normalizeProviderInvocationManifest(
        JSON.parse(lease.preparedManifestCanonicalJson),
      );
    } catch {
      throw stalePolicy();
    }
    const current = await resolveCurrentCandidate({
      authorization: input.authorization,
      snapshot: input.snapshot,
      workSlotId: ref.workSlotId,
      manifest,
      manifestKey: observation.manifestKey,
      providerInvocationKey: observation.providerInvocationKey,
      providerVoteIdentityHash: observation.providerVoteIdentityHash,
      trustDomain: observation.trustDomain,
      observation,
      targetCheckoutTreeOid:
        (await d.checkoutTrees.resolveCheckoutTreeOid(input.authorization)) ??
        "",
      session,
      dependencies: d,
    });
    if (
      !current ||
      current.reusePolicyVectorHash !== ref.reuseSafetyDecisionHash
    ) {
      throw stalePolicy();
    }
  }
}

export async function resolveCurrentCandidate(
  input: ReviewActionV2ContextReplayPrepareInput & {
    readonly targetCheckoutTreeOid: string;
    readonly session: GatewaySession;
    readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
  },
): Promise<{ readonly reusePolicyVectorHash: string } | null> {
  const d = input.dependencies;
  const scopeHash = await authorizationScopeHash(input.authorization, d.digest);
  const policy = await d.reusePolicy.resolveReviewReusePolicy({
    scope: {
      workspaceId: input.authorization.workspaceId,
      repositoryConnectionId: input.authorization.repositoryConnectionId,
      scmRepositoryIdentityId: input.authorization.scmRepositoryIdentityId,
      pullRequestNumber: input.authorization.pullRequestNumber,
      authorizationScopeHash: scopeHash,
    },
    revision: {
      baseSha: input.authorization.baseSha,
      mergeBaseSha: input.authorization.mergeBaseSha,
      headSha: input.authorization.headSha,
      reviewRevisionHash: input.authorization.reviewRevisionHash,
    },
    providerKind: input.manifest.providerKind,
    taskKindSet: input.manifest.taskKindSet,
    trustDomain: input.trustDomain,
    producerReleaseId: input.manifest.producerReleaseId,
  });
  if (!policy) return null;
  const decision = decideReviewReuseEligibility(input.observation, {
    scope: {
      workspaceId: input.authorization.workspaceId,
      repositoryConnectionId: input.authorization.repositoryConnectionId,
      scmRepositoryIdentityId: input.authorization.scmRepositoryIdentityId,
      pullRequestNumber: input.authorization.pullRequestNumber,
      authorizationScopeHash: scopeHash,
    },
    revision: {
      baseSha: input.authorization.baseSha,
      mergeBaseSha: input.authorization.mergeBaseSha,
      headSha: input.authorization.headSha,
      reviewRevisionHash: input.authorization.reviewRevisionHash,
    },
    planHash: input.snapshot.execution.planHash,
    executionId: input.snapshot.execution.executionId,
    manifest: input.manifest,
    manifestKey: input.manifestKey,
    providerInvocationKey: input.providerInvocationKey,
    providerVoteIdentityHash: input.providerVoteIdentityHash,
    trustDomain: input.trustDomain,
    nowMs: d.now().getTime(),
    safetyDecision: policy.safetyDecision,
    compatibility: policy.compatibility,
  });
  if (
    decision.eligibility !== ReuseEligibility.CandidateOnly ||
    decision.tier !== ReviewReuseTier.T2ContextGatewayCrossRevision ||
    decision.reason !== ReviewReuseDenialReason.ContextReplayRequired ||
    policy.safetyDecision.contextGatewayReuseMode !==
      ReviewReuseEffectMode.Enabled
  ) {
    return null;
  }
  const release = await d.producerReleases.resolve({
    producerReleaseId: input.manifest.producerReleaseId,
  });
  if (
    !release ||
    release.capabilityProfile !== input.session.trustedCapabilityProfile ||
    input.session.gatewayPolicyVersion !==
      release.contextGatewayPolicyVersion ||
    input.session.gatewayBinaryHash !== release.contextGatewayEntrypointDigest
  ) {
    return null;
  }
  const reusePolicyVectorHash = await d.digest.digestUtf8(
    canonicalizeReviewContextReusePolicyVector({
      safetyDecision: policy.safetyDecision,
      compatibility: policy.compatibility,
      eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      gatewayPolicyVersion: input.session.gatewayPolicyVersion,
      gatewayBinaryHash: input.session.gatewayBinaryHash,
      trustedCapabilityProfile: input.session.trustedCapabilityProfile,
      producerReleaseId: input.manifest.producerReleaseId,
      providerKind: input.manifest.providerKind,
      requestedModel: input.manifest.requestedModel,
      actualModel: input.observation.actualModel,
    }),
  );
  return Object.freeze({ reusePolicyVectorHash });
}

async function findPreparedLeaseForObservation(
  observation: ReviewObservation,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
) {
  return d.executionQueries.findLease(observation.sourceLeaseId);
}

function stalePolicy() {
  return failure(
    412,
    ReviewActionV2ProtocolErrorCode.StalePrecondition,
    "context_reuse_policy_vector_stale",
  );
}
