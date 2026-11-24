// Prepare and commit context replay while retaining exact capability and persistence ordering.
import {
  ContextDependencyKind,
  ContextProviderKind,
  ReplayContextAttestation,
  ReplayContextAttestationStatus,
  contextGatewayV4PolicyVersion,
  isLegacyContextDependencyManifest,
} from "@reviewrouter/features-review-context-attestation";
import type {
  InvestigationReplayPreparationPort,
  PreparedInvestigationReceiptReplay,
} from "@reviewrouter/features-review-investigations";
import {
  ReviewReuseEffectMode,
  ReviewProviderKind,
  canonicalizeReviewContextReusePolicyVector,
  reviewReuseEligibilityPolicyVersion,
  stableJson,
  type ReviewTrustDomain,
} from "@reviewrouter/features-review-evidence";
import { ReviewObservationAttachmentKind } from "@reviewrouter/features-review-executions";
import {
  canonicalJson,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  type ReviewContextReceiptReplayCommitRequest,
  type ReviewContextReplayCommitRequest,
} from "@reviewrouter/protocol-review-action-v2";
import type {
  ReviewActionV2ContextReplayAuthority,
  ReviewActionV2InvestigationReceiptReplayAuthority,
  ReviewActionV2ReusableAttachmentAuthority,
} from "./review-action-v2-execution-evidence-capabilities.js";
import {
  mapReplayStatus,
  replayDenied,
  mapReceiptReplayStatus,
  receiptReplayDenied,
} from "./review-action-v2-context-result-mappers.js";
import {
  type ReplayPlanSourceDependency,
  type ReviewActionV2ContextAttestationHandlerDependencies,
  type ReviewActionV2ContextReplayPlan,
  type ReviewActionV2ContextReplayPreparation,
  type ReviewActionV2ContextReplayPrepareInput,
  type ReviewActionV2InvestigationReplayTarget,
  replayPlanVersion,
} from "./review-action-v2-context-attestation-types.js";
import {
  authorizationScopeHash,
  contextIdentities,
  deriveGatewaySessionSecret,
  gatewaySecretIdentity,
  hashReplayProof,
  replayMaterialAssociatedData,
} from "./review-action-v2-context-attestation-crypto.js";
import {
  assertBodyHash,
  requireAuthorization,
  requireExecution,
} from "./review-action-v2-context-attestation-admission.js";
import {
  resolveCurrentCandidate,
  verifyInvestigationReceiptReplayAuthorityCurrent,
  verifyInvestigationReceiptReplayPlanBinding,
  verifyReplayAuthorityCurrent,
} from "./review-action-v2-context-attestation-replay-authority.js";
import {
  parseReplayMaterial,
  selectGatewayV4ReplayOperations,
  verifySyntheticGatewayV4ReplayChain,
  verifySyntheticReplayChain,
} from "./review-action-v2-context-attestation-replay-material.js";
import {
  failure,
  parseContextManifest,
  requireEqual,
  requireHash,
  requiredString,
} from "./review-action-v2-context-attestation-validation.js";

