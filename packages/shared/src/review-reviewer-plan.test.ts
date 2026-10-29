import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseReviewReviewerPlan,
  reviewerPlanContract,
  reviewerPlanDescriptorDigest,
  type ReviewReviewerPlanV1,
} from "./review-reviewer-plan";

function reviewer(index: number) {
  const reviewerId = `reviewer-${index}`;
  const providerVoteIdentityHash = index.toString(16).padStart(64, "0");
  return {
    reviewerId,
    providerIndex: index,
    providerVoteIdentityHash,
    required: true,
    transport: "account_gateway" as const,
    requestedModel: `model-${index}`,
    reasoningEffort: "high" as const,
    agenticContext: true,
    fastMode: false,
    agentProfile: {
      profileRef: "codex-v1",
      agentKind: "codex" as const,
      binarySha256: "a".repeat(64),
      packageVersion: "1.2.3",
      modelTransports: ["account_gateway" as const],
      contextGateway: true as const,
      cancellation: true as const,
    },
    agentProfileDigest: "b".repeat(64),
    concurrencyGroupId: "group-0",
    investigationGrant: null,
  };
}
function plan(count = 2): ReviewReviewerPlanV1 {
  return {
    planVersion: 1,
    primaryReviewerId: "reviewer-0",
    maxParallelReviewers: count,
    inlineMinAgreement: 1,
    reviewers: Array.from({ length: count }, (_, index) => reviewer(index)),
    concurrencyGroups: [{ concurrencyGroupId: "group-0", maxParallel: count }],
  };
}
function grant(row = reviewer(0)) {
  return {
    reviewerId: row.reviewerId,
    providerVoteIdentityHash: row.providerVoteIdentityHash,
    requestedModel: row.requestedModel,
    agentProfileDigest: row.agentProfileDigest,
    descriptor: {
      authorizationDescriptorVersion: 3,
      capability: "review_investigation_v1",
      coverageProfileHash: "c".repeat(64),
      extensionCanonicalizerDigest: "d".repeat(64),
      extensionId: "review-investigation-shadow.v1",
      extensionSchemaDigest: "e".repeat(64),
      policyHash: "f".repeat(64),
      providerCapabilities: [
        { providerKind: "codex", capabilities: ["recording", "shadow"] },
      ],
    },
  };
}

describe("safe reviewer plan v1", () => {
  it("has a digest bound to its exact immutable compatibility descriptor", () => {
    const canonical = JSON.stringify(
      Object.fromEntries(
        Object.entries(reviewerPlanContract).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ),
    );
    expect(reviewerPlanDescriptorDigest).toBe(
      `sha256:${createHash("sha256").update(canonical).digest("hex")}`,
    );
  });
  it("accepts one and sixteen reviewers and detaches nested caller objects", () => {
    for (const count of [1, 16]) {
      const input = plan(count);
      const parsed = parseReviewReviewerPlan(JSON.stringify(input));
      expect(parsed).toEqual(input);
      expect(
        Object.isFrozen(parsed.reviewers[0]!.agentProfile.modelTransports),
      ).toBe(true);
      expect(Buffer.byteLength(JSON.stringify(parsed))).toBeLessThan(65_536);
    }
  });
  it("rejects empty, oversized, duplicate, foreign or unbound lanes", () => {
    const original = plan();
    const invalid = [
      plan(0),
      plan(17),
      { ...original, extra: true },
      { ...original, primaryReviewerId: "reviewer-1" },
      { ...original, maxParallelReviewers: 3 },
      { ...original, inlineMinAgreement: 3 },
      { ...original, reviewers: [reviewer(0), reviewer(0)] },
      {
        ...original,
        reviewers: [
          reviewer(0),
          {
            ...reviewer(1),
            providerVoteIdentityHash: reviewer(0).providerVoteIdentityHash,
          },
        ],
      },
      {
        ...original,
        concurrencyGroups: [{ concurrencyGroupId: "foreign", maxParallel: 1 }],
      },
      {
        ...original,
        concurrencyGroups: [{ concurrencyGroupId: "group-0", maxParallel: 3 }],
      },
      {
        ...original,
        reviewers: [{ ...reviewer(0), accountRef: "private" }, reviewer(1)],
      },
    ];
    for (const value of invalid)
      expect(() => parseReviewReviewerPlan(value)).toThrow();
    expect(() => parseReviewReviewerPlan(" ".repeat(65_537))).toThrow();
  });
  it("binds scoped grants to one exact same-engine reviewer and preserves descriptor bytes", () => {
    const descriptorGrant = grant();
    const input = {
      ...plan(),
      reviewers: [
        { ...reviewer(0), investigationGrant: descriptorGrant },
        reviewer(1),
      ],
    };
    const parsed = parseReviewReviewerPlan(input);
    expect(
      JSON.stringify(parsed.reviewers[0]!.investigationGrant!.descriptor),
    ).toBe(JSON.stringify(descriptorGrant.descriptor));
    expect(parsed.reviewers[1]!.investigationGrant).toBeNull();
    for (const invalidGrant of [
      { ...descriptorGrant, reviewerId: "reviewer-1" },
      {
        ...descriptorGrant,
        providerVoteIdentityHash: reviewer(1).providerVoteIdentityHash,
      },
      { ...descriptorGrant, requestedModel: "other-model" },
      { ...descriptorGrant, agentProfileDigest: "0".repeat(64) },
      {
        ...descriptorGrant,
        descriptor: {
          ...descriptorGrant.descriptor,
          providerCapabilities: [
            { providerKind: "codex", capabilities: ["shadow"] },
          ],
        },
      },
      {
        ...descriptorGrant,
        descriptor: {
          ...descriptorGrant.descriptor,
          providerCapabilities: [
            { providerKind: "codex", capabilities: ["recording", "unknown"] },
          ],
        },
      },
    ])
      expect(() =>
        parseReviewReviewerPlan({
          ...input,
          reviewers: [
            { ...reviewer(0), investigationGrant: invalidGrant },
            reviewer(1),
          ],
        }),
      ).toThrow();
  });
  it("validates safe selected model controls without accepting private transport fields", () => {
    const input = {
      ...plan(1),
      reviewers: [
        {
          ...reviewer(0),
          modelSettings: {
            model: "model-0",
            reasoning: { allowed: ["low", "high"], default: "high" },
          },
        },
      ],
    };
    expect(parseReviewReviewerPlan(input).reviewers[0]!.modelSettings).toEqual(
      input.reviewers[0]!.modelSettings,
    );
    expect(() =>
      parseReviewReviewerPlan({
        ...input,
        reviewers: [
          {
            ...input.reviewers[0],
            modelSettings: { model: "other", reasoning: null },
          },
        ],
      }),
    ).toThrow();
  });
});
