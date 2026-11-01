import { expect, it, vi } from "vitest";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import {
  reviewModelDispatchContract,
  reviewModelDispatchDescriptorDigest,
} from "@reviewrouter/shared";
import { workspacePolicyFixture } from "../../../../../packages/features/review-config/src/tests/current-policy-fixture";
import type { DashboardRuntimeReleases } from "../review-runtime-readiness";
import { resolveApprovedClaudeSubscriptionActionRef } from "./approved-claude-subscription-action-ref";

const sha = "a".repeat(40);
const actionRef = `777genius/review-router@${sha}`;
const configuration = parseReviewConfigurationStrict({
  ...workspacePolicyFixture,
  providers: [
    {
      kind: "claude",
      authMode: "claude_code_oauth",
      model: "sonnet",
      agenticContext: true,
      fastMode: false,
    },
  ],
});
const release = {
  modelDispatchProfile: {
    extensionId: reviewModelDispatchContract.extensionId,
    policyVersion: reviewModelDispatchContract.policyVersion,
    descriptorDigest: reviewModelDispatchDescriptorDigest,
    transports: ["runner_local_anthropic"] as const,
    wireProtocols: ["anthropic-messages"] as const,
    anthropicModelAliases: { sonnet: "claude-sonnet-qualified-fixture" },
    defaultAgentProfileRefs: { runner_local_anthropic: "ocr-native-claude" },
    limits: {
      maxRequests: 8,
      maxConcurrentRequests: 1 as const,
      maxRequestBytes: 1_000_000,
      maxResponseBytes: 1_000_000,
      maxOutputTokens: 4096,
    },
  },
  agentProfiles: [
    {
      profileRef: "ocr-native-claude",
      agentKind: "ocr" as const,
      binarySha256: "b".repeat(64),
      packageVersion: "1.13.1-rr.5",
      modelTransports: ["provider_api"] as const,
      contextGateway: false as const,
      cancellation: true as const,
      reviewSkillsVersion: 1 as const,
    },
  ],
  provisioningTransports: ["runner_local_anthropic"] as const,
};
const source = `on:
  workflow_call:
    inputs:
      subscription_auth_mode: { type: string, default: '' }
jobs:
  review:
    steps:
      - env:
          REVIEW_ROUTER_MODE: prepared-subscription
          REVIEWROUTER_ACTION_V2_MODE: t0
          REVIEWROUTER_PREPARED_MODEL_TRANSPORT: runner_local_anthropic
          INPUT_CLAUDE_CODE_OAUTH_TOKEN: \${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
`;

it("qualifies the exact configured native producer, frozen model and caller without changing policy", async () => {
  const releases: DashboardRuntimeReleases = new Map([[sha, release]]);
  const readExecutionWorkflow = vi.fn(async () => source);
  const before = structuredClone(configuration);
  await expect(
    resolveApprovedClaudeSubscriptionActionRef(
      { actionRef, configuration, releases },
      { readExecutionWorkflow },
    ),
  ).resolves.toBe(actionRef);
  expect(readExecutionWorkflow).toHaveBeenCalledExactlyOnceWith(sha);
  expect(configuration).toEqual(before);
});

it.each([
  "unregistered",
  "overlap-only",
  "alias-unqualified",
  "wrong-default",
  "missing-caller",
  "wrong-credential",
  "supplied-diff",
  "mutable-pin",
])("does not provision an unsupported native route: %s", async (scenario) => {
  const candidate = {
    ...release,
    provisioningTransports:
      scenario === "overlap-only" ? [] : release.provisioningTransports,
    modelDispatchProfile: {
      ...release.modelDispatchProfile,
      anthropicModelAliases:
        scenario === "alias-unqualified"
          ? {}
          : release.modelDispatchProfile.anthropicModelAliases,
      defaultAgentProfileRefs:
        scenario === "wrong-default"
          ? { runner_local_anthropic: "unapproved-profile" }
          : release.modelDispatchProfile.defaultAgentProfileRefs,
    },
  };
  const config =
    scenario === "supplied-diff"
      ? {
          ...configuration,
          providers: [
            { ...configuration.providers[0]!, agenticContext: false },
          ],
        }
      : configuration;
  let runtimeSource: string | null = source;
  if (scenario === "missing-caller") runtimeSource = null;
  if (scenario === "wrong-credential")
    runtimeSource = source.replace(
      "secrets.CLAUDE_CODE_OAUTH_TOKEN",
      "secrets.OTHER_TOKEN",
    );
  const releases: DashboardRuntimeReleases = new Map(
    scenario === "unregistered" ? [] : [[sha, candidate]],
  );
  const result = resolveApprovedClaudeSubscriptionActionRef(
    {
      actionRef:
        scenario === "mutable-pin" ? "777genius/review-router@main" : actionRef,
      configuration: config,
      releases,
    },
    { readExecutionWorkflow: async () => runtimeSource },
  );
  if (scenario === "missing-caller" || scenario === "wrong-credential")
    await expect(result).rejects.toThrow(
      "claude_subscription_runtime_not_ready",
    );
  else await expect(result).resolves.toBeUndefined();
});