export async function commitReplay(
  request: ReviewContextReplayCommitRequest,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewContextReplayCommit,
    request,
    d.digest,
  );
  const now = d.now();
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  const snapshot = await requireExecution(
    request.executionId,
    authorization,
    d.executionQueries,
  );
  let replayAuthority: ReviewActionV2ContextReplayAuthority;
  try {
    replayAuthority = await d.capabilities.verifyContextReplay(
      request.replayCapability,
      now,
    );
  } catch {
    throw failure(
      401,
      ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      "context_replay_capability_invalid",
    );
  }
  assertReplayRequestAuthority(request, authorization, replayAuthority);
  const targetTree =
    await d.checkoutTrees.resolveCheckoutTreeOid(authorization);
  requireEqual(
    targetTree,
    request.targetCheckoutTreeOid,
    "context_target_tree_stale",
  );
  const replayedManifest = parseContextManifest(
    request.replayResultCanonicalJson,
    "context_replay_result_invalid",
  );
  if (!isLegacyContextDependencyManifest(replayedManifest)) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.CapabilityDisabled,
      "context_gateway_v4_replay_disabled",
    );
  }
  await requireHash(
    request.replayResultCanonicalJson,
    request.replayResultHash,
    "context_replay_result_hash_mismatch",
    d.digest,
  );
  requireEqual(
    replayedManifest.checkoutTreeOid,
    request.targetCheckoutTreeOid,
    "context_replay_result_tree_mismatch",
  );
  requireEqual(
    replayedManifest.gatewayPolicyVersion,
    replayAuthority.gatewayPolicyVersion,
    "context_replay_policy_mismatch",
  );
  requireEqual(
    replayedManifest.gatewayBinaryHash,
    replayAuthority.gatewayBinaryHash,
    "context_replay_binary_mismatch",
  );
  verifySyntheticReplayChain(
    replayedManifest,
    replayAuthority.contextReplayPlanHash,
    replayAuthority.attestationId,
    request.targetReviewRevisionHash,
    request.targetCheckoutTreeOid,
  );
  if (
    !(await verifyReplayAuthorityCurrent({
      authorization,
      snapshot,
      replayAuthority,
      dependencies: d,
    }))
  ) {
    return replayDenied();
  }
  const replay = new ReplayContextAttestation({
    store: d.store,
    targetFacts: {
      resolveTargetReplayFacts: async (command) =>
        command.targetExecutionId === request.executionId &&
        command.targetWorkSlotId === request.workSlotId &&
        command.replayCapabilityId === replayAuthority.capabilityId
          ? {
              targetExecutionId: request.executionId,
              targetWorkSlotId: request.workSlotId,
              targetRevision: {
                baseSha: authorization.baseSha,
                mergeBaseSha: authorization.mergeBaseSha,
                headSha: authorization.headSha,
                reviewRevisionHash: authorization.reviewRevisionHash,
                checkoutTreeOid: request.targetCheckoutTreeOid,
              },
              replayBinaryHash: replayAuthority.gatewayBinaryHash,
              replayPolicyVersion: replayAuthority.gatewayPolicyVersion,
              reusePolicyVectorHash: replayAuthority.reusePolicyVectorHash,
              sourceOperationReceiptIds: [],
              sourceOperationReceiptIdsHash: null,
              proofLifetimeMs: d.config.replayProofLifetimeMs,
            }
          : null,
    },
    identities: contextIdentities(d),
    clock: { nowMs: () => d.now().getTime() },
  });
  const outcome = await replay.execute({
    sourceAttestationId: request.attestationId,
    sourceAttestationHash: request.attestationHash,
    targetExecutionId: request.executionId,
    targetWorkSlotId: request.workSlotId,
    replayCapabilityId: requiredString(
      replayAuthority.capabilityId,
      "context_replay_capability_id_missing",
    ),
    replayedManifest,
  });
  if (!outcome.proof) {
    return {
      statusCode: 200 as const,
      result: {
        status: mapReplayStatus(outcome.status),
        replayProofId: null,
        replayProofHash: null,
        attachmentCapability: null,
      },
    };
  }
  const replayProofHash = await hashReplayProof(outcome.proof, d.digest);
  const attachmentCapability = await d.capabilities.issueReusableAttachment(
    {
      ...replayAuthority.attachment,
      attachmentKind:
        ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse,
      reuseSafetyDecisionHash: replayAuthority.reusePolicyVectorHash,
      contextReplayProofId: outcome.proof.replayProofId,
      contextReplayProofHash: replayProofHash,
      contextAttestationId: replayAuthority.attestationId,
      contextAttestationHash: replayAuthority.attestationHash,
      targetCheckoutTreeOid: replayAuthority.targetCheckoutTreeOid,
      replayBinaryHash: replayAuthority.gatewayBinaryHash,
      replayPolicyVersion: replayAuthority.gatewayPolicyVersion,
      expiresAt: minDate(
        replayAuthority.attachment.expiresAt,
        new Date(outcome.proof.expiresAtMs),
      ),
    },
    new Date(outcome.proof.createdAtMs),
  );
  return {
    statusCode:
      outcome.status === ReplayContextAttestationStatus.Accepted
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapReplayStatus(outcome.status),
      replayProofId: outcome.proof.replayProofId,
      replayProofHash,
      attachmentCapability,
    },
  };
}

