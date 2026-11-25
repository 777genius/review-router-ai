import {
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
  reviewModelTransports,
  reviewModelWireProtocols,
  type ReviewModelDispatchProfileV2,
} from "@reviewrouter/shared";
import type { DashboardRuntimeReleases } from "../review-runtime-readiness";

export const runtimeReadySha = "a".repeat(40);
export const runtimeDispatchProfile: ReviewModelDispatchProfileV2 = {
  extensionId: reviewModelDispatchContract.extensionId,
  policyVersion: reviewModelDispatchContract.policyVersion,
  descriptorDigest: reviewModelDispatchDescriptorDigest,
  transports: reviewModelTransports,
  wireProtocols: reviewModelWireProtocols,
  defaultAgentProfileRefs: Object.fromEntries(
    reviewModelTransports.map((transport) => [transport, `ocr-${transport}`]),
  ),
  limits: {
    maxRequests: reviewModelDispatchContract.maxRequests,
    maxConcurrentRequests: reviewModelDispatchContract.maxConcurrentRequests,
    maxRequestBytes: reviewModelDispatchContract.maxRequestBytes,
    maxResponseBytes: reviewModelDispatchContract.maxResponseBytes,
    maxOutputTokens: reviewModelDispatchContract.maxOutputTokens,
  },
};
export const runtimeAgentProfiles = reviewModelTransports.map((transport) => ({
  profileRef: `ocr-${transport}`,
  agentKind: "ocr" as const,
  binarySha256: "f".repeat(64),
  packageVersion: "1.0.0",
  modelTransports: ["account_gateway", "provider_api"] as const,
  contextGateway: false as const,
  cancellation: true as const,
  reviewSkillsVersion: 1 as const,
}));
export const runtimeReleases: DashboardRuntimeReleases = new Map([
  [
    runtimeReadySha,
    {
      modelDispatchProfile: runtimeDispatchProfile,
      agentProfiles: runtimeAgentProfiles,
      provisioningTransports: reviewModelTransports,
    },
  ],
]);
