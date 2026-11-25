// Context gateway lifecycle handlers; admission and durable effect order are intentionally explicit.
import {
  AbandonContextGatewaySession,
  AcceptSealedContextAttestation,
  AcceptSealedContextAttestationStatus,
  ContextLeaseAuthorityKind,
  OpenContextGatewaySession,
  OpenContextGatewaySessionStatus,
  type GatewaySession,
} from "@reviewrouter/features-review-context-attestation";
import { ReviewInvestigationLeaseProtectedOperation } from "@reviewrouter/features-review-investigations";
import {
  ReviewActionV2OperationId,
  ReviewActionV2ProtocolErrorCode,
  type ReviewContextGatewayOpenRequest,
  type ReviewContextGatewaySealRequest,
  type ReviewInvestigationContextGatewayOpenRequest,
  type ReviewInvestigationContextGatewaySealRequest,
} from "@reviewrouter/protocol-review-action-v2";
import type {
  ReviewActionV2ExecutionEvidenceCapabilityAdapter,
  ReviewActionV2ContextGatewaySealAuthority,
  ReviewActionV2InvestigationContextGatewaySealAuthority,
} from "./review-action-v2-execution-evidence-capabilities.js";
import { hasAuthorizedReviewInvestigationExtension } from "./review-action-v2-investigation-extension-admission.js";
import {
  mapOpenStatus,
  mapSealStatus,
  mapFailedSealStatus,
} from "./review-action-v2-context-result-mappers.js";
import type { ReviewActionV2ContextAttestationHandlerDependencies } from "./review-action-v2-context-attestation-types.js";
import {
  authorizationScopeHash,
  contextIdentities,
  deriveGatewaySessionSecret,
  gatewaySecretIdentity,
  gatewaySeedIdentity,
  hmacHex,
  replayMaterialAssociatedData,
} from "./review-action-v2-context-attestation-crypto.js";
import {
  assertBodyHash,
  assertInvestigationShadowGatewayAllowed,
  assertSealAuthority,
  requireAuthorization,
  resolveBoundContextGatewayLease,
  resolveOpeningFacts,
} from "./review-action-v2-context-attestation-admission.js";
import {
  parseReplayMaterial,
  verifyGatewayTranscript,
} from "./review-action-v2-context-attestation-replay-material.js";
import {
  failure,
  parseContextManifest,
  requireEqual,
  requireHash,
  requiredString,
} from "./review-action-v2-context-attestation-validation.js";

async function issueContextGatewaySeal(
  authorityKind: ContextLeaseAuthorityKind,
  capabilities: ReviewActionV2ExecutionEvidenceCapabilityAdapter,
  authority: ReviewActionV2ContextGatewaySealAuthority,
  issuedAt: Date,
): Promise<string> {
  switch (authorityKind) {
    case ContextLeaseAuthorityKind.StandardExecution:
      return capabilities.issueContextGatewaySeal(authority, issuedAt);
    case ContextLeaseAuthorityKind.InvestigationShadow:
      return capabilities.issueInvestigationContextGatewaySeal(
        { ...authority, sourceLeaseAuthorityKind: "investigation_shadow" },
        issuedAt,
      );
  }
}

async function verifyContextGatewaySeal(
  authorityKind: ContextLeaseAuthorityKind,
  capabilities: ReviewActionV2ExecutionEvidenceCapabilityAdapter,
  token: string,
  now: Date,
): Promise<
  | ReviewActionV2ContextGatewaySealAuthority
  | ReviewActionV2InvestigationContextGatewaySealAuthority
> {
  switch (authorityKind) {
    case ContextLeaseAuthorityKind.StandardExecution:
      return capabilities.verifyContextGatewaySeal(token, now);
    case ContextLeaseAuthorityKind.InvestigationShadow:
      return capabilities.verifyInvestigationContextGatewaySeal(token, now);
  }
}