export async function commitReceiptReplay(
  request: ReviewContextReceiptReplayCommitRequest,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
) {
  await assertBodyHash(
    ReviewActionV2OperationId.ReviewContextReceiptReplayCommit,
    request,
    d.digest,
  );
  const now = d.now();
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  await requireExecution(
    request.executionId,
    authorization,
    d.executionQueries,
  );
  let authority: ReviewActionV2InvestigationReceiptReplayAuthority;
  try {
    authority = await d.capabilities.verifyInvestigationReceiptReplay(
      request.replayCapability,
      now,
    );
  } catch {
    throw failure(
      401,
      ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      "investigation_receipt_replay_capability_invalid",
    );
  }
  assertReceiptReplayRequestAuthority(request, authority);
  const targetTree =
    await d.checkoutTrees.resolveCheckoutTreeOid(authorization);
  requireEqual(
    targetTree,
    request.targetCheckoutTreeOid,
    "investigation_receipt_replay_target_tree_stale",
  );
  const replayedManifest = parseContextManifest(
    request.replayResultCanonicalJson,
    "investigation_receipt_replay_result_invalid",
  );
  if (isLegacyContextDependencyManifest(replayedManifest)) {
    throw failure(
      412,
      ReviewActionV2ProtocolErrorCode.StalePrecondition,
      "investigation_receipt_replay_manifest_invalid",
    );
  }
  await requireHash(
    request.replayResultCanonicalJson,
    request.replayResultHash,
    "investigation_receipt_replay_result_hash_mismatch",
    d.digest,
  );
  requireEqual(
    replayedManifest.checkoutTreeOid,
    request.targetCheckoutTreeOid,
    "investigation_receipt_replay_tree_mismatch",
  );
  requireEqual(
    replayedManifest.gatewayPolicyVersion,
    authority.gatewayPolicyVersion,
    "investigation_receipt_replay_policy_mismatch",
  );
  requireEqual(
    replayedManifest.gatewayBinaryHash,
    authority.gatewayBinaryHash,
    "investigation_receipt_replay_binary_mismatch",
  );
  verifySyntheticGatewayV4ReplayChain(
    replayedManifest,
    authority.contextReplayPlanHash,
    authority.attestationId,
    request.targetReviewRevisionHash,
    request.targetCheckoutTreeOid,
  );
  if (
    !(await verifyInvestigationReceiptReplayPlanBinding({
      authority,
      replayedManifest,
      dependencies: d,
    }))
  ) {
    return receiptReplayDenied();
  }
  if (
    !(await verifyInvestigationReceiptReplayAuthorityCurrent({
      authorization,
      authority,
      dependencies: d,
    }))
  ) {
    return receiptReplayDenied();
  }
  const replay = new ReplayContextAttestation({
    store: d.store,
    targetFacts: {
      resolveTargetReplayFacts: async (command) =>
        command.targetExecutionId === request.executionId &&
        command.targetWorkSlotId === request.workSlotId &&
        command.replayCapabilityId === authority.capabilityId
          ? {
              targetExecutionId: request.executionId,
              targetWorkSlotId: request.workSlotId,
              targetRevision: {
                baseSha: authorization.baseSha,
                mergeBaseSha: authorization.mergeBaseSha,
                headSha: authorization.headSha,
                reviewRevisionHash: authorization.reviewRevisionHash,
                checkoutTreeOid: request.targetCheckoutTreeOid,
              },
              replayBinaryHash: authority.gatewayBinaryHash,
              replayPolicyVersion: authority.gatewayPolicyVersion,
              reusePolicyVectorHash: authority.reusePolicyVectorHash,
              sourceOperationReceiptIds: authority.sourceOperationReceiptIds,
              sourceOperationReceiptIdsHash:
                authority.sourceOperationReceiptIdsHash,
              proofLifetimeMs: d.config.replayProofLifetimeMs,
            }
          : null,
    },
    identities: contextIdentities(d),
    clock: { nowMs: () => d.now().getTime() },
  });
  const outcome = await replay.execute({
    sourceAttestationId: request.attestationId,
    sourceAttestationHash: request.attestationHash,
    targetExecutionId: request.executionId,
    targetWorkSlotId: request.workSlotId,
    replayCapabilityId: requiredString(
      authority.capabilityId,
      "investigation_receipt_replay_capability_id_missing",
    ),
    replayedManifest,
  });
  const proofHash = outcome.proof
    ? await hashReplayProof(outcome.proof, d.digest)
    : null;
  return {
    statusCode:
      outcome.status === ReplayContextAttestationStatus.Accepted
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapReceiptReplayStatus(outcome.status),
      replayProofId: outcome.proof?.replayProofId ?? null,
      replayProofHash: proofHash,
    },
  };
}

