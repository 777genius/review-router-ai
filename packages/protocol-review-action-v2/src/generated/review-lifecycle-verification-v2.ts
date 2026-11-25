// Generated from shared/src/review-lifecycle-verification-v2.ts. Do not edit.
import {
  lifecycleVerificationContract,
  type LifecycleVerificationCapabilityV1,
} from "./companion-contracts";
import {
  isReviewModelTransport,
  isReviewModelWireProtocol,
  reviewModelWireProtocols,
  reviewModelWireProtocolMatchesTransport,
  reviewModelDispatchContract,
  type ReviewModelTransport,
  type ReviewModelWireProtocol,
} from "./review-model-dispatch-contract";

/** The verifier's semantic packet, verdicts and citation policy stay v1. Only
 * the prepared native wire route and its durable dispatch authority change. */
export const lifecycleVerificationContractV2 = Object.freeze({
  ...lifecycleVerificationContract,
  extensionId: "lifecycle-verification.v2",
  version: 2,
  modelTransport: "prepared_route",
  protocols: Object.freeze(reviewModelWireProtocols),
  requestCanonicalizerVersion: "lifecycle-verification-request.v2",
  dispatchReadbackPath: reviewModelDispatchContract.basePath,
} as const);

export const lifecycleVerificationDescriptorDigestV2 =
  "sha256:20a13b73ea31192e95c01ad66cf8df545d3714504520bf3e786f7735e818c12f";

export type LifecycleVerificationProtocol = ReviewModelWireProtocol;

export type LifecycleVerificationCapabilityV2 = Omit<
  LifecycleVerificationCapabilityV1,
  "extensionId" | "modelTransport"
> &
  Readonly<{
    extensionId: "lifecycle-verification.v2";
    version: 2;
    modelTransport: ReviewModelTransport;
    routeIdentityHash: string;
    protocol: LifecycleVerificationProtocol;
  }>;

export type LifecycleVerificationCapability =
  | LifecycleVerificationCapabilityV1
  | LifecycleVerificationCapabilityV2;

export function parseLifecycleVerificationCapabilityV2(
  value: unknown,
): LifecycleVerificationCapabilityV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const row = value as Record<string, unknown>;
  const keys = [
    "extensionId",
    "descriptorDigest",
    "executor",
    "version",
    "modelTransport",
    "routeIdentityHash",
    "protocol",
    "providerIndex",
    "providerKind",
    "model",
    "maxDispatches",
    "maxPromptBytes",
    "maxResponseBytes",
    "maxOutputTokens",
    "deadlineMs",
    "attemptBudget",
  ];
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key)) ||
    row.extensionId !== lifecycleVerificationContractV2.extensionId ||
    row.descriptorDigest !== lifecycleVerificationDescriptorDigestV2 ||
    row.executor !== lifecycleVerificationContract.executor ||
    row.version !== 2 ||
    !isReviewModelTransport(row.modelTransport) ||
    typeof row.routeIdentityHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(row.routeIdentityHash) ||
    !isReviewModelWireProtocol(row.protocol) ||
    !reviewModelWireProtocolMatchesTransport(
      row.modelTransport,
      row.protocol,
    ) ||
    row.providerIndex !== 0 ||
    typeof row.providerKind !== "string" ||
    !row.providerKind ||
    row.providerKind.length > 64 ||
    typeof row.model !== "string" ||
    !row.model.trim() ||
    row.model.length > 256 ||
    row.maxDispatches !== lifecycleVerificationContract.maxPackets ||
    row.attemptBudget !== 1
  )
    invalid();
  for (const key of [
    "maxPromptBytes",
    "maxResponseBytes",
    "maxOutputTokens",
    "deadlineMs",
  ] as const) {
    const bound = row[key];
    if (
      typeof bound !== "number" ||
      !Number.isSafeInteger(bound) ||
      bound <= 0 ||
      bound > lifecycleVerificationContract[key]
    )
      invalid();
  }
  if (
    Number(row.maxOutputTokens) <
    lifecycleVerificationContract.minOutputTokensPerTarget
  )
    invalid();
  return Object.freeze({ ...row }) as LifecycleVerificationCapabilityV2;
}

function invalid(): never {
  throw new Error("lifecycle_verification_v2_capability_invalid");
}