export async function openGateway(
  request:
    | ReviewContextGatewayOpenRequest
    | ReviewInvestigationContextGatewayOpenRequest,
  authorityKind: ContextLeaseAuthorityKind,
  operationId:
    | ReviewActionV2OperationId.ReviewContextGatewayOpen
    | ReviewActionV2OperationId.ReviewInvestigationContextGatewayOpen,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
) {
  await assertBodyHash(operationId, request, d.digest);
  const now = d.now();
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  if (
    authorityKind === ContextLeaseAuthorityKind.InvestigationShadow &&
    !hasAuthorizedReviewInvestigationExtension(authorization)
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.CapabilityDisabled,
      "review_investigation_extension_not_authorized",
    );
  }
  const bound = await resolveBoundContextGatewayLease({
    authorityKind,
    leaseCapability: request.leaseCapability,
    authorization,
    leaseId: request.sourceLeaseId,
    workSlotId: request.sourceWorkSlotId,
    attemptId: request.attemptId,
    fencingToken: request.fencingToken,
    sourceExecutionId: request.sourceExecutionId,
    requireOwnership: true,
    operation: ReviewInvestigationLeaseProtectedOperation.ContextGatewayOpen,
    now,
    dependencies: d,
  });
  await assertInvestigationShadowGatewayAllowed({
    authorization,
    bound,
    dependencies: d,
  });
  requireEqual(
    request.sourceReviewRevisionHash,
    authorization.reviewRevisionHash,
    "context_source_revision_mismatch",
  );
  const facts = await resolveOpeningFacts({
    request,
    authorization,
    snapshot: bound.snapshot,
    lease: bound.lease,
    dependencies: d,
  });
  const sessionSecret = deriveGatewaySessionSecret(
    d.sessionSecretKey,
    gatewaySecretIdentity(facts),
  );
  const eventChainSeedHash = hmacHex(sessionSecret, gatewaySeedIdentity(facts));
  const open = new OpenContextGatewaySession({
    openingFacts: {
      resolveOpeningFacts: async (command) =>
        command.attemptId === facts.attemptId &&
        command.leaseCapabilityId === bound.lease.capabilityId &&
        command.confinementEvidenceId === facts.confinementProofHash
          ? { ...facts, eventChainSeedHash }
          : null,
    },
    store: d.store,
    identities: contextIdentities(d),
    clock: { nowMs: () => now.getTime() },
  });
  const outcome = await open.execute({
    attemptId: request.attemptId,
    leaseCapabilityId: bound.lease.capabilityId,
    confinementEvidenceId: request.confinementEvidenceHash,
  });
  if (!outcome.session) {
    return {
      statusCode: 200 as const,
      result: {
        status: mapOpenStatus(outcome.status),
        sessionId: null,
        eventChainSeedHash: null,
        gatewaySessionSecret: null,
        sealCapability: null,
        expiresAt: null,
      },
    };
  }
  const sealCapability = await issueContextGatewaySeal(
    authorityKind,
    d.capabilities,
    {
      authorizationId: authorization.authorizationId,
      mutationEpoch: authorization.mutationEpoch,
      scopeHash: await authorizationScopeHash(authorization, d.digest),
      sessionId: outcome.session.sessionId,
      sourceExecutionId: outcome.session.sourceExecutionId,
      sourceWorkSlotId: outcome.session.sourceWorkSlotId,
      attemptId: outcome.session.attemptId,
      sourceLeaseId: outcome.session.sourceLeaseId,
      sourceFencingToken: outcome.session.sourceFencingToken,
      sourceReviewRevisionHash:
        outcome.session.sourceRevision.reviewRevisionHash,
      checkoutTreeOid: outcome.session.sourceRevision.checkoutTreeOid,
      gatewayPolicyVersion: outcome.session.gatewayPolicyVersion,
      gatewayBinaryHash: outcome.session.gatewayBinaryHash,
      confinementEvidenceHash: outcome.session.confinementProofHash,
      expiresAt: new Date(outcome.session.expiresAtMs),
    },
    now,
  );
  return {
    statusCode:
      outcome.status === OpenContextGatewaySessionStatus.Opened
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapOpenStatus(outcome.status),
      sessionId: outcome.session.sessionId,
      eventChainSeedHash: outcome.session.eventChainSeedHash,
      gatewaySessionSecret: sessionSecret.toString("base64url"),
      sealCapability,
      expiresAt: new Date(outcome.session.expiresAtMs).toISOString(),
    },
  };
}