function assertReceiptReplayRequestAuthority(
  request: ReviewContextReceiptReplayCommitRequest,
  authority: ReviewActionV2InvestigationReceiptReplayAuthority,
): void {
  requireEqual(
    authority.attestationId,
    request.attestationId,
    "investigation_receipt_replay_attestation_id_mismatch",
  );
  requireEqual(
    authority.attestationHash,
    request.attestationHash,
    "investigation_receipt_replay_attestation_hash_mismatch",
  );
  requireEqual(
    authority.targetExecutionId,
    request.executionId,
    "investigation_receipt_replay_execution_mismatch",
  );
  requireEqual(
    authority.targetWorkSlotId,
    request.workSlotId,
    "investigation_receipt_replay_slot_mismatch",
  );
  requireEqual(
    authority.targetReviewRevisionHash,
    request.targetReviewRevisionHash,
    "investigation_receipt_replay_revision_mismatch",
  );
  requireEqual(
    authority.targetCheckoutTreeOid,
    request.targetCheckoutTreeOid,
    "investigation_receipt_replay_tree_mismatch",
  );
}

export async function prepareReplay(
  input: ReviewActionV2ContextReplayPrepareInput,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
): Promise<ReviewActionV2ContextReplayPreparation | null> {
  const attestationId = input.observation.contextDependencyAttestationId;
  const attestationHash = input.observation.contextDependencyAttestationHash;
  if (!attestationId || !attestationHash) return null;
  const [attestation, material, targetTree] = await Promise.all([
    d.store.findAcceptedAttestation(attestationId),
    d.store.findReplayMaterialByAttestationId(attestationId),
    d.checkoutTrees.resolveCheckoutTreeOid(input.authorization),
  ]);
  if (
    !attestation ||
    !material ||
    !targetTree ||
    attestation.attestationHash !== attestationHash ||
    attestation.reuseExpiresAtMs <= d.now().getTime()
  ) {
    return null;
  }
  const session = await d.store.findSession(attestation.sessionId);
  if (!session) return null;
  const current = await resolveCurrentCandidate({
    ...input,
    targetCheckoutTreeOid: targetTree,
    session,
    dependencies: d,
  });
  if (!current) return null;
  // Gateway v4 replay is intentionally disabled until receipt replay ships.
  if (attestation.manifest.manifestVersion !== 2) return null;
  let plaintext: string;
  try {
    plaintext = await d.cipher.decrypt({
      material,
      associatedDataCanonicalJson: replayMaterialAssociatedData(session),
    });
  } catch {
    return null;
  }
  const parsed = parseReplayMaterial(
    plaintext,
    attestation.manifest,
    session,
    deriveGatewaySessionSecret(
      d.sessionSecretKey,
      gatewaySecretIdentity(session),
    ),
  );
  if (!("sourceDependencies" in parsed)) return null;
  const replayQueries = new Map(
    parsed.sourceDependencies.map((entry) => [
      entry.operationKey,
      entry.replayQuery,
    ]),
  );
  const sourceDependencies: ReplayPlanSourceDependency[] = [];
  for (const dependency of attestation.manifest.dependencies) {
    const replayQuery = replayQueries.get(dependency.operationKey);
    if (
      dependency.operation.kind === ContextDependencyKind.TextSearch &&
      typeof replayQuery !== "string"
    ) {
      return null;
    }
    sourceDependencies.push(
      Object.freeze({
        sequence: dependency.sequence,
        operationKey: dependency.operationKey,
        operation: dependency.operation,
        replayQuery:
          dependency.operation.kind === ContextDependencyKind.TextSearch
            ? replayQuery!
            : null,
      }),
    );
  }
  const plan: ReviewActionV2ContextReplayPlan = Object.freeze({
    planVersion: replayPlanVersion,
    attestationId,
    attestationHash,
    gatewayPolicyVersion: attestation.manifest.gatewayPolicyVersion,
    gatewayBinaryHash: attestation.manifest.gatewayBinaryHash,
    sourceDependencies: Object.freeze(sourceDependencies),
  });
  const contextReplayPlanCanonicalJson = stableJson(plan as never);
  const contextReplayPlanHash = await d.digest.digestUtf8(
    contextReplayPlanCanonicalJson,
  );
  const now = d.now();
  const expiresAt = minDate(
    input.authorization.expiresAt,
    new Date(input.observation.reuseExpiresAtMs),
    new Date(now.getTime() + d.config.replayCapabilityLifetimeMs),
  );
  const attachment = reusableAttachmentAuthority({
    input,
    reusePolicyVectorHash: current.reusePolicyVectorHash,
    expiresAt: minDate(
      expiresAt,
      new Date(now.getTime() + d.config.attachmentCapabilityLifetimeMs),
    ),
  });
  const contextReplayCapability = await d.capabilities.issueContextReplay(
    {
      attestationId,
      attestationHash,
      contextReplayPlanHash,
      targetCheckoutTreeOid: targetTree,
      gatewayPolicyVersion: attestation.manifest.gatewayPolicyVersion,
      gatewayBinaryHash: attestation.manifest.gatewayBinaryHash,
      reusePolicyVectorHash: current.reusePolicyVectorHash,
      attachment,
      expiresAt,
    },
    now,
  );
  return Object.freeze({
    contextDependencyAttestationId: attestationId,
    contextDependencyAttestationHash: attestationHash,
    contextReplayCapability,
    contextReplayPlanCanonicalJson,
    contextReplayPlanHash,
  });
}

