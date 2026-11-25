import { describe, expect, it } from "vitest";
import {
  ReviewProviderKind,
  canonicalJson,
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
import {
  prDescriptionExtensionV1,
  providerInvocationManifestV1GoldenFixture,
} from "@reviewrouter/protocol-review-action-v2";
import {
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  assertPrDescriptionManifest,
  assertPrDescriptionWorkSlots,
  parseGeneratedPrDescription,
} from "./review-pr-description";

const slot: ReviewWorkSlotPlan = {
  workSlotId: "description",
  taskKind: ReviewTaskKind.PrDescription,
  providerKind: ReviewExecutionProviderKind.Codex,
  providerVoteIdentityHash: "a".repeat(64),
  shardKey: "description",
  required: false,
  attemptBudget: 1,
  retryPolicyVersion: "description-v1",
};
function authorization(
  options: { approved?: boolean; enabled?: boolean } = {},
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
    ...(options.enabled === undefined
      ? {}
      : { updatePrDescription: options.enabled }),
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
      gateway: null,
      ...(options.approved === false
        ? {}
        : { prDescriptionCapability: prDescriptionExtensionV1 }),
    }),
  };
}

describe("optional captured PR description authority", () => {
  it("preserves old review plans while requiring approved capability for auxiliary work", () => {
    expect(() =>
      assertPrDescriptionWorkSlots(authorization({ approved: false }), []),
    ).not.toThrow();
    expect(() =>
      assertPrDescriptionWorkSlots(authorization({ approved: false }), [slot]),
    ).toThrow();
    expect(() =>
      assertPrDescriptionWorkSlots(authorization(), [slot]),
    ).not.toThrow();
    expect(() =>
      assertPrDescriptionWorkSlots(authorization({ enabled: false }), [slot]),
    ).toThrow();
  });
  it("allows only one optional single-attempt primary-lane slot", () => {
    for (const slots of [
      [slot, { ...slot, workSlotId: "another" }],
      [{ ...slot, required: true }],
      [{ ...slot, attemptBudget: 2 }],
      [{ ...slot, providerVoteIdentityHash: "d".repeat(64) }],
    ]) {
      expect(() =>
        assertPrDescriptionWorkSlots(authorization(), slots),
      ).toThrow();
    }
  });
  it("binds the separate prompt-only manifest to the captured model and auxiliary policy", () => {
    const manifest = normalizeProviderInvocationManifest({
      ...providerInvocationManifestV1GoldenFixture.input,
      taskKindSet: [EvidenceTaskKind.PrDescription],
      requestedModel: workspaceProviderFixture.model,
      providerPolicyVersion: "pr-description-provider-policy.v1",
    });
    expect(() =>
      assertPrDescriptionManifest(authorization(), slot, manifest),
    ).not.toThrow();
    expect(() =>
      assertPrDescriptionManifest(authorization(), slot, {
        ...manifest,
        requestedModel: "other-model",
      }),
    ).toThrow();
    expect(() =>
      assertPrDescriptionManifest(authorization(), slot, {
        ...manifest,
        providerPolicyVersion: "codex-provider-policy.v2-t0",
      }),
    ).toThrow();
  });
  it("requires actual matching model provenance and UTF-8-safe owned-marker-free output", () => {
    const value = {
      generatedMarkdown: "Summary",
      generationProvenance: {
        leaseId: "lease-1",
        providerIndex: 0,
        requestedModel: "model",
        actualModel: "model",
        providerRequestEnvelopeHash: "a".repeat(64),
      },
    };
    expect(parseGeneratedPrDescription(value)).toEqual(value);
    for (const markdown of [
      "<!-- review-router-summary:end -->",
      "<!-- AI-ROBOT-REVIEW-SUMMARY-END -->",
      "é".repeat(4097),
    ]) {
      expect(() =>
        parseGeneratedPrDescription({ ...value, generatedMarkdown: markdown }),
      ).toThrow();
    }
    expect(() =>
      parseGeneratedPrDescription({
        ...value,
        generationProvenance: {
          ...value.generationProvenance,
          actualModel: "different-model",
        },
      }),
    ).toThrow();
  });
});
