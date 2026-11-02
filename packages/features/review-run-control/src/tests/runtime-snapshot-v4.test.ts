import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalJson } from "../domain/review-run-control-types";
import {
  canonicalReviewRunReviewerIdentity,
  canonicalReviewRunReviewerVoteIdentity,
} from "../domain/review-run-reviewer-identity";
import {
  buildReviewRunReviewerPlan,
  getReviewRunReviewer,
  getPrimaryReviewRunReviewer,
  getReviewRunGatewayAllocation,
  parseReviewRunRuntimeSnapshot,
} from "../domain/review-run-runtime-snapshot";

function fixture(count = 2) {
  const agentProfile = {
    profileRef: "codex-approved",
    agentKind: "codex",
    binarySha256: "a".repeat(64),
    packageVersion: "1.2.3",
    modelTransports: ["account_gateway"],
    contextGateway: true,
    cancellation: true,
  };
  const reviewers = Array.from({ length: count }, (_, providerIndex) => ({
    reviewerId: `reviewer-${providerIndex}`,
    providerIndex,
    providerVoteIdentityHash: providerIndex.toString(16).padStart(64, "0"),
    required: true,
    transport: { kind: "account_gateway", allocationId: "allocation-0" },
    requestedModel: `model-${providerIndex}`,
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    agentProfile,
    agentProfileDigest: "b".repeat(64),
    concurrencyGroupId: "allocation-0",
    investigationGrant: null,
  }));
  return {
    snapshotVersion: 4,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"c".repeat(64)}`,
    producer: {
      producerReleaseId: "producer",
      actionCommitSha: "d".repeat(40),
      runtimeCommitSha: "e".repeat(40),
    },
    configurationCanonicalJson: canonicalJson({
      schemaVersion: 3,
      providers: reviewers.map((reviewer) => ({
        authMode: "codex_account_gateway",
        gatewayBindingId: "binding",
        gatewayProfileRef: "profile",
        model: reviewer.requestedModel,
        reasoningEffort: "high",
        agenticContext: true,
        fastMode: false,
      })),
    }),
    deadline: "2026-10-29T00:00:00.000Z",
    primaryReviewerId: "reviewer-0",
    maxParallelReviewers: count,
    inlineMinAgreement: 1,
    reviewers,
    allocations: [
      {
        allocationId: "allocation-0",
        bindingId: "binding",
        connectionId: "connection",
        bindingRevision: 1,
        policySubject: "binding",
        policyRevision: 1,
        permittedAccountRef: "account",
        profileRef: "profile",
        invocationId: "invocation",
        attemptId: "attempt",
        operationId: "operation",
        expectedAuthorizationEpoch: 1,
        limits: {
          requests: 8,
          concurrency: 2,
          requestBytes: 16384,
          outputBytes: 16384,
          tokens: 500,
        },
      },
    ],
  };
}

describe("private runtime snapshot v4", () => {
  it("captures every exact reviewer while exporting only safe scheduling facts", () => {
    const raw = fixture();
    const parsed = parseReviewRunRuntimeSnapshot(canonicalJson(raw));
    expect(parsed).toEqual(raw);
    if (parsed?.snapshotVersion !== 4) throw new Error("v4 required");
    expect(getPrimaryReviewRunReviewer(parsed).reviewerId).toBe("reviewer-0");
    expect(getReviewRunReviewer(parsed, "reviewer-1").requestedModel).toBe(
      "model-1",
    );
    expect(
      getReviewRunGatewayAllocation(parsed, "allocation-0").limits.requests,
    ).toBe(8);
    expect(() => getReviewRunReviewer(parsed, "foreign")).toThrow();
    const safe = buildReviewRunReviewerPlan(parsed);
    expect(safe.concurrencyGroups).toEqual([
      { concurrencyGroupId: "allocation-0", maxParallel: 2 },
    ]);
    for (const field of [
      "bindingId",
      "permittedAccountRef",
      "operationId",
      "connectionId",
      "limits",
    ])
      expect(canonicalJson(safe)).not.toContain(`"${field}"`);
  });
  it("accepts sixteen maximum reviewers within the private and public bounds", () => {
    const raw = fixture(16);
    const parsed = parseReviewRunRuntimeSnapshot(canonicalJson(raw));
    expect(Buffer.byteLength(canonicalJson(parsed))).toBeLessThan(131_072);
    if (parsed?.snapshotVersion !== 4) throw new Error("v4 required");
    expect(
      Buffer.byteLength(canonicalJson(buildReviewRunReviewerPlan(parsed))),
    ).toBeLessThan(65_536);
  });
  it("rejects singular aliases, mismatched models, duplicate votes and foreign allocations", () => {
    const raw = fixture();
    for (const value of [
      { ...raw, agent: raw.reviewers[0]!.agentProfile },
      { ...raw, gateway: null },
      {
        ...raw,
        reviewers: [
          raw.reviewers[0],
          { ...raw.reviewers[1], requestedModel: "foreign" },
        ],
      },
      {
        ...raw,
        reviewers: [
          raw.reviewers[0],
          {
            ...raw.reviewers[1],
            providerVoteIdentityHash:
              raw.reviewers[0]!.providerVoteIdentityHash,
          },
        ],
      },
      {
        ...raw,
        reviewers: [
          raw.reviewers[0],
          {
            ...raw.reviewers[1],
            transport: { kind: "account_gateway", allocationId: "foreign" },
          },
        ],
      },
      {
        ...raw,
        allocations: [
          ...raw.allocations,
          { ...raw.allocations[0], allocationId: "unused" },
        ],
      },
    ])
      expect(() =>
        parseReviewRunRuntimeSnapshot(canonicalJson(value)),
      ).toThrow();
  });
  it("derives stable exact identities without settings or row-position votes", () => {
    const identity = {
      providerProfileIdentityKey: "gateway_binding:binding/profile:model",
      agentProfileRef: "codex-approved",
      agentProfileDigest: "a".repeat(64),
    };
    const hash = (value: string) =>
      createHash("sha256").update(value).digest("hex");
    const reviewerId = `rr-reviewer-${hash(canonicalReviewRunReviewerIdentity(identity))}`;
    expect(reviewerId).toBe(
      `rr-reviewer-${hash(canonicalReviewRunReviewerIdentity({ ...identity }))}`,
    );
    expect(
      canonicalReviewRunReviewerIdentity({
        ...identity,
        agentProfileRef: "ocr-approved",
      }),
    ).not.toBe(canonicalReviewRunReviewerIdentity(identity));
    expect(
      canonicalReviewRunReviewerVoteIdentity({
        reviewerId,
        providerVoteIdentityHash: "b".repeat(64),
      }),
    ).not.toBe(
      canonicalReviewRunReviewerVoteIdentity({
        reviewerId,
        providerVoteIdentityHash: "c".repeat(64),
      }),
    );
  });
});