export async function prepareInvestigationReceiptReplay(
  input: Parameters<InvestigationReplayPreparationPort["prepare"]>[0],
  target: ReviewActionV2InvestigationReplayTarget,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
): Promise<PreparedInvestigationReceiptReplay | null> {
  const attestationId = input.sourceReceipt.acceptedAttestationId;
  const attestationHash = input.sourceReceipt.acceptedAttestationHash;
  if (!attestationId || !attestationHash) return null;
  const [attestation, material, targetTree] = await Promise.all([
    d.store.findAcceptedAttestation(attestationId),
    d.store.findReplayMaterialByAttestationId(attestationId),
    d.checkoutTrees.resolveCheckoutTreeOid(target.authorization),
  ]);
  const now = d.now();
  if (
    !attestation ||
    !material ||
    !targetTree ||
    attestation.attestationHash !== attestationHash ||
    attestation.reuseExpiresAtMs <= now.getTime() ||
    Date.parse(input.sourceCheckpointExpiresAt) <= now.getTime() ||
    attestation.manifest.manifestVersion !== 3 ||
    attestation.manifest.gatewayPolicyVersion !== contextGatewayV4PolicyVersion
  ) {
    return null;
  }
  const session = await d.store.findSession(attestation.sessionId);
  if (
    !session ||
    !investigationProviderMatches(
      session.providerKind,
      target.manifest.providerKind,
    ) ||
    attestation.actualModel !== target.manifest.requestedModel
  ) {
    return null;
  }
  const release = await d.producerReleases.resolve({
    producerReleaseId: target.manifest.producerReleaseId,
  });
  const scopeHash = await authorizationScopeHash(
    target.authorization,
    d.digest,
  );
  const policy = await d.reusePolicy.resolveReviewReusePolicy({
    scope: {
      workspaceId: target.authorization.workspaceId,
      repositoryConnectionId: target.authorization.repositoryConnectionId,
      scmRepositoryIdentityId: target.authorization.scmRepositoryIdentityId,
      pullRequestNumber: target.authorization.pullRequestNumber,
      authorizationScopeHash: scopeHash,
    },
    revision: {
      baseSha: target.authorization.baseSha,
      mergeBaseSha: target.authorization.mergeBaseSha,
      headSha: target.authorization.headSha,
      reviewRevisionHash: target.authorization.reviewRevisionHash,
    },
    providerKind: target.manifest.providerKind,
    taskKindSet: target.manifest.taskKindSet,
    trustDomain: target.authorization
      .trustDomain as unknown as ReviewTrustDomain,
    producerReleaseId: target.manifest.producerReleaseId,
  });
  if (
    !release ||
    !policy ||
    policy.safetyDecision.contextGatewayReuseMode !==
      ReviewReuseEffectMode.Enabled ||
    release.capabilityProfile !== session.trustedCapabilityProfile ||
    release.contextGatewayPolicyVersion !==
      attestation.manifest.gatewayPolicyVersion ||
    release.contextGatewayEntrypointDigest !==
      attestation.manifest.gatewayBinaryHash
  ) {
    return null;
  }
  let plaintext: string;
  try {
    plaintext = await d.cipher.decrypt({
      material,
      associatedDataCanonicalJson: replayMaterialAssociatedData(session),
    });
  } catch {
    return null;
  }
  const replayMaterial = parseReplayMaterial(
    plaintext,
    attestation.manifest,
    session,
    deriveGatewaySessionSecret(
      d.sessionSecretKey,
      gatewaySecretIdentity(session),
    ),
  );
  if (!("entries" in replayMaterial)) return null;
  const sourceOperationReceiptIds = [
    ...new Set(input.sourceReceipt.operationReceiptIds),
  ].sort();
  if (
    sourceOperationReceiptIds.length !==
    input.sourceReceipt.operationReceiptIds.length
  ) {
    return null;
  }
  const operations = selectGatewayV4ReplayOperations(
    attestation.manifest,
    replayMaterial,
    sourceOperationReceiptIds,
  );
  if (!operations || operations.length === 0) return null;
  const sourceOperationReceiptIdsHash = await d.digest.digestUtf8(
    canonicalJson({ operationReceiptIds: sourceOperationReceiptIds }),
  );
  const plan = Object.freeze({
    planVersion: 2 as const,
    attestationId,
    attestationHash,
    gatewayPolicyVersion: attestation.manifest.gatewayPolicyVersion,
    gatewayBinaryHash: attestation.manifest.gatewayBinaryHash,
    sourceOperationReceiptIds,
    sourceOperationReceiptIdsHash,
    operations,
  });
  const replayPlanCanonicalJson = stableJson(plan as never);
  const replayPlanHash = await d.digest.digestUtf8(replayPlanCanonicalJson);
  const reusePolicyVectorHash = await d.digest.digestUtf8(
    canonicalizeReviewContextReusePolicyVector({
      safetyDecision: policy.safetyDecision,
      compatibility: policy.compatibility,
      eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
      gatewayPolicyVersion: session.gatewayPolicyVersion,
      gatewayBinaryHash: session.gatewayBinaryHash,
      trustedCapabilityProfile: session.trustedCapabilityProfile,
      producerReleaseId: target.manifest.producerReleaseId,
      providerKind: target.manifest.providerKind,
      requestedModel: target.manifest.requestedModel,
      actualModel: attestation.actualModel,
    }),
  );
  const expiresAt = minDate(
    target.authorization.expiresAt,
    new Date(attestation.reuseExpiresAtMs),
    new Date(input.sourceCheckpointExpiresAt),
    new Date(now.getTime() + d.config.replayCapabilityLifetimeMs),
  );
  const replayCapability = await d.capabilities.issueInvestigationReceiptReplay(
    {
      sourceCertificateId: input.sourceCheckpointId,
      sourceCertificateHash: input.sourceCheckpointHash,
      attestationId,
      attestationHash,
      sourceOperationReceiptIds,
      sourceOperationReceiptIdsHash,
      contextReplayPlanHash: replayPlanHash,
      targetExecutionId: input.targetExecutionId,
      targetWorkSlotId: input.targetWorkSlotId,
      targetReviewRevisionHash: input.targetReviewRevisionHash,
      targetCheckoutTreeOid: targetTree,
      gatewayPolicyVersion: attestation.manifest.gatewayPolicyVersion,
      gatewayBinaryHash: attestation.manifest.gatewayBinaryHash,
      reusePolicyVectorHash,
      providerKind: target.manifest.providerKind,
      taskKindSet: target.manifest.taskKindSet,
      producerReleaseId: target.manifest.producerReleaseId,
      requestedModel: target.manifest.requestedModel,
      expiresAt,
    },
    now,
  );
  return Object.freeze({
    contextAttestationId: attestationId,
    contextAttestationHash: attestationHash,
    sourceOperationReceiptIdsHash,
    replayCapability,
    replayPlanCanonicalJson,
    replayPlanHash,
  });
}

