import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { afterEach, expect, it, vi } from "vitest";
import {
  canonicalCodexRotatingProviderId,
  CodexRotatingT0WorkflowSchemaVersion,
} from "@reviewrouter/features-codex-oauth-rotating";
import {
  parseReviewConfigurationStrict,
  safeDefaultReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  ReviewProtocolVersion,
  ReviewRunAuthorizationState,
  ReviewRunAuthorizationTokenAudience,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  reviewRunGatewayOwnedIdentity,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBindingPort,
} from "@reviewrouter/features-review-run-control";
import { createReviewRunGatewayCheckout } from "./review-run-gateway-checkout";
import { PrismaReviewRunGatewayExecutionBinding } from "./prisma-review-run-gateway-execution-binding";
import { ProductionReviewRunRuntimeSnapshot } from "./review-run-runtime-snapshot";

afterEach(() => vi.restoreAllMocks());

const producer = {
  producerReleaseId: "approved-producer",
  actionCommitSha: "a".repeat(40),
  runtimeCommitSha: "b".repeat(40),
};
const agent = {
  profileRef: "approved-toolchain",
  agentKind: "claude",
  binarySha256: "c".repeat(64),
  packageVersion: "1.2.3",
  modelTransports: ["account_gateway"],
  contextGateway: true,
  cancellation: true,
};
const agentAuthority = {
  version: 1,
  producer,
  agent,
  agentProfileDigest: createHash("sha256")
    .update(canonicalJson(agent))
    .digest("hex"),
};
const configuration = parseReviewConfigurationStrict({
  ...safeDefaultReviewConfiguration,
  providers: [
    {
      kind: "codex",
      authMode: "codex_account_gateway",
      model: "mimo-v2-pro",
      reasoningEffort: "high",
      fastMode: false,
      agenticContext: true,
      gatewayBindingId: "binding",
      gatewayProfileRef: "model-profile",
    },
  ],
});
const legacy = {
  snapshotVersion: 1,
  configurationSource: "repository",
  configurationVersion: 7,
  configurationCanonicalJson: canonicalJson(configuration),
  deadline: "2099-01-01T00:00:00.000Z",
  gateway: {
    providerIndex: 0,
    bindingId: "binding",
    connectionId: "private-source",
    bindingRevision: 1,
    policySubject: "binding",
    policyRevision: 2,
    permittedAccountRef: "private-account",
    profileRef: "model-profile",
    invocationId: "invocation",
    attemptId: "attempt",
    operationId: "operation",
    limits: {
      requests: 1,
      concurrency: 1,
      requestBytes: 1024,
      outputBytes: 2048,
      tokens: 128,
    },
  },
};
function authorization(snapshot: unknown): ReviewRunAuthorization {
  return {
    workspaceId: "workspace",
    repositoryConnectionId: "repository",
    scmRepositoryIdentityId: "scm",
    pullRequestNumber: 1,
    baseSha: "d".repeat(40),
    mergeBaseSha: "e".repeat(40),
    headSha: "f".repeat(40),
    reviewRevisionHash: "a".repeat(64),
    sourceRunId: "1",
    sourceRunAttempt: "1",
    workflowIdentityHash: "b".repeat(64),
    trustDomain: ReviewTrustDomain.TrustedManaged,
    authorizationId: "authorization",
    version: 1,
    producerReleaseId: producer.producerReleaseId,
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
    selectedProtocolVersion: ReviewProtocolVersion.V2,
    schemaDigest: "c".repeat(64),
    protocolLimitsProfileId: "limits",
    operationalSloProfileId: "slo",
    mutationEpoch: 1n,
    providerVoteLanes: [],
    reviewInvestigationAuthorizationDescriptorCanonicalJson: null,
    authorizationSafetyDecisionHash: "d".repeat(64),
    protocolOfferHash: "e".repeat(64),
    oidcReplayKeyHash: "f".repeat(64),
    tokenSigningKeyId: "key",
    tokenIssuer: "issuer",
    tokenAudience: ReviewRunAuthorizationTokenAudience.ReviewRun,
    state: ReviewRunAuthorizationState.Active,
    expiresAt: new Date(legacy.deadline),
    maxExpiresAt: new Date(legacy.deadline),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    renewedAt: null,
  };
}
function fixture(snapshot: unknown) {
  const auth = authorization(snapshot);
  const read = vi.fn<ReviewRunGatewayExecutionBindingPort["read"]>(
    async () => ({ status: "live", binding: null }),
  );
  const confirmAuthority = vi.fn(async () => true);
  const issueContentsReadToken = vi.fn(async () => ({
    token: "synthetic-scm-read",
    expiresAt: new Date(legacy.deadline),
    permissions: { contents: "read" as const, pullRequests: "read" as const },
  }));
  const checkout = createReviewRunGatewayCheckout({
    authorizations: {
      resolveReviewRunAuthorizationToken: async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization: auth,
      }),
    },
    bindings: { read, attach: async () => ({ status: "denied" }) },
    resolveRepository: async () => ({
      githubInstallationId: "1",
      githubRepositoryId: "123",
      repositoryFullName: "fixture/repository",
    }),
    confirmAuthority,
    issuer: { issueContentsReadToken },
    maxInFlight: 1,
    timeoutMs: 1000,
  });
  return {
    auth,
    read,
    confirmAuthority,
    issueContentsReadToken,
    issue: () =>
      checkout.issue("run-token", new AbortController().signal, {
        providerInstanceId: canonicalCodexRotatingProviderId("123"),
        workflowSchemaVersion:
          CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
      }),
  };
}

