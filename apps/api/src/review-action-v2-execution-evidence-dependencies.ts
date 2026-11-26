import {
  type assertLifecycleVerificationDispatchEvidence,
  type assertReviewRunCompanionDispatchEvidence,
} from "./review-lifecycle-verification.js";
import type { assertReviewModelDispatchEvidence } from "./review-model-dispatch-evidence.js";
import { type ReviewObservationQueryPort } from "@reviewrouter/features-review-evidence";
import type { ReturnTypeOfReviewEvidenceComposition } from "./review-action-v2-execution-evidence-types.js";
import {
  ReviewInvocationLeasePurpose,
  type ReviewCoverageExceptions,
  type ReviewExecution,
  type ReviewExecutionLimits,
  type ReviewExecutionObservationRef,
  type ReviewExecutionQueryPort,
} from "@reviewrouter/features-review-executions";
import type { ReviewExecutionsComposition } from "@reviewrouter/features-review-executions/composition";
import {
  type ReviewProtocolLimitsProfileQueryPort,
  type ReviewRunAuthorization,
  type ReviewRunAuthorizationQueryPort,
  type ReviewRunAuthorizationTokenResolution,
} from "@reviewrouter/features-review-run-control";
import type {
  ReviewActionV2ExecutionEvidenceCapabilityAdapter,
  VerifiedReviewActionV2LeaseCapability,
} from "./review-action-v2-execution-evidence-capabilities.js";
import type { ReviewActionV2ContextReplayCoordinatorPort } from "./review-action-v2-context-attestation-composition.js";

// API-owned dependency contracts shared by execution and evidence operations.

export type LeaseAuthorizationBinding = Pick<
  VerifiedReviewActionV2LeaseCapability,
  "authorizationId" | "scopeHash" | "reviewRevisionHash" | "mutationEpoch"
>;

export interface ReviewActionV2AuthorizationResolverPort {
  resolveReviewRunAuthorizationToken(input: {
    readonly token: string;
  }): Promise<ReviewRunAuthorizationTokenResolution>;
}

export interface ReviewActionV2DigestPort {
  digestUtf8(value: string): Promise<string>;
  digest(value: Uint8Array): Promise<string>;
}

export type ReviewActionV2ExecutionTimingPolicy = Readonly<{
  admissionDurationMs: number;
  executionDurationMs: number;
  initialLeaseDurationMs: number;
  retentionDurationMs: number;
  attachmentCapabilityDurationMs: number;
}>;

export interface ReviewActionV2LeaseSafetyPort {
  resolve(input: {
    readonly authorization: ReviewRunAuthorization;
    readonly execution: ReviewExecution;
    readonly workSlotId: string;
    readonly purpose: ReviewInvocationLeasePurpose;
  }): Promise<{ readonly allowed: boolean; readonly decisionHash: string }>;
}

export interface ReviewActionV2FinalizationFactsPort {
  resolve(input: {
    readonly authorization: ReviewRunAuthorization;
    readonly execution: ReviewExecution;
    readonly observationRefs: readonly ReviewExecutionObservationRef[];
    readonly artifactId: string;
    readonly projectionEnvelopeVersion: number;
    readonly projectionEnvelope: unknown;
    readonly projectionCanonicalJson: string;
    readonly projectionHash: string;
    readonly lifecycleStateHash: string;
    readonly commandLedgerWatermark: bigint;
    readonly allowPartial: boolean;
    readonly limits: ReviewExecutionLimits;
    readonly maxReconciliationDurationMs: number;
    readonly now: Date;
  }): Promise<
    Readonly<{
      expectedArtifactHash: string;
      byteCount: number;
      findingCount: number;
      projectionPolicyVersion: string;
      publicationSafetyDecisionHash: string;
      publicationNotAfter: Date;
      retainUntil: Date;
      /** Server-verified facts for `deriveCoverageState` (plan 69). */
      coverageExceptions?: ReviewCoverageExceptions;
    }>
  >;
}

export type CommonDependencies = Readonly<{
  authorizations: ReviewActionV2AuthorizationResolverPort;
  executionQueries: ReviewExecutionQueryPort;
  protocolLimits: ReviewProtocolLimitsProfileQueryPort;
  digest: ReviewActionV2DigestPort;
  capabilities: ReviewActionV2ExecutionEvidenceCapabilityAdapter;
  now: () => Date;
  nextId: (kind: "lease" | "attempt" | "observation_ref") => string;
  timing: ReviewActionV2ExecutionTimingPolicy;
  authorizationQueries?: Pick<
    ReviewRunAuthorizationQueryPort,
    "findReviewRunAuthorizationById"
  >;
  verifyLifecycleDispatchEvidence?: (
    input: Omit<
      Parameters<typeof assertLifecycleVerificationDispatchEvidence>[0],
      "prisma"
    >,
  ) => Promise<void>;
  verifyCompanionDispatchEvidence?: (
    input: Omit<
      Parameters<typeof assertReviewRunCompanionDispatchEvidence>[0],
      "prisma"
    >,
  ) => Promise<void>;
  verifyModelDispatchEvidence?: (
    input: Omit<
      Parameters<typeof assertReviewModelDispatchEvidence>[0],
      "prisma"
    >,
  ) => Promise<void>;
}>;

export type ReviewActionV2ExecutionHandlerDependencies = CommonDependencies &
  Readonly<{
    readServerTime: () => Promise<Date>;
    authorizationQueries: Pick<
      ReviewRunAuthorizationQueryPort,
      "findReviewRunAuthorizationById"
    >;
    executions: ReviewExecutionsComposition;
    evidence: ReturnTypeOfReviewEvidenceComposition;
    observations: ReviewObservationQueryPort;
    leaseSafety: ReviewActionV2LeaseSafetyPort;
    finalizationFacts: ReviewActionV2FinalizationFactsPort;
    contextReplay: ReviewActionV2ContextReplayCoordinatorPort;
  }>;

export type ReviewActionV2EvidenceHandlerDependencies = CommonDependencies &
  Readonly<{
    evidence: ReturnTypeOfReviewEvidenceComposition;
    observations: ReviewObservationQueryPort;
    contextReplay: ReviewActionV2ContextReplayCoordinatorPort;
  }>;