function investigationProviderMatches(
  source: ContextProviderKind,
  target: ReviewProviderKind,
): boolean {
  switch (source) {
    case ContextProviderKind.Codex:
      return target === ReviewProviderKind.Codex;
    case ContextProviderKind.ClaudeCode:
      return target === ReviewProviderKind.ClaudeCode;
    case ContextProviderKind.OpenRouter:
      return false;
  }
}

function reusableAttachmentAuthority(input: {
  readonly input: ReviewActionV2ContextReplayPrepareInput;
  readonly reusePolicyVectorHash: string;
  readonly expiresAt: Date;
}): ReviewActionV2ReusableAttachmentAuthority {
  return Object.freeze({
    authorizationId: input.input.authorization.authorizationId,
    mutationEpoch: input.input.authorization.mutationEpoch,
    scopeHash: input.input.manifest.scopeHash,
    targetExecutionId: input.input.snapshot.execution.executionId,
    targetWorkSlotId: input.input.workSlotId,
    targetReviewRevisionHash:
      input.input.snapshot.execution.revision.reviewRevisionHash,
    targetPlanHash: input.input.snapshot.execution.planHash,
    observationId: input.input.observation.observationId,
    sourceExecutionId: input.input.observation.sourceExecutionId,
    manifest: input.input.manifest,
    manifestKey: input.input.manifestKey,
    providerInvocationKey: input.input.providerInvocationKey,
    providerVoteIdentityHash: input.input.providerVoteIdentityHash,
    payloadHash: input.input.observation.payloadHash,
    byteCount: input.input.observation.byteCount,
    findingCount: input.input.observation.findingCount,
    attachmentKind:
      ReviewObservationAttachmentKind.ContextGatewayCrossRevisionReuse,
    reuseSafetyDecisionHash: input.reusePolicyVectorHash,
    eligibilityPolicyVersion: reviewReuseEligibilityPolicyVersion,
    trustDomain: input.input.trustDomain,
    expiresAt: input.expiresAt,
  });
}

