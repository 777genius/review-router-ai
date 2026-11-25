// Compose the public context routes without owning their security or replay implementation.
import {
  ContextLeaseAuthorityKind,
  assertContextGatewaySessionConfiguration,
} from "@reviewrouter/features-review-context-attestation";
import type { InvestigationReplayPreparationPort } from "@reviewrouter/features-review-investigations";
import type { RegisterReviewContextAttestationV2RoutesDependencies } from "@reviewrouter/features-action-control-plane/v2";
import {
  ReviewActionV2OperationId,
  type ReviewContextGatewayOpenRequest,
  type ReviewContextGatewaySealRequest,
  type ReviewInvestigationContextGatewayOpenRequest,
  type ReviewInvestigationContextGatewaySealRequest,
  type ReviewContextReceiptReplayCommitRequest,
  type ReviewContextReplayCommitRequest,
} from "@reviewrouter/protocol-review-action-v2";
import type {
  ReviewActionV2ContextAttestationHandlerDependencies,
  ReviewActionV2ContextReplayCoordinatorPort,
  ReviewActionV2ContextReplayPrepareInput,
  ReviewActionV2InvestigationReplayTarget,
} from "./review-action-v2-context-attestation-types.js";
import {
  openGateway,
  sealGateway,
} from "./review-action-v2-context-attestation-gateway.js";
import {
  commitReceiptReplay,
  commitReplay,
  prepareInvestigationReceiptReplay,
  prepareReplay,
} from "./review-action-v2-context-attestation-replay.js";
import {
  assertCurrentContextReusePolicy,
  verifyContextAttachment,
} from "./review-action-v2-context-attestation-replay-authority.js";
export type {
  ReviewActionV2CheckoutTreeResolverPort,
  ReviewActionV2ContextAttestationConfig,
  ReviewActionV2ContextAttestationHandlerDependencies,
  ReviewActionV2ContextAuthorizationResolverPort,
  ReviewActionV2ContextDigestPort,
  ReviewActionV2ContextReplayCoordinatorPort,
  ReviewActionV2ContextReplayPlan,
  ReviewActionV2ContextReplayPreparation,
  ReviewActionV2ContextReplayPrepareInput,
  ReviewActionV2InvestigationReplayTarget,
  ReviewActionV2ProducerReleaseProfilePort,
} from "./review-action-v2-context-attestation-types.js";
export {
  readReviewActionV2ContextCrypto,
  reviewActionV2ContextReplayActiveKeyIdEnv,
  reviewActionV2ContextReplayKeysEnv,
  reviewActionV2ContextSessionSecretEnv,
} from "./review-action-v2-context-attestation-crypto.js";

export function composeReviewActionV2ContextAttestationRoutes(input: {
  readonly enabled: boolean;
  readonly runtime: Pick<
    RegisterReviewContextAttestationV2RoutesDependencies,
    "readServerTime" | "createRequestId"
  >;
  readonly handlers?: ReviewActionV2ContextAttestationHandlerDependencies;
}): RegisterReviewContextAttestationV2RoutesDependencies {
  if (!input.enabled) return input.runtime;
  if (!input.handlers) {
    throw new Error("review_context_attestation_dependencies_unavailable");
  }
  const handlers = input.handlers;
  validateConfig(handlers);
  return {
    ...input.runtime,
    openGateway: enabled((request: ReviewContextGatewayOpenRequest) =>
      openGateway(
        request,
        ContextLeaseAuthorityKind.StandardExecution,
        ReviewActionV2OperationId.ReviewContextGatewayOpen,
        handlers,
      ),
    ),
    sealGateway: enabled((request: ReviewContextGatewaySealRequest) =>
      sealGateway(
        request,
        ContextLeaseAuthorityKind.StandardExecution,
        ReviewActionV2OperationId.ReviewContextGatewaySeal,
        handlers,
      ),
    ),
    openInvestigationGateway: enabled(
      (request: ReviewInvestigationContextGatewayOpenRequest) =>
        openGateway(
          request,
          ContextLeaseAuthorityKind.InvestigationShadow,
          ReviewActionV2OperationId.ReviewInvestigationContextGatewayOpen,
          handlers,
        ),
    ),
    sealInvestigationGateway: enabled(
      (request: ReviewInvestigationContextGatewaySealRequest) =>
        sealGateway(
          request,
          ContextLeaseAuthorityKind.InvestigationShadow,
          ReviewActionV2OperationId.ReviewInvestigationContextGatewaySeal,
          handlers,
        ),
    ),
    commitReplay: enabled((request: ReviewContextReplayCommitRequest) =>
      commitReplay(request, handlers),
    ),
    commitReceiptReplay: enabled(
      (request: ReviewContextReceiptReplayCommitRequest) =>
        commitReceiptReplay(request, handlers),
    ),
  };
}

export function createReviewActionV2ContextReplayCoordinator(
  dependencies: ReviewActionV2ContextAttestationHandlerDependencies,
): ReviewActionV2ContextReplayCoordinatorPort {
  validateConfig(dependencies);
  return Object.freeze({
    prepareReplay: (input: ReviewActionV2ContextReplayPrepareInput) =>
      prepareReplay(input, dependencies),
    verifyAttachment: (
      input: Parameters<
        ReviewActionV2ContextReplayCoordinatorPort["verifyAttachment"]
      >[0],
    ) => verifyContextAttachment(input, dependencies),
    assertCurrentPolicy: (
      input: Parameters<
        ReviewActionV2ContextReplayCoordinatorPort["assertCurrentPolicy"]
      >[0],
    ) => assertCurrentContextReusePolicy(input, dependencies),
  });
}

export function createInvestigationReceiptReplayPreparationPort(
  target: ReviewActionV2InvestigationReplayTarget,
  d: ReviewActionV2ContextAttestationHandlerDependencies,
): InvestigationReplayPreparationPort {
  return Object.freeze({
    prepare: (
      input: Parameters<InvestigationReplayPreparationPort["prepare"]>[0],
    ) => prepareInvestigationReceiptReplay(input, target, d),
  });
}

function enabled<Request, Result>(
  execute: (request: Request) => Promise<Result>,
) {
  return { capabilityEnabled: true as const, execute };
}

function validateConfig(
  d: ReviewActionV2ContextAttestationHandlerDependencies,
): void {
  assertContextGatewaySessionConfiguration(
    d.config,
    d.sessionSecretKey.byteLength,
  );
}
