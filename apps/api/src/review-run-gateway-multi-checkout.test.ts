import { describe, expect, it, vi } from "vitest";
import {
  parseReviewReviewerPlan,
  reviewerPlanContract,
} from "@reviewrouter/shared";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  type ReviewRunAuthorization,
  type ReviewRunRuntimeSnapshotV4,
} from "@reviewrouter/features-review-run-control";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { createReviewRunGatewayCheckout } from "./review-run-gateway-checkout";
import type { ReadSelectedGatewayModelSettings } from "./review-run-gateway-model-settings";

function fixture(count = 2, sharedAllocation = false) {
  const profileRef = "openrouter-openai-responses-apikey-v1";
  const configuration = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: Array.from({ length: count }, (_, index) => ({
      kind: "codex",
      authMode: "codex_account_gateway",
      model: `openai/qualified-model-${index}`,
      reasoningEffort: index % 2 === 0 ? "high" : "medium",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
      gatewayBindingId: `binding-${sharedAllocation ? 0 : index}`,
      gatewayProfileRef: profileRef,
    })),
    execution: {
      providerLimit: count,
      providerMaxParallel: count,
      inlineMinAgreement: count,
    },
  });
  const deadline = "2126-01-01T00:00:00.000Z";
  const agentProfile = {
    profileRef: "codex-approved",
    agentKind: "codex" as const,
    binarySha256: "a".repeat(64),
    packageVersion: "0.147.0",
    modelTransports: ["account_gateway" as const],
    contextGateway: true as const,
    cancellation: true as const,
  };
  const snapshot: ReviewRunRuntimeSnapshotV4 = {
    snapshotVersion: 4,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
    producer: {
      producerReleaseId: "release-1",
      actionCommitSha: "c".repeat(40),
      runtimeCommitSha: "d".repeat(40),
    },
    configurationCanonicalJson: canonicalJson(configuration),
    deadline,
    primaryReviewerId: "reviewer-0",
    maxParallelReviewers: count,
    inlineMinAgreement: count,
    reviewers: configuration.providers.map((provider, providerIndex) => ({
      reviewerId: `reviewer-${providerIndex}`,
      providerIndex,
      providerVoteIdentityHash: String(providerIndex).padStart(64, "0"),
      required: true,
      transport: {
        kind: "account_gateway",
        allocationId: `allocation-${sharedAllocation ? 0 : providerIndex}`,
      },
      requestedModel: provider.model,
      ...(provider.reasoningEffort === undefined
        ? {}
        : { reasoningEffort: provider.reasoningEffort }),
      agenticContext: true,
      fastMode: false,
      agentProfile,
      agentProfileDigest: "b".repeat(64),
      concurrencyGroupId: `allocation-${sharedAllocation ? 0 : providerIndex}`,
      investigationGrant: null,
    })),
    allocations: Array.from(
      { length: sharedAllocation ? 1 : count },
      (_, index) => ({
        allocationId: `allocation-${index}`,
        bindingId: `binding-${index}`,
        connectionId: `private-connection-${index}`,
        bindingRevision: 1,
        policySubject: `binding-${index}`,
        policyRevision: 1,
        permittedAccountRef: `private-account-${index}`,
        profileRef,
        invocationId: `invocation-${index}`,
        attemptId: `attempt-${index}`,
        operationId: `operation-${index}`,
        expectedAuthorizationEpoch: 7,
        limits: {
          requests: 16,
          concurrency: sharedAllocation ? 1 : 2,
          requestBytes: 16384,
          outputBytes: 16384,
          tokens: 4096,
        },
      }),
    ),
  };
  expect(parseReviewRunRuntimeSnapshot(canonicalJson(snapshot))).toEqual(
    snapshot,
  );
  const authorization = {
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 1,
    sourceRunId: "run-1",
    sourceRunAttempt: "1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    reviewRevisionHash: "c".repeat(64),
    workflowIdentityHash: "d".repeat(64),
    trustDomain: ReviewTrustDomain.TrustedManaged,
    authorizationId: "authorization-1",
    version: 1,
    maxExpiresAt: new Date(deadline),
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
  } as ReviewRunAuthorization;
  const deniedAllocations = new Set<string>();
  const settings = vi.fn<ReadSelectedGatewayModelSettings>(
    async ({ reviewerId }) => {
      const reviewer = snapshot.reviewers.find(
        (row) => row.reviewerId === reviewerId,
      );
      if (!reviewer) throw new Error("exact_reviewer_required");
      return {
        authorizationEpoch: 7,
        settings: {
          model: reviewer.requestedModel,
          reasoning: { allowed: ["medium", "high"], default: "high" },
        },
      };
    },
  );
  const issuer = vi.fn(async () => ({
    token: "t".repeat(16384),
    expiresAt: new Date(deadline),
    permissions: { contents: "read" as const, pullRequests: "read" as const },
  }));
  let parentLive = true;
  const checkout = createReviewRunGatewayCheckout({
    authorizations: {
      resolveReviewRunAuthorizationToken: async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization,
      }),
    },
    bindings: {
      read: async ({ allocationId }) =>
        deniedAllocations.has(allocationId!)
          ? { status: "denied" }
          : { status: "live", binding: null },
      attach: async () => ({ status: "denied" }),
    },
    confirmAuthority: async () => parentLive,
    resolveRepository: async () => ({
      githubInstallationId: "123",
      githubRepositoryId: "456",
      repositoryFullName: "owner/repo",
    }),
    issuer: { issueContentsReadToken: issuer },
    readSelectedModelSettings: settings,
    maxInFlight: 4,
    timeoutMs: 30_000,
  });
  return {
    snapshot,
    authorization,
    deniedAllocations,
    settings,
    issuer,
    revokeParent: () => {
      parentLive = false;
    },
    issue: () =>
      checkout.issue("verified-parent-token", new AbortController().signal, {
        providerInstanceId: "codex-rotating:456",
        workflowSchemaVersion: 2,
      }),
  };
}