function assertReplayRequestAuthority(
  request: ReviewContextReplayCommitRequest,
  authorization: ReviewRunAuthorization,
  authority: ReviewActionV2ContextReplayAuthority,
): void {
  requireEqual(
    authority.attestationId,
    request.attestationId,
    "context_replay_attestation_id_mismatch",
  );
  requireEqual(
    authority.attestationHash,
    request.attestationHash,
    "context_replay_attestation_hash_mismatch",
  );
  requireEqual(
    authority.attachment.authorizationId,
    authorization.authorizationId,
    "context_replay_authorization_mismatch",
  );
  requireEqual(
    authority.attachment.mutationEpoch,
    authorization.mutationEpoch,
    "context_replay_mutation_epoch_mismatch",
  );
  requireEqual(
    authority.attachment.targetExecutionId,
    request.executionId,
    "context_replay_execution_mismatch",
  );
  requireEqual(
    authority.attachment.targetWorkSlotId,
    request.workSlotId,
    "context_replay_work_slot_mismatch",
  );
  requireEqual(
    authority.attachment.targetReviewRevisionHash,
    request.targetReviewRevisionHash,
    "context_replay_revision_mismatch",
  );
  requireEqual(
    authority.targetCheckoutTreeOid,
    request.targetCheckoutTreeOid,
    "context_replay_tree_mismatch",
  );
}

function minDate(...dates: readonly Date[]): Date {
  return new Date(Math.min(...dates.map((date) => date.getTime())));
}
