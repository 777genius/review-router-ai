import {
  investigationRolloutCapabilities,
  investigationRolloutCapabilityDependencies,
} from "../domain/investigation-rollout-policy";

export const reviewInvestigationRolloutAuthorizationV3Contract = Object.freeze({
  authorizationDescriptorVersion: 3,
  capability: "review_investigation_v1",
  capabilities: investigationRolloutCapabilities,
  dependencies: investigationRolloutCapabilityDependencies,
  extensionContract: Object.freeze({
    extensionId: "review-investigation-shadow.v1",
    requiresCanonicalizerDigest: true,
    requiresSchemaDigest: true,
  }),
});

export const reviewInvestigationRolloutAuthorizationPublishedContract =
  Object.freeze({
    exportName: "reviewInvestigationRolloutAuthorizationV3Contract",
    value: reviewInvestigationRolloutAuthorizationV3Contract,
  });

export const reviewHostedRelayExtensionPrerequisiteV1Contract = Object.freeze({
  extensionId: "review-investigation-hosted-relay.v1",
  enabledByDefault: false,
  admissionFlag: "REVIEW_ROUTER_HOSTED_V4_RELAY_ENABLED",
  disposableCohortFlag: "REVIEW_ROUTER_HOSTED_V4_DISPOSABLE_REPOSITORY_ID",
  requiresCanonicalizerDigest: true,
  requiresSchemaDigest: true,
  paidDispatchBlockedPrerequisite:
    "pinned_codex_transport_output_token_limit_unqualified",
});

export const reviewHostedRelayExtensionPrerequisitePublishedContract =
  Object.freeze({
    exportName: "reviewHostedRelayExtensionPrerequisiteV1Contract",
    value: reviewHostedRelayExtensionPrerequisiteV1Contract,
  });
