import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  createProvisioningPrisma,
  initialCandidate,
} from "../../../../packages/features/workflow-provisioning/src/tests/provisioning-prisma-fixture";
import { PrismaSetupPullRequestMergeHandler } from "./prisma-setup-pull-request-merge-handler";

describe("fenced setup pull request prototype (not wired)", () => {
  it("updates setup under the same epoch and delivery transaction without completing the composite", async () => {
    const state = createProvisioningPrisma(initialCandidate);
    const events: string[] = [];
    const transaction = {
      $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
        if (sql.text.includes("pg_advisory_xact_lock")) {
          events.push("scope");
          return [{ locked: 1 }];
        }
        if (sql.text.includes('"CurrentScopeEpoch"')) {
          events.push("epoch");
          return [{ revision: 1n }];
        }
        if (sql.text.includes("FOR UPDATE")) {
          events.push("fence");
          return [{ deliveryId: "delivery_1" }];
        }
        return [{ valid: true }];
      }),
      $executeRaw: vi.fn(async () => 1),
      gitHubWebhookDelivery: {
        findUnique: vi.fn(async () => ({
          eventName: "pull_request",
          action: "closed",
          installationId: 123n,
          payloadHash: "hash",
        })),
        update: vi.fn(),
      },
      workflowProvisioning: state.workflowProvisioning,
      repositoryConnection: {
        findFirst: vi.fn(async (args: { where: Record<string, unknown> }) =>
          args.where.githubRepositoryId === 456n
            ? {
                id: initialCandidate.repositoryId,
                workspaceId: initialCandidate.workspaceId,
                installationId: initialCandidate.installationId,
                fullName: "acme/widget",
              }
            : state.repositoryConnection.findFirst(args),
        ),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(transaction),
      ),
    };
    const e = {
      deliveryId: "delivery_1",
      eventName: "pull_request" as const,
      payloadHash: "hash",
      payload: {
        action: "closed",
        installation: { id: 123 },
        repository: { id: 456, name: "widget", full_name: "acme/widget" },
        pull_request: {
          number: 7,
          html_url: "https://github.com/acme/widget/pull/7",
          state: "closed",
          merged: true,
          draft: false,
          base: { ref: "main" },
          head: {
            ref: "reviewrouter/setup",
            sha: initialCandidate.pullRequestHeadSha ?? undefined,
          },
        },
      },
    };
    const result = await new PrismaSetupPullRequestMergeHandler(
      prisma as never,
    ).handleFencedGitHubPullRequestWebhook(e, {
      deliveryId: e.deliveryId,
      ownerHash: "a".repeat(64),
      appIdentityHash: "d".repeat(64),
      generation: 1n,
    });
    expect(result).toMatchObject({ processed: true, status: "configured" });
    expect(state.workflowProvisioning.updateMany).toHaveBeenCalledOnce();
    expect(transaction.gitHubWebhookDelivery.update).not.toHaveBeenCalled();
    expect(events.slice(0, 3)).toEqual(["scope", "epoch", "fence"]);
  });
});
