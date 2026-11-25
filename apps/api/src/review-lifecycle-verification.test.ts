import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  ReviewProviderKind,
} from "@reviewrouter/features-review-run-control";
import {
  ReviewExecutionProviderKind,
  ReviewTaskKind,
  type ReviewWorkSlotPlan,
} from "@reviewrouter/features-review-executions";
import {
  normalizeProviderInvocationManifest,
  ReviewTaskKind as EvidenceTaskKind,
} from "@reviewrouter/features-review-evidence";
import { providerInvocationManifestV1GoldenFixture } from "@reviewrouter/protocol-review-action-v2";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
  type LifecycleVerificationCapabilityV1,
} from "@reviewrouter/shared";
import {
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  assertLifecycleVerificationWorkSlots,
  assertLifecycleVerificationManifest,
  assertLifecycleVerificationObservation,
  assertLifecycleVerificationPreparedPlan,
  assertLifecycleVerificationAssignmentManifest,
  lifecycleVerificationCapabilityHash,
  lifecycleVerificationOutputSchemaHash,
} from "./review-lifecycle-verification";
const capability: LifecycleVerificationCapabilityV1 = {
  extensionId: lifecycleVerificationContract.extensionId,
  descriptorDigest: lifecycleVerificationDescriptorDigest,
  executor: lifecycleVerificationContract.executor,
  modelTransport: "account_gateway",
  providerIndex: 0,
  providerKind: "codex",
  model: workspaceProviderFixture.model,
  maxDispatches: 2,
  maxPromptBytes: 98304,
  maxResponseBytes: 32768,
  maxOutputTokens: 4096,
  deadlineMs: 60000,
  attemptBudget: 1,
};
const slot: ReviewWorkSlotPlan = {
  workSlotId: "lifecycle",
  taskKind: ReviewTaskKind.LifecycleRevalidation,
  providerKind: ReviewExecutionProviderKind.Codex,
  providerVoteIdentityHash: "a".repeat(64),
  shardKey: "lifecycle",
  required: false,
  attemptBudget: 1,
  retryPolicyVersion: "lifecycle-no-replay.v1",
};
const manifest = normalizeProviderInvocationManifest({
  ...providerInvocationManifestV1GoldenFixture.input,
  taskKindSet: [EvidenceTaskKind.LifecycleRevalidation],
  providerCapabilityHash: lifecycleVerificationCapabilityHash(capability),
  requestedModel: capability.model,
  providerPolicyVersion: lifecycleVerificationContract.policyVersion,
  outputSchemaHash: lifecycleVerificationOutputSchemaHash,
  lifecycleTargetSetHash: createHash("sha256")
    .update(canonicalJson([{ targetId: "target-1" }]))
    .digest("hex"),
  liveLifecycleStateHash: "e".repeat(64),
  contextManifestHash: "f".repeat(64),
});
const assignment = {
  workSlotId: slot.workSlotId,
  packetHash: manifest.contextManifestHash,
  targetIds: ["target-1"],
  lifecycleTargetSetHash: manifest.lifecycleTargetSetHash,
  liveLifecycleStateHash: manifest.liveLifecycleStateHash,
};
const plan = {
  manifestVersion: 2,
  assignments: [{ workSlotId: slot.workSlotId, paths: [] }],
  lifecyclePlan: {
    version: 1,
    capabilityHash: lifecycleVerificationCapabilityHash(capability),
    descriptorDigest: lifecycleVerificationDescriptorDigest,
    participantRoster: [
      { providerVoteIdentityHash: slot.providerVoteIdentityHash },
    ],
    targets: [{ targetId: "target-1" }],
    assignments: [assignment],
  },
};
function authorization(
  options: { approved?: boolean; unavailable?: boolean } = {},
) {
  const configuration = {
    ...workspacePolicyFixture,
    providers: [
      {
        ...workspaceProviderFixture,
        authMode: "codex_account_gateway",
        gatewayBindingId: "binding-1",
        gatewayProfileRef: "profile-1",
      },
    ],
  };
  return {
    providerVoteLanes: [
      {
        providerKind: ReviewProviderKind.Codex,
        providerVoteIdentityHash: slot.providerVoteIdentityHash,
      },
    ],
    runtimeSnapshotCanonicalJson: canonicalJson({
      snapshotVersion: 3,
      configurationSource: "repository",
      configurationVersion: 1,
      workspaceConfigurationVersion: 1,
      repositoryConfigurationVersion: 1,
      effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
      agent: {
        profileRef: "codex-default",
        agentKind: "codex",
        binarySha256: "a".repeat(64),
        packageVersion: "0.147.0",
        modelTransports: ["account_gateway"],
        contextGateway: true,
        cancellation: true,
      },
      agentProfileDigest: "b".repeat(64),
      producer: {
        producerReleaseId: "producer-1",
        actionCommitSha: "c".repeat(40),
        runtimeCommitSha: "c".repeat(40),
      },
      configurationCanonicalJson: canonicalJson(configuration),
      deadline: "2026-10-21T19:00:00.000Z",
      gateway: {
        providerIndex: 0,
        bindingId: "binding-1",
        connectionId: "connection-1",
        bindingRevision: 1,
        policySubject: "binding-1",
        policyRevision: 1,
        permittedAccountRef: "account-1",
        profileRef: "profile-1",
        invocationId: "invocation-1",
        attemptId: "attempt-1",
        operationId: "operation-1",
        limits: {
          requests: 9,
          concurrency: 1,
          requestBytes: 98304,
          outputBytes: 32768,
          tokens: 4096,
        },
      },
      ...(options.approved === false
        ? {}
        : options.unavailable
          ? {
              lifecycleVerificationUnavailableReason:
                "verification_configuration_invalid",
            }
          : { lifecycleVerificationCapability: capability }),
    }),
  };
}

