import {
  encryptServerToken,
  type GitHubUserAuthorizationTokenSnapshot,
} from "@reviewrouter/features-auth";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { describe, expect, it, vi } from "vitest";
import { PrismaGitHubAppAuthorizationWebhookHandler } from "./prisma-github-app-authorization-webhook-handler";

const env = {
  GITHUB_APP_SLUG: "reviewrouter-test",
  GITHUB_API_BASE_URL: "https://github.example.test/api/v3",
  REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY:
    "synthetic-auth-probe-encryption-key-1027",
};
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

function fixture(status = 401, body = JSON.stringify({ id: 123 })) {
  const snapshot: GitHubUserAuthorizationTokenSnapshot = {
    id: "authorization_1",
    userId: "user_1",
    appSlug: env.GITHUB_APP_SLUG,
    githubUserId: 123n,
    revision: 4,
    encryptedAccessToken: encryptServerToken("synthetic-current-token", env),
    accessTokenExpiresAt: new Date(Date.now() + 3_600_000),
    revokedAt: null,
    refreshAttemptId: null,
    eligible: true,
  };
  const revoke = vi
    .fn<
      (sql: {
        text: string;
        values: unknown[];
      }) => Promise<{ userId: string }[]>
    >()
    .mockResolvedValue([{ userId: "user_1" }]);
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const finish = vi.fn().mockResolvedValue({});
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn(async (sql: { text: string; values: unknown[] }) => {
      if (sql.text.includes('UPDATE "GitHubUserAuthorization"'))
        return revoke(sql);
      if (sql.text.includes("FOR UPDATE"))
        return [{ id: snapshot.id, deliveryId: envelope.deliveryId }];
      if (sql.text.includes("SELECT true AS current"))
        return [{ current: true }];
      return [{ valid: true }];
    }),
    repositoryPermissionCache: { deleteMany },
    gitHubWebhookDelivery: {
      findUnique: vi.fn().mockResolvedValue({
        eventName: envelope.eventName,
        action: envelope.payload.action,
        payloadHash: envelope.payloadHash,
      }),
      update: finish,
    },
  };
  const readSnapshot = vi.fn().mockResolvedValue([snapshot]);
  const transact = vi.fn(
    async (run: (tx: typeof transaction) => Promise<unknown>) =>
      run(transaction),
  );
  const prisma = {
    $queryRaw: readSnapshot,
    $transaction: transact,
  } as unknown as PrismaClient;
  const send = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(body, { status }));
  const handler = new PrismaGitHubAppAuthorizationWebhookHandler(
    prisma,
    env.GITHUB_APP_SLUG,
    { env, fetch: send },
  );
  return {
    prisma,
    snapshot,
    revoke,
    deleteMany,
    finish,
    transaction,
    readSnapshot,
    transact,
    send,
    handler,
  };
}

