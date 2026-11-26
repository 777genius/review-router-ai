import type { GitHubUserAuthorization, PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getValidGitHubUserAccessToken,
  revokeGitHubUserAuthorization,
  saveGitHubUserAuthorizationFromAccount,
} from "./github-user-authorization";
import { decryptServerToken, encryptServerToken } from "./token-crypto";

const env = {
  GITHUB_APP_CLIENT_ID: "Iv23liTestClient",
  GITHUB_APP_CLIENT_SECRET: "github-app-client-secret",
  GITHUB_APP_SLUG: "reviewrouter-test",
  REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY:
    "test-token-encryption-secret-0123456789abcdef",
};
const now = new Date("2026-05-12T10:00:00Z");
const principal = {
  provider: "github",
  userId: "user_1",
  externalUserId: "123",
  login: "maintainer",
  githubUserId: "123",
  githubLogin: "maintainer",
  primaryEmail: null,
  avatarUrl: null,
} as const;
const refreshedResponse = () =>
  new Response(
    JSON.stringify({
      access_token: "ghu_new",
      refresh_token: "ghr_new",
      expires_in: 28_800,
      refresh_token_expires_in: 15_897_600,
    }),
    { status: 200 },
  );

afterEach(() => vi.useRealTimers());

describe("GitHub user authorization", () => {
  it("reauthorizes with encrypted tokens and supersedes any earlier attempt", async () => {
    const { prisma, row } = fixture({
      revision: 3,
      refreshAttemptId: "lost-response",
    });
    await expect(
      saveGitHubUserAuthorizationFromAccount({
        prisma,
        env,
        now,
        principal,
        account: {
          access_token: "ghu_access",
          refresh_token: "ghr_refresh",
          expires_in: 3600,
        },
      }),
    ).resolves.toBe("saved");
    expect(row.revision).toBe(4);
    expect(row.refreshAttemptId).toBeNull();
    expect(row.encryptedAccessToken).not.toContain("ghu_access");
    expect(decryptServerToken(row.encryptedAccessToken, env)).toBe(
      "ghu_access",
    );
    expect(row.accessTokenExpiresAt).toEqual(new Date("2026-05-12T11:00:00Z"));
  });

  it("claims once and stores both rotated tokens with a new authority", async () => {
    const { prisma, row } = fixture();
    const result = await getValidGitHubUserAccessToken({
      prisma,
      env,
      now,
      userId: "user_1",
      fetch: vi.fn().mockResolvedValue(refreshedResponse()),
    });
    expect(result).toEqual({
      status: "ready",
      accessToken: "ghu_new",
      refreshed: true,
      authority: { appSlug: env.GITHUB_APP_SLUG, revision: 2 },
    });
    expect(row.refreshAttemptId).toBeNull();
    expect(decryptServerToken(row.encryptedRefreshToken!, env)).toBe("ghr_new");
  });

  it("does not send a second concurrent request with the same refresh token", async () => {
    const { prisma, row } = fixture();
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    const input = { prisma, env, now, userId: "user_1", fetch: fetchMock };
    const first = getValidGitHubUserAccessToken(input);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(row.refreshAttemptId).not.toBeNull();
    await expect(getValidGitHubUserAccessToken(input)).resolves.toMatchObject({
      status: "refresh_failed",
      errorCode: "github_user_token_refresh_in_progress",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    gate.resolve(refreshedResponse());
    await expect(first).resolves.toMatchObject({ status: "ready" });
    await expect(getValidGitHubUserAccessToken(input)).resolves.toMatchObject({
      status: "ready",
      refreshed: false,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("late success cannot undo a webhook revocation", async () => {
    const { prisma, row } = fixture();
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    const pending = getValidGitHubUserAccessToken({
      prisma,
      env,
      now,
      userId: "user_1",
      fetch: fetchMock,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await revokeGitHubUserAuthorization({ prisma, env, githubUserId: "123" });
    gate.resolve(refreshedResponse());
    await expect(pending).resolves.toMatchObject({ status: "revoked" });
    expect(row.revokedAt).toBeInstanceOf(Date);
    expect(decryptServerToken(row.encryptedAccessToken, env)).toBe("ghu_old");
  });

  it("late refresh rejection cannot revoke a reauthorized account", async () => {
    const { prisma, row } = fixture();
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    const pending = getValidGitHubUserAccessToken({
      prisma,
      env,
      now,
      userId: "user_1",
      fetch: fetchMock,
    });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    await saveGitHubUserAuthorizationFromAccount({
      prisma,
      env,
      now,
      principal,
      account: {
        access_token: "ghu_reauthorized",
        refresh_token: "ghr_reauthorized",
        expires_in: 3600,
      },
    });
    gate.resolve(
      new Response(JSON.stringify({ error: "bad_refresh_token" }), {
        status: 400,
      }),
    );
    await expect(pending).resolves.toMatchObject({
      status: "ready",
      accessToken: "ghu_reauthorized",
    });
    expect(row.revokedAt).toBeNull();
    expect(row.lastErrorCode).toBeNull();
  });

  it("never automatically replays an ambiguous or abandoned durable attempt", async () => {
    const { prisma, row } = fixture();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("response lost"));
    const input = { prisma, env, now, userId: "user_1", fetch: fetchMock };
    await expect(getValidGitHubUserAccessToken(input)).resolves.toMatchObject({
      status: "refresh_failed",
      errorCode: "github_user_token_refresh_reauthorization_required",
    });
    expect(row.refreshAttemptId).not.toBeNull();
    row.updatedAt = new Date(0);
    await expect(getValidGitHubUserAccessToken(input)).resolves.toMatchObject({
      status: "refresh_failed",
      errorCode: "github_user_token_refresh_reauthorization_required",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("bounds a nonsettling transport and ignores its late success", async () => {
    vi.useFakeTimers();
    const { prisma, row } = fixture();
    const gate = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(gate.promise);
    const pending = getValidGitHubUserAccessToken({
      prisma,
      env,
      now,
      userId: "user_1",
      fetch: fetchMock,
    });
    await vi.advanceTimersByTimeAsync(10_001);
    await expect(pending).resolves.toMatchObject({ status: "refresh_failed" });
    expect(fetchMock.mock.calls[0]?.[1].signal.aborted).toBe(true);
    gate.resolve(refreshedResponse());
    await vi.advanceTimersByTimeAsync(1);
    expect(row.refreshAttemptId).not.toBeNull();
    expect(decryptServerToken(row.encryptedAccessToken, env)).toBe("ghu_old");
  });

  it("keeps an explicit client-credential rejection retryable", async () => {
    const { prisma, row } = fixture();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: "incorrect_client_credentials" }),
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(refreshedResponse());
    const input = { prisma, env, now, userId: "user_1", fetch: fetchMock };
    await expect(getValidGitHubUserAccessToken(input)).resolves.toMatchObject({
      status: "refresh_failed",
    });
    expect(row.refreshAttemptId).toBeNull();
    expect(row.revokedAt).toBeNull();
    await expect(getValidGitHubUserAccessToken(input)).resolves.toMatchObject({
      status: "ready",
    });
  });

  it("revokes rejected or expired refresh credentials and clears only that app's cache", async () => {
    for (const expired of [false, true]) {
      const { prisma, row, deleteMany } = fixture(
        expired ? { refreshTokenExpiresAt: new Date(0) } : {},
      );
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "bad_refresh_token" }), {
          status: 400,
        }),
      );
      await expect(
        getValidGitHubUserAccessToken({
          prisma,
          env,
          now,
          userId: "user_1",
          fetch: fetchMock,
        }),
      ).resolves.toMatchObject({ status: expired ? "expired" : "revoked" });
      expect(row.revokedAt).toBeInstanceOf(Date);
      expect(deleteMany).toHaveBeenCalledWith({
        where: { userId: "user_1", authorizationAppSlug: env.GITHUB_APP_SLUG },
      });
      expect(fetchMock).toHaveBeenCalledTimes(expired ? 0 : 1);
    }
  });

  it("old-token refusals cannot revoke a claimed refresh or another app", async () => {
    const { prisma, row, deleteMany } = fixture({
      revision: 1,
      refreshAttemptId: "refreshing",
    });
    for (const authority of [
      { appSlug: env.GITHUB_APP_SLUG, revision: 0 },
      { appSlug: "another-app", revision: 1 },
    ]) {
      await expect(
        revokeGitHubUserAuthorization({
          prisma,
          env,
          githubUserId: "123",
          authority,
        }),
      ).resolves.toBe(false);
    }
    expect(row.revokedAt).toBeNull();
    expect(deleteMany).not.toHaveBeenCalled();
  });
});

type Update = Omit<Partial<GitHubUserAuthorization>, "revision"> & {
  revision?: number | { increment: number };
};
type Where = Partial<Omit<GitHubUserAuthorization, "userId">> & {
  userId?: string | { in: readonly string[] };
};
function fixture(overrides: Partial<GitHubUserAuthorization> = {}) {
  const row: GitHubUserAuthorization = {
    id: "auth_1",
    userId: "user_1",
    githubUserId: 123n,
    appSlug: env.GITHUB_APP_SLUG,
    encryptedAccessToken: encryptServerToken("ghu_old", env),
    encryptedRefreshToken: encryptServerToken("ghr_old", env),
    accessTokenExpiresAt: new Date("2026-05-12T10:01:00Z"),
    refreshTokenExpiresAt: new Date("2026-06-12T10:00:00Z"),
    revokedAt: null,
    lastErrorCode: null,
    revision: 0,
    refreshAttemptId: null,
    createdAt: now,
    updatedAt: new Date(),
    ...overrides,
  };
  const apply = (data: Update) => {
    const { revision, ...values } = data;
    Object.assign(row, values, { updatedAt: new Date() });
    if (typeof revision === "number") row.revision = revision;
    else if (revision) row.revision += revision.increment;
  };
  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const db = {
    user: { findMany: vi.fn().mockResolvedValue([{ id: "user_1" }]) },
    repositoryPermissionCache: { deleteMany },
    gitHubUserAuthorization: {
      findUnique: vi.fn().mockImplementation(() => Promise.resolve({ ...row })),
      upsert: vi.fn().mockImplementation(({ update }: { update: Update }) => {
        apply(update);
        return Promise.resolve({ ...row });
      }),
      updateMany: vi
        .fn()
        .mockImplementation(
          ({ where, data }: { where: Where; data: Update }) => {
            const matches = Object.entries(where).every(([key, expected]) => {
              if (
                key === "userId" &&
                typeof expected === "object" &&
                expected !== null &&
                "in" in expected
              ) {
                return (expected.in as readonly string[]).includes(row.userId);
              }
              return row[key as keyof GitHubUserAuthorization] === expected;
            });
            if (matches) apply(data);
            return Promise.resolve({ count: matches ? 1 : 0 });
          },
        ),
    },
  };
  const prisma = {
    ...db,
    $transaction: vi.fn(async (run: (tx: typeof db) => Promise<unknown>) =>
      run(db),
    ),
  } as unknown as PrismaClient;
  return { prisma, row, deleteMany };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