export async function sealGateway(
  request:
    | ReviewContextGatewaySealRequest
    | ReviewInvestigationContextGatewaySealRequest,
  authorityKind: ContextLeaseAuthorityKind,
  operationId:
    | ReviewActionV2OperationId.ReviewContextGatewaySeal
    | ReviewActionV2OperationId.ReviewInvestigationContextGatewaySeal,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
) {
  await assertBodyHash(operationId, request, d.digest);
  const now = d.now();
  const authorization = await requireAuthorization(
    request.authorizationToken,
    d,
  );
  if (
    authorityKind === ContextLeaseAuthorityKind.InvestigationShadow &&
    !hasAuthorizedReviewInvestigationExtension(authorization)
  ) {
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.CapabilityDisabled,
      "review_investigation_extension_not_authorized",
    );
  }
  const bound = await resolveBoundContextGatewayLease({
    authorityKind,
    leaseCapability: request.leaseCapability,
    authorization,
    leaseId: request.sourceLeaseId,
    workSlotId: null,
    attemptId: request.attemptId,
    fencingToken: request.fencingToken,
    sourceExecutionId: null,
    requireOwnership: false,
    operation: ReviewInvestigationLeaseProtectedOperation.ContextGatewaySeal,
    now,
    dependencies: d,
  });
  await assertInvestigationShadowGatewayAllowed({
    authorization,
    bound,
    dependencies: d,
  });
  let sealAuthority;
  try {
    sealAuthority = await verifyContextGatewaySeal(
      authorityKind,
      d.capabilities,
      request.sealCapability,
      now,
    );
  } catch {
    throw failure(
      401,
      ReviewActionV2ProtocolErrorCode.InvalidAuthentication,
      "context_seal_capability_invalid",
    );
  }
  const session = await d.store.findSession(request.sessionId);
  if (!session) {
    throw failure(
      404,
      ReviewActionV2ProtocolErrorCode.NotFound,
      "context_gateway_session_missing",
    );
  }
  await assertSealAuthority({
    request,
    authorization,
    leaseAuthority: bound.lease,
    sealAuthority,
    session,
    dependencies: d,
  });
  if (!request.providerSucceeded) {
    if (request.schemaValidated || request.fullyConsumed) {
      throw failure(
        400,
        ReviewActionV2ProtocolErrorCode.InvalidRequest,
        "context_failed_seal_flags_invalid",
      );
    }
    return abandonFailedGatewaySession({
      request,
      authorityKind,
      sealAuthority,
      session,
      now,
      dependencies: d,
    });
  }
  const transcript = parseContextManifest(
    request.transcriptCanonicalJson,
    "context_transcript_invalid",
  );
  await requireHash(
    request.transcriptCanonicalJson,
    request.transcriptHash,
    "context_transcript_hash_mismatch",
    d.digest,
  );
  const sessionSecret = deriveGatewaySessionSecret(
    d.sessionSecretKey,
    gatewaySecretIdentity(session),
  );
  const replayMaterial = parseReplayMaterial(
    request.replayMaterialCanonicalJson,
    transcript,
    session,
    sessionSecret,
  );
  await requireHash(
    request.replayMaterialCanonicalJson,
    request.replayMaterialHash,
    "context_replay_material_hash_mismatch",
    d.digest,
  );
  verifyGatewayTranscript(session, transcript, sessionSecret);
  requireEqual(
    transcript.gatewayPolicyVersion,
    session.gatewayPolicyVersion,
    "context_gateway_policy_mismatch",
  );
  requireEqual(
    transcript.gatewayBinaryHash,
    session.gatewayBinaryHash,
    "context_gateway_binary_mismatch",
  );
  requireEqual(
    transcript.checkoutTreeOid,
    session.sourceRevision.checkoutTreeOid,
    "context_checkout_tree_mismatch",
  );
  const associatedDataCanonicalJson = replayMaterialAssociatedData(session);
  const encrypted = await d.cipher.encrypt({
    sessionId: session.sessionId,
    plaintextCanonicalJson: replayMaterial.canonicalJson,
    associatedDataCanonicalJson,
    expiresAtMs: now.getTime() + d.config.reuseTtlMs,
  });
  const accept = new AcceptSealedContextAttestation({
    transcripts: {
      loadSealedTranscript: async (command) =>
        command.sessionId === session.sessionId &&
        command.sealCapabilityId === sealAuthority.capabilityId
          ? {
              sessionId: session.sessionId,
              confinementProofHash: session.confinementProofHash,
              manifest: transcript,
              actualModel: request.actualModel,
              terminalOutcomeHash: request.terminalOutcomeHash,
              providerSucceeded: request.providerSucceeded,
              schemaValidated: request.schemaValidated,
              fullyConsumed: request.fullyConsumed,
              replayMaterial: encrypted,
            }
          : null,
    },
    store: d.store,
    identities: contextIdentities(d),
    digest: d.digest,
    clock: { nowMs: () => now.getTime() },
    reuseTtlMs: d.config.reuseTtlMs,
  });
  const outcome = await accept.execute({
    sessionId: request.sessionId,
    sealCapabilityId: requiredString(
      sealAuthority.capabilityId,
      "context_seal_capability_id_missing",
    ),
  });
  return {
    statusCode:
      outcome.status === AcceptSealedContextAttestationStatus.Accepted
        ? (201 as const)
        : (200 as const),
    result: {
      status: mapSealStatus(outcome.status),
      attestationId: outcome.attestation?.attestationId ?? null,
      attestationHash: outcome.attestation?.attestationHash ?? null,
    },
  };
}

