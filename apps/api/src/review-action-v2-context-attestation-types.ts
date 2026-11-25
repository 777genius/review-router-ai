// Shared host contracts for context attestation. Cross-feature orchestration remains API-owned.
import type {
  ContextLeaseAuthorityKind,
  ContextAttestationStorePort,
  ContextDependencyManifest,
  ContextReplayMaterialCipherPort,
} from "@reviewrouter/features-review-context-attestation";
import type {
  InvestigationLeaseQueryPort,
  InvestigationStorePort,
} from "@reviewrouter/features-review-investigations";
import type {
  CurrentReviewReusePolicyPort,
  ProviderInvocationManifest,
  ReviewObservation,
  ReviewObservationQueryPort,
  ReviewTrustDomain,
} from "@reviewrouter/features-review-evidence";
import type { InvestigationRolloutCapability } from "@reviewrouter/features-review-investigation-operations";
import type {
  ReviewExecutionQueryPort,
  ReviewExecutionSnapshot,
} from "@reviewrouter/features-review-executions";
import type {
  ReviewRunAuthorization,
  ReviewRunAuthorizationTokenResolution,
} from "@reviewrouter/features-review-run-control";
import type {
  ReviewActionV2ExecutionEvidenceCapabilityAdapter,
  ReviewActionV2ReusableAttachmentAuthority,
} from "./review-action-v2-execution-evidence-capabilities.js";
import type { ReviewInvestigationRolloutGuardPort } from "./review-investigation-rollout-guard.js";
import type { ReviewActionV2InvestigationLeaseCapabilityPort } from "./review-action-v2-investigation-lease-capabilities.js";

export const replayPlanVersion = 1;

export type ReviewActionV2ContextAttestationConfig = Readonly<{
  sessionLifetimeMs: number;
  reuseTtlMs: number;
  replayProofLifetimeMs: number;
  replayCapabilityLifetimeMs: number;
  attachmentCapabilityLifetimeMs: number;
}>;

export interface ReviewActionV2ContextAuthorizationResolverPort {
  resolveReviewRunAuthorizationToken(input: {
    readonly token: string;
  }): Promise<ReviewRunAuthorizationTokenResolution>;
}

export interface ReviewActionV2ContextDigestPort {
  digestUtf8(value: string): Promise<string>;
  digest(value: Uint8Array): Promise<string>;
}

export interface ReviewActionV2CheckoutTreeResolverPort {
  resolveCheckoutTreeOid(
    authorization: ReviewRunAuthorization,
  ): Promise<string | null>;
}

export interface ReviewActionV2ProducerReleaseProfilePort {
  resolve(input: { readonly producerReleaseId: string }): Promise<Readonly<{
    capabilityProfile: string;
    runtimeCommitSha: string;
    contextGatewayPolicyVersion: string | null;
    contextGatewayEntrypointDigest: string | null;
  }> | null>;
}

export type ReplayPlanSourceDependency = Readonly<{
  sequence: number;
  operationKey: string;
  operation: ContextDependencyManifest["dependencies"][number]["operation"];
  replayQuery: string | null;
}>;

export type ReviewActionV2ContextReplayPlan = Readonly<{
  planVersion: typeof replayPlanVersion;
  attestationId: string;
  attestationHash: string;
  gatewayPolicyVersion: string;
  gatewayBinaryHash: string;
  sourceDependencies: readonly ReplayPlanSourceDependency[];
}>;

export type ReviewActionV2ContextReplayPreparation = Readonly<{
  contextDependencyAttestationId: string;
  contextDependencyAttestationHash: string;
  contextReplayCapability: string;
  contextReplayPlanCanonicalJson: string;
  contextReplayPlanHash: string;
}>;

export type ReviewActionV2ContextReplayPrepareInput = Readonly<{
  authorization: ReviewRunAuthorization;
  snapshot: ReviewExecutionSnapshot;
  workSlotId: string;
  manifest: ProviderInvocationManifest;
  manifestKey: string;
  providerInvocationKey: string;
  providerVoteIdentityHash: string;
  trustDomain: ReviewTrustDomain;
  observation: ReviewObservation;
}>;

export interface ReviewActionV2ContextReplayCoordinatorPort {
  prepareReplay(
    input: ReviewActionV2ContextReplayPrepareInput,
  ): Promise<ReviewActionV2ContextReplayPreparation | null>;
  verifyAttachment(input: {
    readonly authorization: ReviewRunAuthorization;
    readonly snapshot: ReviewExecutionSnapshot;
    readonly authority: ReviewActionV2ReusableAttachmentAuthority;
  }): Promise<boolean>;
  assertCurrentPolicy(input: {
    readonly authorization: ReviewRunAuthorization;
    readonly snapshot: ReviewExecutionSnapshot;
  }): Promise<void>;
}

export type ReviewActionV2InvestigationReplayTarget = Readonly<{
  authorization: ReviewRunAuthorization;
  snapshot: ReviewExecutionSnapshot;
  workSlotId: string;
  manifest: ProviderInvocationManifest;
  providerVoteIdentityHash: string;
}>;

export type ReviewActionV2ContextAttestationHandlerDependencies = Readonly<{
  authorizations: ReviewActionV2ContextAuthorizationResolverPort;
  executionQueries: ReviewExecutionQueryPort;
  observations: ReviewObservationQueryPort;
  reusePolicy: CurrentReviewReusePolicyPort;
  store: ContextAttestationStorePort;
  cipher: ContextReplayMaterialCipherPort;
  capabilities: ReviewActionV2ExecutionEvidenceCapabilityAdapter;
  investigationLeaseQueries: InvestigationLeaseQueryPort;
  investigationQueries: Pick<InvestigationStorePort, "findById">;
  investigationLeaseCapabilities: ReviewActionV2InvestigationLeaseCapabilityPort;
  investigationRollout: ReviewInvestigationRolloutGuardPort;
  digest: ReviewActionV2ContextDigestPort;
  checkoutTrees: ReviewActionV2CheckoutTreeResolverPort;
  producerReleases: ReviewActionV2ProducerReleaseProfilePort;
  now: () => Date;
  nextId: (kind: "gateway_session" | "attestation" | "replay_proof") => string;
  sessionSecretKey: Uint8Array;
  config: ReviewActionV2ContextAttestationConfig;
}>;

export type BoundContextGatewayLease = Readonly<{
  authorityKind: ContextLeaseAuthorityKind;
  capabilityId: string;
  authorizationId: string;
  mutationEpoch: bigint;
  scopeHash: string;
  executionId: string;
  workSlotId: string;
  leaseId: string;
  attemptId: string;
  providerInvocationKey: string;
  providerVoteIdentityHash: string;
  preparedManifestCanonicalJson: string;
  investigationRolloutCapability: InvestigationRolloutCapability | null;
}>;
