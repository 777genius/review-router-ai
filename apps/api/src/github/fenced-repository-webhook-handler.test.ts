import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaRepositoryWebhookHandler } from "./prisma-repository-webhook-handler";

describe("epoch-fenced repository webhook prototype (not wired)", () => {
  it("takes scope and epoch locks before the delivery fence and completes atomically", async () => {
    const events: string[] = [];
    const transaction = {
      $queryRaw: vi.fn(async (sql: Prisma.Sql) => {
        if (sql.text.includes("pg_advisory_xact_lock")) {
          events.push("scope");
          return [{ locked: 1 }];
        }
        if (sql.text.includes('"CurrentScopeEpoch"')) {
          events.push("epoch-read");
          return [{ revision: 1n }];
        }
        if (sql.text.includes("FOR UPDATE")) {
          events.push("fence");
          return [{ deliveryId: "delivery" }];
        }
        return [{ valid: true }];
      }),
      $executeRaw: vi.fn(async () => {
        events.push("epoch-write");
        return 1;
      }),
      gitHubWebhookDelivery: {
        findUnique: vi.fn(async () => ({
          eventName: "repository",
          action: "deleted",
          installationId: 123n,
          payloadHash: "hash",
        })),
        update: vi.fn(async () => {
          events.push("complete");
          return {};
        }),
      },
      repositoryConnection: {
        findUnique: vi.fn(async () => {
          events.push("repository");
          return null;
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn(transaction),
      ),
    };
    const handler = new PrismaRepositoryWebhookHandler(prisma as never);
    const result = await handler.handleFencedGitHubRepositoryWebhook(
      {
        deliveryId: "delivery",
        eventName: "repository",
        payloadHash: "hash",
        payload: {
          action: "deleted",
          installation: {
            id: 123,
            account: { login: "test", type: "Organization" },
            repository_selection: "all",
          },
          repository: {
            id: 456,
            owner: { login: "test" },
            name: "repo",
            full_name: "test/repo",
            archived: false,
          },
        },
      },
      {
        deliveryId: "delivery",
        ownerHash: "a".repeat(64),
        appIdentityHash: "d".repeat(64),
        generation: 1n,
      },
    );
    expect(result).toMatchObject({
      processed: false,
      reason: "repository_not_synced",
    });
    expect(events).toEqual([
      "scope",
      "epoch-read",
      "epoch-write",
      "fence",
      "repository",
      "complete",
    ]);
  });
});