async function abandonFailedGatewaySession(input: {
  readonly request:
    | ReviewContextGatewaySealRequest
    | ReviewInvestigationContextGatewaySealRequest;
  readonly authorityKind: ContextLeaseAuthorityKind;
  readonly sealAuthority:
    | ReviewActionV2ContextGatewaySealAuthority
    | ReviewActionV2InvestigationContextGatewaySealAuthority;
  readonly session: GatewaySession;
  readonly now: Date;
  readonly dependencies: ReviewActionV2ContextAttestationHandlerDependencies;
}) {
  const capabilityId = requiredString(
    input.sealAuthority.capabilityId,
    "context_abandon_capability_id_missing",
  );
  const abandon = new AbandonContextGatewaySession({
    abandonFacts: {
      resolveAbandonFacts: async (command) =>
        command.sessionId === input.sealAuthority.sessionId &&
        command.capabilityId === capabilityId
          ? {
              sessionId: input.sealAuthority.sessionId,
              attemptId: input.sealAuthority.attemptId,
              sourceLeaseAuthorityKind: input.authorityKind,
              sourceLeaseId: input.sealAuthority.sourceLeaseId,
              sourceFencingToken: input.sealAuthority.sourceFencingToken,
            }
          : null,
    },
    store: input.dependencies.store,
    clock: { nowMs: () => input.now.getTime() },
  });
  const outcome = await abandon.execute({
    sessionId: input.request.sessionId,
    capabilityId,
  });
  return {
    statusCode: 200 as const,
    result: {
      status: mapFailedSealStatus(outcome.status),
      attestationId: null,
      attestationHash: null,
    },
  };
}
