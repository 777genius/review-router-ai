import { decodeProtectedHeader } from "jose";
import {
  CapabilityAudience,
  CapabilityKind,
  JoseRotatingCapabilityCodec,
  type CapabilityKeyRingPort,
  type SignedCapabilityCodecPort,
} from "@reviewrouter/platform-signed-capabilities";
import {
  type ReviewV2PublicationClockPort,
  type ReviewV2OpaqueSignedOperationCapability,
  type ReviewV2OperationCapabilityIssuerPort,
  type ReviewV2OperationCapabilityVerifierPort,
} from "../../application/ports/review-publication-execution-ports";
import { canonicalReviewPublicationJson } from "../../domain/canonical-review-publication-json";

export class RotatingReviewV2OperationCapabilityIssuer implements ReviewV2OperationCapabilityIssuerPort {
  constructor(
    private readonly keyRing: CapabilityKeyRingPort,
    private readonly clock: ReviewV2PublicationClockPort,
    private readonly issuer = "reviewrouter-review-v2-worker",
  ) {}

  async issue(
    input: Parameters<ReviewV2OperationCapabilityIssuerPort["issue"]>[0],
  ): Promise<ReviewV2OpaqueSignedOperationCapability> {
    const now = this.clock.now();
    const signingKey = await this.keyRing.verificationKey(
      input.capability.capabilitySigningKeyId,
      now,
    );
    if (!signingKey) {
      throw new Error("review_v2_operation_capability_signing_key_unavailable");
    }
    assertOperationCapabilityContext(input);
    const ownershipExpiresAt = operationCapabilityOwnershipExpiry(input);
    if (
      now >= ownershipExpiresAt ||
      now >= input.capability.effectReportUntil
    ) {
      throw new Error("review_v2_operation_capability_expired");
    }
    const signer = new JoseRotatingCapabilityCodec({
      activeSigningKey: async () => signingKey,
      verificationKey: async (keyId) =>
        keyId === signingKey.keyId ? signingKey : null,
    });
    const payload = operationCapabilityPayload(input);
    const signed = await signer.sign({
      capabilityId: input.capability.capabilityId,
      kind: CapabilityKind.PublicationOperation,
      audience: CapabilityAudience.ReviewPublicationOperation,
      issuer: this.issuer,
      subject: input.operation.publicationOperationId,
      issuedAt: now,
      notBefore: now,
      ownershipExpiresAt,
      expiresAt: input.capability.effectReportUntil,
      payload,
    });
    if (signed.signingKeyId !== input.capability.capabilitySigningKeyId) {
      throw new Error("review_v2_operation_capability_key_mismatch");
    }
    return signed;
  }
}

type SignedCapabilityVerificationPort = Pick<
  SignedCapabilityCodecPort,
  "verify"
>;

export class SignedReviewV2OperationCapabilityVerifier implements ReviewV2OperationCapabilityVerifierPort {
  constructor(
    private readonly verifier: SignedCapabilityVerificationPort,
    private readonly clock: ReviewV2PublicationClockPort,
    private readonly issuer = "reviewrouter-review-v2-worker",
  ) {}

  async verify(
    input: Parameters<ReviewV2OperationCapabilityVerifierPort["verify"]>[0],
  ): Promise<void> {
    const now = this.clock.now();
    assertOperationCapabilityContext(input);
    const header = decodeProtectedHeader(input.signedCapability.token);
    if (
      header.kid !== input.signedCapability.signingKeyId ||
      header.kid !== input.capability.capabilitySigningKeyId
    ) {
      throw new Error("review_v2_operation_capability_key_mismatch");
    }
    const verified = await this.verifier.verify({
      token: input.signedCapability.token,
      expectedIssuer: this.issuer,
      expectedAudience: CapabilityAudience.ReviewPublicationOperation,
      expectedKind: CapabilityKind.PublicationOperation,
      now,
    });
    const payload = operationCapabilityPayload(input);
    const ownershipExpiresAt = operationCapabilityOwnershipExpiry(input);
    if (
      verified.capabilityId !== input.capability.capabilityId ||
      input.signedCapability.capabilityId !== input.capability.capabilityId ||
      input.signedCapability.signingKeyId !==
        input.capability.capabilitySigningKeyId ||
      verified.subject !== input.operation.publicationOperationId ||
      verified.ownershipExpiresAt?.getTime() !==
        truncateToSeconds(ownershipExpiresAt).getTime() ||
      verified.expiresAt.getTime() !==
        truncateToSeconds(input.capability.effectReportUntil).getTime() ||
      input.signedCapability.expiresAt.getTime() !==
        input.capability.effectReportUntil.getTime() ||
      now >= ownershipExpiresAt ||
      now >= input.capability.effectReportUntil ||
      canonicalReviewPublicationJson(verified.payload) !==
        canonicalReviewPublicationJson(payload)
    ) {
      throw new Error("review_v2_operation_capability_claim_mismatch");
    }
  }
}

function operationCapabilityPayload(
  input: Parameters<ReviewV2OperationCapabilityIssuerPort["issue"]>[0],
) {
  return Object.freeze({
    signingKeyId: input.capability.capabilitySigningKeyId,
    publicationAttemptId: input.capability.publicationAttemptId,
    publicationOperationId: input.operation.publicationOperationId,
    operationAttemptId: input.capability.operationAttemptId,
    effectReportId: input.capability.effectReportId,
    operationClaimId: input.capability.claimId,
    operationClaimFence: input.capability.claimFencingToken.toString(),
    claimId: input.claim.claimId,
    claimFence: input.claim.fencingToken.toString(),
    claimOwnerIdHash: input.claim.ownerIdHash,
    permitEpoch: input.permit.permitEpoch.toString(),
    mutationEpoch: input.capability.mutationEpoch.toString(),
    publicationSafetyDecisionHash:
      input.capability.publicationSafetyDecisionHash,
    bodyHash: input.operation.bodyHash,
    targetCommitId: input.operation.targetCommitId,
    targetExternalObjectId: input.capability.targetExternalObjectId ?? "none",
    reviewRevisionHash: input.permit.reviewRevisionHash,
  });
}

function assertOperationCapabilityContext(
  input: Parameters<ReviewV2OperationCapabilityIssuerPort["issue"]>[0],
): void {
  if (
    input.capability.publicationOperationId !==
      input.operation.publicationOperationId ||
    input.capability.publicationAttemptId !==
      input.operation.publicationAttemptId ||
    input.claim.publicationAttemptId !==
      input.capability.publicationAttemptId ||
    input.capability.mutationEpoch !== input.permit.permitEpoch ||
    input.capability.reviewRevisionHash !== input.permit.reviewRevisionHash ||
    input.capability.publicationSafetyDecisionHash !==
      input.permit.publicationSafetyDecisionHash ||
    input.operation.targetCommitId !== input.permit.reviewedHeadSha ||
    input.operation.reviewRevisionHash !== input.permit.reviewRevisionHash ||
    input.capability.bodyHash !== input.operation.bodyHash ||
    input.capability.targetCommitId !== input.operation.targetCommitId
  ) {
    throw new Error("review_v2_operation_capability_context_mismatch");
  }
}

function operationCapabilityOwnershipExpiry(
  input: Parameters<ReviewV2OperationCapabilityIssuerPort["issue"]>[0],
): Date {
  return new Date(
    Math.min(
      input.claim.expiresAt.getTime(),
      input.capability.effectReportUntil.getTime(),
    ),
  );
}

function truncateToSeconds(value: Date): Date {
  return new Date(Math.floor(value.getTime() / 1_000) * 1_000);
}
