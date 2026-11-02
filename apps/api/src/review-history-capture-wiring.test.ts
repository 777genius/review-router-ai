import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import * as historyComposition from "@reviewrouter/features-review-history/composition";
import * as actionControlPlane from "@reviewrouter/features-action-control-plane";
import {
  createReviewRequestedIntent,
  ReviewRequestedTriggerKind,
} from "@reviewrouter/features-review-executions";
import { createApiApp } from "./app";
import { OctokitCodexRotatingGitHubSecretGateway } from "./github/octokit-codex-rotating-github-secret-gateway";

describe("hosted API history capture composition", () => {
  it("uses the single assembled writer for hosted prelease admission outcomes", async () => {
    vi.stubEnv("GITHUB_APP_ID", "123");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY_FILE", undefined);
    vi.stubEnv("REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH", "0");
    vi.stubEnv("REVIEW_ROUTER_ENABLE_CONFLICT_REVIEW_FALLBACK", "0");
    vi.stubEnv(
      "GITHUB_APP_PRIVATE_KEY",
      "-----BEGIN PRIVATE KEY-----\\ntest\\n-----END PRIVATE KEY-----",
    );
    vi.stubEnv("REVIEW_ROUTER_HOSTED_MAX_CHANGED_LINES", "1");
    const now = new Date();
    const intent = createReviewRequestedIntent({
      workspaceId: "work",
      repositoryConnectionId: "repo",
      scmRepositoryIdentityId: "scm",
      pullRequestNumber: 42,
      requestId: "request",
      revision: {
        baseSha: "a".repeat(40),
        mergeBaseSha: "b".repeat(40),
        headSha: "c".repeat(40),
        reviewRevisionHash: "d".repeat(64),
      },
      triggerKind: ReviewRequestedTriggerKind.ManualCommand,
      deliveryIdentityHash: "e".repeat(64),
      canonicalRequestHash: "f".repeat(64),
      notBefore: now,
      createdAt: now,
      retainUntil: new Date(now.getTime() + 86400000),
    });
    const row = {
      ...intent,
      ...intent.revision,
      version: 4n,
      state: "awaiting_authorization",
      sourceRunId: "1001",
      sourceRunAttempt: "1",
      nextResolutionAt: new Date(now.getTime() + 1000),
      resolutionDeadlineAt: new Date(now.getTime() + 60000),
      claimId: null,
      claimOwnerIdHash: null,
      claimFencingToken: null,
      claimedAt: null,
      claimUntil: null,
      admissionState: "not_evaluated",
      admissionChangedLines: null,
      admissionMaxChangedLines: null,
      admissionPolicySnapshotId: null,
      admissionDecisionHash: null,
      admissionCheckedAt: null,
    };
    const requested = {
      findUnique: async () => row,
      findMany: async () => [row],
      updateMany: async (input: { data: object }) => {
        Object.assign(row, input.data);
        return { count: 1 };
      },
    };
    const tx = {
      $queryRaw: async () => [{ epochMs: Date.now() }],
      reviewRequestedIntent: requested,
    };
    const prisma = {
      $transaction: async (
        callback: (transaction: typeof tx) => Promise<unknown>,
      ) => callback(tx),
      reviewRequestedIntent: requested,
      $disconnect: vi.fn(),
    } as unknown as PrismaClient;
    const original = historyComposition.createReviewHistoryFeature;
    const captures = vi.fn(async () => undefined);
    const root = vi
      .spyOn(historyComposition, "createReviewHistoryFeature")
      .mockImplementation(async (input) => {
        const feature = await original(input);
        vi.spyOn(feature.writer, "captureIntent").mockImplementation(captures);
        return feature;
      });
    const routes = vi
      .spyOn(actionControlPlane, "registerActionControlPlaneRoutes")
      .mockResolvedValue(undefined);
    const pullRequests = vi
      .spyOn(OctokitCodexRotatingGitHubSecretGateway.prototype, "resolve")
      .mockResolvedValue({
        pullRequestNumber: 42,
        headSha: intent.revision.headSha,
        additions: 2,
        deletions: 0,
      });
    let app: Awaited<ReturnType<typeof createApiApp>> | undefined;
    try {
      app = await createApiApp({
        prisma,
        actionSessionSecret: "s".repeat(32),
        reviewRunControlV2Enabled: false,
        healthDependencies: [],
        reviewActionV2Env: {
          REVIEW_ROUTER_REVIEW_HISTORY_CAPTURE: "1",
          REVIEW_ROUTER_CODEX_ROTATING_ACTION_REF: `777genius/review-router@${"a".repeat(40)}`,
          REVIEW_ROUTER_PUBLIC_API_URL: "https://api.reviewrouter.dev",
        },
      });
      const gate = routes.mock.calls[0]?.[1].hostedReviewPreleaseGate;
      if (!gate) throw new Error("test_hosted_prelease_gate_missing");
      await expect(
        gate.evaluate({
          repository: {
            workspaceId: "work",
            repositoryId: "repo",
            githubRepositoryId: "123",
            githubInstallationId: "456",
            fullName: "org/repo",
            owner: "org",
            selected: true,
            installationStatus: "active",
          },
          sourceRunId: "1001",
          sourceRunAttempt: "1",
          intentRequired: true,
          now,
        }),
      ).resolves.toMatchObject({
        status: "skipped",
        reason: "max_changed_lines_exceeded",
      });
      expect(root).toHaveBeenCalledOnce();
      expect(captures).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          requestId: "request",
          state: "terminal",
          terminalReason: "max_changed_lines_exceeded",
        }),
        expect.objectContaining({ state: "awaiting_authorization" }),
      );
    } finally {
      await app?.close();
      root.mockRestore();
      routes.mockRestore();
      pullRequests.mockRestore();
      vi.unstubAllEnvs();
    }
  });
});
