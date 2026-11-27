import type { PrismaClient } from "@reviewrouter/platform-db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrismaGitHubAppAuthorizationWebhookHandler } from "./prisma-github-app-authorization-webhook-handler";

describe("PrismaGitHubAppAuthorizationWebhookHandler", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("revokes stored user authorization and clears repository access cache", async () => {
    vi.stubEnv("GITHUB_APP_SLUG", "reviewrouter-test");
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const transaction = {
      user: {
        findMany: vi.fn().mockResolvedValue([{ id: "user_1" }]),
      },
      gitHubUserAuthorization: { updateMany },
      repositoryPermissionCache: { deleteMany },
    };
    const prisma = {
      ...transaction,
      $transaction: vi.fn().mockImplementation((fn) => fn(transaction)),
    } as unknown as PrismaClient;

    await expect(
      new PrismaGitHubAppAuthorizationWebhookHandler(
        prisma,
      ).handleGitHubAppAuthorizationWebhook({
        deliveryId: "delivery_1",
        eventName: "github_app_authorization",
        payload: {
          action: "revoked",
          sender: { id: 123, login: "maintainer" },
        },
      }),
    ).resolves.toEqual({
      processed: true,
      appSlug: "reviewrouter-test",
      githubUserId: "123",
      userCount: 1,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        appSlug: "reviewrouter-test",
        userId: { in: ["user_1"] },
        revokedAt: null,
      },
      data: {
        revision: { increment: 1 },
        refreshAttemptId: null,
        revokedAt: expect.any(Date),
        lastErrorCode: "github_app_authorization_revoked",
      },
    });
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        userId: { in: ["user_1"] },
        authorizationAppSlug: "reviewrouter-test",
      },
    });
  });

  it("binds the fenced revocation and delivery completion in one transaction", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const finish = vi.fn().mockResolvedValue({});
    const transaction = {
      $queryRaw: vi
        .fn()
        .mockImplementation(async (sql: { text: string }) =>
          sql.text.includes("FOR UPDATE")
            ? [{ deliveryId: "delivery_1" }]
            : [{ valid: true }],
        ),
      user: { findMany: vi.fn().mockResolvedValue([{ id: "user_1" }]) },
      gitHubUserAuthorization: { updateMany },
      repositoryPermissionCache: { deleteMany },
      gitHubWebhookDelivery: {
        findUnique: vi.fn().mockResolvedValue({
          eventName: "github_app_authorization",
          action: "revoked",
          payloadHash: "hash",
        }),
        update: finish,
      },
    };
    const prisma = {
      $transaction: vi.fn().mockImplementation((fn) => fn(transaction)),
    } as unknown as PrismaClient;
    const handler = new PrismaGitHubAppAuthorizationWebhookHandler(prisma);
    const envelope = {
      deliveryId: "delivery_1",
      eventName: "github_app_authorization" as const,
      payloadHash: "hash",
      payload: {
        action: "revoked" as const,
        sender: { id: 123, login: "maintainer" },
      },
    };
    const claim = {
      deliveryId: "delivery_1",
      ownerHash: "a".repeat(64),
      appIdentityHash: "d".repeat(64),
      generation: 1n,
    };
    await handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(deleteMany).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledWith({
      where: { deliveryId: "delivery_1" },
      data: { status: "processed", processedAt: expect.any(Date) },
    });
    transaction.gitHubWebhookDelivery.findUnique.mockResolvedValueOnce({
      eventName: "github_app_authorization",
      action: "revoked",
      payloadHash: "different",
    });
    await expect(
      handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim),
    ).rejects.toThrow("webhook_fence_identity_mismatch");
    expect(updateMany).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
  });
});