describe("PrismaGitHubAppAuthorizationWebhookHandler", () => {
  it.each([
    { appSlug: undefined, expected: "provided-environment-app" },
    { appSlug: "explicit-app", expected: "explicit-app" },
  ])("resolves the App slug as $expected", async ({ appSlug, expected }) => {
    vi.stubEnv("GITHUB_APP_SLUG", "ambient-process-app");
    try {
      const f = fixture();
      f.readSnapshot.mockResolvedValueOnce([
        { ...f.snapshot, appSlug: expected },
      ]);
      const handler = new PrismaGitHubAppAuthorizationWebhookHandler(
        f.prisma,
        appSlug,
        {
          env: { ...env, GITHUB_APP_SLUG: "provided-environment-app" },
          fetch: f.send,
        },
      );
      expect(
        await handler.handleGitHubAppAuthorizationWebhook(envelope),
      ).toMatchObject({
        processed: true,
        appSlug: expected,
      });
      expect(f.readSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({ values: expect.arrayContaining([expected]) }),
      );
      expect(f.deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1", authorizationAppSlug: expected },
      });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("revokes stored user authorization and clears repository access cache", async () => {
    const f = fixture();
    await expect(
      f.handler.handleGitHubAppAuthorizationWebhook(envelope),
    ).resolves.toEqual({
      processed: true,
      appSlug: "reviewrouter-test",
      githubUserId: "123",
      userCount: 1,
    });
    expect(f.revoke).toHaveBeenCalledOnce();
    expect(f.revoke.mock.calls[0]![0].values).toEqual(
      expect.arrayContaining([
        "authorization_1",
        "user_1",
        "reviewrouter-test",
        123n,
        4,
        f.snapshot.encryptedAccessToken,
        f.snapshot.accessTokenExpiresAt,
        300_000,
      ]),
    );
    expect(f.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user_1",
        authorizationAppSlug: "reviewrouter-test",
      },
    });
    expect(f.send).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledWith(
      "https://github.example.test/api/v3/user",
      expect.objectContaining({
        method: "GET",
        redirect: "error",
        signal: expect.any(AbortSignal),
        headers: expect.objectContaining({
          Authorization: "Bearer synthetic-current-token",
        }),
      }),
    );
    expect(f.send.mock.invocationCallOrder[0]).toBeLessThan(
      f.transact.mock.invocationCallOrder[0]!,
    );
  });

  it("binds the fenced revocation and delivery completion in one transaction", async () => {
    const f = fixture();
    await f.handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim);
    expect(f.transact).toHaveBeenCalledOnce();
    expect(f.revoke).toHaveBeenCalledOnce();
    expect(f.deleteMany).toHaveBeenCalledOnce();
    expect(f.finish).toHaveBeenCalledWith({
      where: { deliveryId: "delivery_1" },
      data: { status: "processed", processedAt: expect.any(Date) },
    });
    f.transaction.gitHubWebhookDelivery.findUnique.mockResolvedValueOnce({
      eventName: envelope.eventName,
      action: envelope.payload.action,
      payloadHash: "different",
    });
    await expect(
      f.handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim),
    ).rejects.toThrow("webhook_fence_identity_mismatch");
    expect(f.revoke).toHaveBeenCalledOnce();
    expect(f.deleteMany).toHaveBeenCalledOnce();
    expect(f.finish).toHaveBeenCalledOnce();
  });

  it("preserves a valid current token without writing a new permission cache", async () => {
    const f = fixture(200);
    await expect(
      f.handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim),
    ).resolves.toMatchObject({
      processed: false,
      ignored: true,
      reason: "authorization_still_valid",
    });
    expect(f.revoke).not.toHaveBeenCalled();
    expect(f.deleteMany).not.toHaveBeenCalled();
    expect(f.finish).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 403, body: "{}" },
    { status: 500, body: "{}" },
    { status: 200, body: "invalid-json" },
    { status: 200, body: JSON.stringify({ id: 124 }) },
  ])(
    "requires reconciliation for an ambiguous $status response",
    async ({ status, body }) => {
      const f = fixture(status, body);
      await expect(
        f.handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim),
      ).rejects.toThrow("github_app_authorization_reconciliation_required");
      expect(f.transact).not.toHaveBeenCalled();
      expect(f.revoke).not.toHaveBeenCalled();
      expect(f.deleteMany).not.toHaveBeenCalled();
      expect(f.finish).not.toHaveBeenCalled();
    },
  );

  it("does not probe or mutate an ineligible captured authorization", async () => {
    const f = fixture();
    f.readSnapshot.mockResolvedValueOnce([{ ...f.snapshot, eligible: false }]);
    await expect(
      f.handler.handleFencedGitHubAppAuthorizationWebhook(envelope, claim),
    ).rejects.toThrow("github_app_authorization_reconciliation_required");
    expect(f.send).not.toHaveBeenCalled();
    expect(f.transact).not.toHaveBeenCalled();
    expect(f.deleteMany).not.toHaveBeenCalled();
  });
});