it("checkout projects only captured version1 agent definition/digest and preserves historical absence", async () => {
  const extended = fixture({ ...legacy, agentAuthority });
  const result = await extended.issue();
  expect(result.runtimeConfig.runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_JSON).toBe(
    canonicalJson(agent),
  );
  expect(
    result.runtimeConfig.runtimeEnv.REVIEW_ROUTER_AGENT_PROFILE_DIGEST,
  ).toBe(agentAuthority.agentProfileDigest);
  expect(JSON.stringify(result)).not.toMatch(
    /approved-producer|private-source|private-account|actionCommitSha|runtimeCommitSha/,
  );
  expect(extended.confirmAuthority).toHaveBeenCalledTimes(2);
  const historical = await fixture(legacy).issue();
  expect(historical.runtimeConfig.runtimeEnv).not.toHaveProperty(
    "REVIEW_ROUTER_AGENT_PROFILE_JSON",
  );
  expect(historical.runtimeConfig.runtimeEnv).not.toHaveProperty(
    "REVIEW_ROUTER_AGENT_PROFILE_DIGEST",
  );
});

it("malformed captured authority fails before binding confirmation or SCM checkout mint", async () => {
  const f = fixture({
    ...legacy,
    agentAuthority: { ...agentAuthority, version: 2 },
  });
  await expect(f.issue()).rejects.toThrow();
  expect(f.read).not.toHaveBeenCalled();
  expect(f.confirmAuthority).not.toHaveBeenCalled();
  expect(f.issueContentsReadToken).not.toHaveBeenCalled();
});

it.each(["producer", "profile", "digest"] as const)(
  "captured %s mismatch is denied by production liveness before SCM mint",
  async (change) => {
    const authority = structuredClone(agentAuthority);
    if (change === "producer")
      authority.producer.runtimeCommitSha = "0".repeat(40);
    if (change === "profile") authority.agent.packageVersion = "9.9.9";
    if (change === "digest") authority.agentProfileDigest = "0".repeat(64);
    const f = fixture({ ...legacy, agentAuthority: authority });
    const findUnique = vi.fn(async () => ({
      ...producer,
      state: "registered",
      agentProfilesJson: canonicalJson([agent]),
    }));
    const snapshots = new ProductionReviewRunRuntimeSnapshot({
      producerRelease: { findUnique },
    } as unknown as PrismaClient);
    f.read.mockImplementation(async () => {
      const snapshot = parseReviewRunRuntimeSnapshot(
        f.auth.runtimeSnapshotCanonicalJson,
      )!;
      expect(
        await snapshots.isLive({
          snapshot,
          producerReleaseId: f.auth.producerReleaseId,
          identity: reviewRunGatewayOwnedIdentity(f.auth),
          now: new Date(),
        }),
      ).toBe(false);
      return { status: "denied" };
    });
    await expect(f.issue()).rejects.toThrow("authorization_denied");
    expect(findUnique).toHaveBeenCalledWith({
      where: { producerReleaseId: producer.producerReleaseId },
    });
    expect(f.confirmAuthority).not.toHaveBeenCalled();
    expect(f.issueContentsReadToken).not.toHaveBeenCalled();
  },
);

it("actual binding read passes the persisted producer release into snapshot liveness", async () => {
  const auth = authorization({ ...legacy, agentAuthority });
  const isLive = vi.fn<ProductionReviewRunRuntimeSnapshot["isLive"]>(
    async () => true,
  );
  const tx = {
    $queryRaw: vi
      .fn()
      .mockResolvedValueOnce([{ gatewayExecutionCanonicalJson: null }])
      .mockResolvedValueOnce([{ now: new Date() }]),
    reviewRunAuthorization: { findUnique: async () => auth },
  };
  const prisma = {
    $transaction: async (work: (reader: typeof tx) => Promise<unknown>) =>
      work(tx),
  } as unknown as PrismaClient;
  const snapshots = new ProductionReviewRunRuntimeSnapshot(prisma);
  vi.spyOn(snapshots, "lockGatewaySelection").mockResolvedValue();
  vi.spyOn(snapshots, "isLive").mockImplementation(isLive);
  const owner = {
    authorizationId: auth.authorizationId,
    identity: reviewRunGatewayOwnedIdentity(auth),
    runtimeSnapshotCanonicalJson: auth.runtimeSnapshotCanonicalJson!,
  };
  expect(
    await new PrismaReviewRunGatewayExecutionBinding(prisma, snapshots).read(
      owner,
    ),
  ).toEqual({ status: "live", binding: null });
  expect(isLive).toHaveBeenCalledWith(
    {
      snapshot: parseReviewRunRuntimeSnapshot(
        owner.runtimeSnapshotCanonicalJson,
      ),
      producerReleaseId: auth.producerReleaseId,
      identity: owner.identity,
      now: expect.any(Date),
    },
    tx,
  );
});