describe("multi-reviewer checkout projection", () => {
  it("reads each captured model by exact reviewer and shares one SCM checkout", async () => {
    const f = fixture();
    const result = await f.issue();
    const plan = parseReviewReviewerPlan(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[reviewerPlanContract.runtimeEnvKey]!,
      ),
    );
    expect(f.settings.mock.calls.map(([input]) => input.reviewerId)).toEqual([
      "reviewer-0",
      "reviewer-1",
    ]);
    expect(
      plan.reviewers.map((row) => [
        row.requestedModel,
        row.reasoningEffort,
        row.modelSettings?.model,
      ]),
    ).toEqual([
      ["openai/qualified-model-0", "high", "openai/qualified-model-0"],
      ["openai/qualified-model-1", "medium", "openai/qualified-model-1"],
    ]);
    expect(f.issuer).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("private-account");
    expect(JSON.stringify(result)).not.toContain("private-connection");
    expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
      "REVIEW_ROUTER_GATEWAY_MODEL_SETTINGS_JSON",
    );
  });

  it("retains failed allocation coverage and exports a healthy sibling", async () => {
    const f = fixture();
    f.deniedAllocations.add("allocation-0");
    const result = await f.issue();
    const plan = parseReviewReviewerPlan(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[reviewerPlanContract.runtimeEnvKey]!,
      ),
    );
    expect(plan.reviewers).toHaveLength(2);
    expect(plan.reviewers[0]).toMatchObject({
      required: true,
      unavailableReason: "allocation_unavailable",
    });
    expect(plan.reviewers[0]).not.toHaveProperty("modelSettings");
    expect(plan.reviewers[1]).not.toHaveProperty("unavailableReason");
    expect(plan.reviewers[1]?.modelSettings?.model).toBe(
      "openai/qualified-model-1",
    );
    expect(f.settings).toHaveBeenCalledTimes(1);
  });

  it("keeps a catalog error local while retaining the selected global agreement", async () => {
    const f = fixture();
    f.settings.mockRejectedValueOnce(
      new Error("synthetic_catalog_unavailable"),
    );
    const result = await f.issue();
    const plan = parseReviewReviewerPlan(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[reviewerPlanContract.runtimeEnvKey]!,
      ),
    );
    expect(plan.inlineMinAgreement).toBe(2);
    expect(plan.reviewers[0]?.unavailableReason).toBe(
      "model_settings_unavailable",
    );
    expect(plan.reviewers[1]).not.toHaveProperty("unavailableReason");
  });

  it("invalidates every member of a shared allowance on an epoch mismatch", async () => {
    const f = fixture(2, true);
    const original = f.settings.getMockImplementation()!;
    f.settings.mockImplementation(async (input) => ({
      ...(await original(input)),
      authorizationEpoch: input.reviewerId === "reviewer-1" ? 8 : 7,
    }));
    const result = await f.issue();
    const plan = parseReviewReviewerPlan(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[reviewerPlanContract.runtimeEnvKey]!,
      ),
    );
    expect(plan.concurrencyGroups).toEqual([
      { concurrencyGroupId: "allocation-0", maxParallel: 1 },
    ]);
    expect(
      plan.reviewers.every(
        (row) =>
          row.unavailableReason === "allocation_unavailable" &&
          row.modelSettings === undefined,
      ),
    ).toBe(true);
  });

  it("still denies the entire checkout when parent authority is lost", async () => {
    const f = fixture();
    const original = f.settings.getMockImplementation()!;
    f.settings.mockImplementation(async (input) => {
      f.revokeParent();
      return original(input);
    });
    await expect(f.issue()).rejects.toThrow("authorization_denied");
    expect(f.issuer).not.toHaveBeenCalled();
  });

  it("bounds the complete encoded sixteen-reviewer response including the maximum SCM token", async () => {
    const f = fixture(16);
    const result = await f.issue();
    const encoded = JSON.stringify(result);
    const plan = parseReviewReviewerPlan(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[reviewerPlanContract.runtimeEnvKey]!,
      ),
    );
    expect(plan.reviewers).toHaveLength(16);
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(131_072);
    expect(result.token).toHaveLength(16_384);
  });
});