it("keeps legacy lifecycle manifests compatible while invalid enabled profiles cannot fall back", () => {
  expect(() =>
    assertLifecycleVerificationManifest(
      authorization({ approved: false }),
      slot,
      { ...manifest, requestedModel: "legacy-model" },
    ),
  ).not.toThrow();
  expect(() =>
    assertLifecycleVerificationWorkSlots(authorization({ unavailable: true }), [
      slot,
    ]),
  ).toThrow();
  expect(() =>
    assertLifecycleVerificationWorkSlots(authorization(), [slot]),
  ).not.toThrow();
  for (const forged of [
    { ...slot, attemptBudget: 2 },
    { ...slot, required: true },
    { ...slot, providerVoteIdentityHash: "b".repeat(64) },
  ])
    expect(() =>
      assertLifecycleVerificationWorkSlots(authorization(), [forged]),
    ).toThrow();
});
it("binds purpose, saved model, immutable profile, target state, packet, and declared roster", () => {
  expect(() =>
    assertLifecycleVerificationManifest(authorization(), slot, manifest),
  ).not.toThrow();
  expect(() =>
    assertLifecycleVerificationPreparedPlan(
      authorization(),
      plan,
      slot,
      manifest,
    ),
  ).not.toThrow();
  expect(() =>
    assertLifecycleVerificationAssignmentManifest(
      authorization(),
      [slot],
      plan,
    ),
  ).not.toThrow();
  for (const forged of [
    { ...manifest, requestedModel: "other" },
    { ...manifest, providerCapabilityHash: "b".repeat(64) },
    { ...manifest, lifecycleTargetSetHash: null },
    { ...manifest, taskKindSet: [EvidenceTaskKind.FindingDiscovery] },
  ])
    expect(() =>
      assertLifecycleVerificationManifest(authorization(), slot, forged),
    ).toThrow();
  expect(() =>
    assertLifecycleVerificationPreparedPlan(authorization(), plan, slot, {
      ...manifest,
      contextManifestHash: "1".repeat(64),
    }),
  ).toThrow();
  expect(() =>
    assertLifecycleVerificationAssignmentManifest(authorization(), [slot], {
      ...plan,
      lifecyclePlan: { ...plan.lifecyclePlan, participantRoster: [] },
    }),
  ).toThrow();
  expect(() =>
    assertLifecycleVerificationAssignmentManifest(authorization(), [slot], {
      ...plan,
      assignments: [{ workSlotId: slot.workSlotId, paths: ["src/secret.ts"] }],
    }),
  ).toThrow();
  expect(() =>
    assertLifecycleVerificationObservation(authorization(), slot, manifest, {
      normalizedFindings: [{ fake: "discovery" }],
    }),
  ).toThrow();
});
