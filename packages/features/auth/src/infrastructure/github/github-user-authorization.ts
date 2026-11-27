import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  resolveGitHubUserAuthorizationAppSlug,
  type GitHubUserAuthorizationAuthority,
  type GitHubUserAuthorizationEnvironment,
} from "./github-user-authorization-authority";

export { resolveGitHubUserAuthorizationAppSlug } from "./github-user-authorization-authority";
import type { AuthenticatedPrincipal } from "../../domain/authenticated-principal";
import {
  decryptServerToken,
  encryptServerToken,
  getTokenEncryptionStatus,
} from "./token-crypto";

const tokenRefreshSkewMs = 5 * 60 * 1000;
const githubOAuthTokenUrl = "https://github.com/login/oauth/access_token";

export type GitHubUserAuthorizationSaveStatus =
  | "saved"
  | "missing_token"
  | "token_encryption_misconfigured";

export type GitHubUserAccessTokenResult =
  | {
      readonly status: "ready";
      readonly accessToken: string;
      readonly refreshed: boolean;
      readonly authority: GitHubUserAuthorizationAuthority;
    }
  | {
      readonly status:
        | "missing"
        | "revoked"
        | "expired"
        | "refresh_failed"
        | "token_decryption_failed"
        | "token_encryption_misconfigured";
      readonly errorCode?: string;
    };

export type GitHubOAuthAccountTokenInput = {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_at?: unknown;
  readonly expires_in?: unknown;
  readonly refresh_token_expires_at?: unknown;
  readonly refresh_token_expires_in?: unknown;
};

type FetchLike = typeof fetch;

export async function saveGitHubUserAuthorizationFromAccount(input: {
  readonly prisma: PrismaClient;
  readonly principal: AuthenticatedPrincipal;
  readonly account: GitHubOAuthAccountTokenInput;
  readonly env?: GitHubUserAuthorizationEnvironment;
  readonly now?: Date;
}): Promise<GitHubUserAuthorizationSaveStatus> {
  const env = input.env ?? process.env;
  if (!getTokenEncryptionStatus(env).configured) {
    return "token_encryption_misconfigured";
  }

  const accessToken = readString(input.account.access_token);
  if (!accessToken) return "missing_token";

  const now = input.now ?? new Date();
  const refreshToken = readString(input.account.refresh_token);
  const appSlug = resolveGitHubUserAuthorizationAppSlug(env);
  const githubUserId = input.principal.githubUserId;
  if (!githubUserId) {
    throw new Error("github_user_id_required");
  }

  await input.prisma.gitHubUserAuthorization.upsert({
    where: {
      userId_appSlug: {
        userId: input.principal.userId,
        appSlug,
      },
    },
    update: {
      githubUserId: BigInt(githubUserId),
      encryptedAccessToken: encryptServerToken(accessToken, env),
      encryptedRefreshToken: refreshToken
        ? encryptServerToken(refreshToken, env)
        : null,
      accessTokenExpiresAt: resolveAccessTokenExpiresAt({
        account: input.account,
        now,
      }),
      refreshTokenExpiresAt: resolveRefreshTokenExpiresAt({
        account: input.account,
        now,
      }),
      revokedAt: null,
      lastErrorCode: null,
      revision: { increment: 1 },
      refreshAttemptId: null,
    },
    create: {
      userId: input.principal.userId,
      githubUserId: BigInt(githubUserId),
      appSlug,
      encryptedAccessToken: encryptServerToken(accessToken, env),
      encryptedRefreshToken: refreshToken
        ? encryptServerToken(refreshToken, env)
        : null,
      accessTokenExpiresAt: resolveAccessTokenExpiresAt({
        account: input.account,
        now,
      }),
      refreshTokenExpiresAt: resolveRefreshTokenExpiresAt({
        account: input.account,
        now,
      }),
    },
  });

  return "saved";
}

type GitHubUserAccessTokenInput = {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly env?: GitHubUserAuthorizationEnvironment;
  readonly now?: Date;
  readonly fetch?: FetchLike;
};

export async function getValidGitHubUserAccessToken(
  input: GitHubUserAccessTokenInput,
): Promise<GitHubUserAccessTokenResult> {
  return readGitHubUserAccessToken(input, true);
}

async function readGitHubUserAccessToken(
  input: GitHubUserAccessTokenInput,
  allowRefresh: boolean,
): Promise<GitHubUserAccessTokenResult> {
  const env = input.env ?? process.env;
  if (!getTokenEncryptionStatus(env).configured) {
    return { status: "token_encryption_misconfigured" };
  }
  const appSlug = resolveGitHubUserAuthorizationAppSlug(env);
  const authorization = await input.prisma.gitHubUserAuthorization.findUnique({
    where: { userId_appSlug: { userId: input.userId, appSlug } },
  });
  if (!authorization) return { status: "missing" };
  if (authorization.revokedAt) {
    return {
      status: "revoked",
      ...(authorization.lastErrorCode
        ? { errorCode: authorization.lastErrorCode }
        : {}),
    };
  }
  if (authorization.refreshAttemptId) {
    // An unfinished durable claim may represent a process that died after
    // GitHub consumed its one-use token. Never replay it after a lease expires.
    return {
      status: "refresh_failed",
      errorCode:
        authorization.lastErrorCode ===
          "github_user_token_refresh_in_progress" &&
        Date.now() - authorization.updatedAt.getTime() < githubRefreshTimeoutMs
          ? "github_user_token_refresh_in_progress"
          : "github_user_token_refresh_reauthorization_required",
    };
  }
  const authority = { appSlug, revision: authorization.revision };
  const now = input.now ?? new Date();
  if (
    !authorization.accessTokenExpiresAt ||
    authorization.accessTokenExpiresAt.getTime() - now.getTime() >
      tokenRefreshSkewMs
  ) {
    try {
      return {
        status: "ready",
        accessToken: decryptServerToken(
          authorization.encryptedAccessToken,
          env,
        ),
        refreshed: false,
        authority,
      };
    } catch {
      await markGitHubUserAuthorizationError({
        ...input,
        authority,
        errorCode: "github_user_token_decryption_failed",
        revoke: false,
      });
      return {
        status: "token_decryption_failed",
        errorCode: "github_user_token_decryption_failed",
      };
    }
  }
  if (!allowRefresh)
    return {
      status: "refresh_failed",
      errorCode: "github_user_authorization_changed",
    };
  if (
    !authorization.encryptedRefreshToken ||
    (authorization.refreshTokenExpiresAt &&
      authorization.refreshTokenExpiresAt.getTime() <= now.getTime())
  ) {
    const errorCode = authorization.encryptedRefreshToken
      ? "github_user_refresh_token_expired"
      : "github_user_token_expired";
    const changed = await markGitHubUserAuthorizationError({
      ...input,
      authority,
      errorCode,
      revoke: true,
    });
    return changed
      ? { status: "expired", errorCode }
      : readGitHubUserAccessToken(input, false);
  }
  let refreshToken: string;
  try {
    refreshToken = decryptServerToken(authorization.encryptedRefreshToken, env);
  } catch {
    await markGitHubUserAuthorizationError({
      ...input,
      authority,
      errorCode: "github_user_refresh_token_decryption_failed",
      revoke: false,
    });
    return {
      status: "token_decryption_failed",
      errorCode: "github_user_refresh_token_decryption_failed",
    };
  }
  const clientId = env.GITHUB_APP_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_APP_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    await markGitHubUserAuthorizationError({
      ...input,
      authority,
      errorCode: "github_oauth_client_misconfigured",
      revoke: false,
    });
    return {
      status: "refresh_failed",
      errorCode: "github_oauth_client_misconfigured",
    };
  }
  const refreshAttemptId = randomUUID();
  const claimed = await input.prisma.gitHubUserAuthorization.updateMany({
    where: {
      userId: input.userId,
      appSlug,
      revision: authority.revision,
      revokedAt: null,
      refreshAttemptId: null,
    },
    data: {
      refreshAttemptId,
      revision: { increment: 1 },
      lastErrorCode: "github_user_token_refresh_in_progress",
    },
  });
  if (claimed.count !== 1) return readGitHubUserAccessToken(input, false);
  const claimedAuthority = { appSlug, revision: authority.revision + 1 };
  const refreshed = await refreshGitHubUserAccessToken({
    refreshToken,
    clientId,
    clientSecret,
    now,
    fetch: input.fetch ?? fetch,
  });
  if (!refreshed.ok) {
    const changed = await markGitHubUserAuthorizationError({
      ...input,
      authority: claimedAuthority,
      refreshAttemptId,
      errorCode: refreshed.errorCode,
      revoke: refreshed.revoke,
      clearAttempt: refreshed.retryable,
    });
    if (!changed) return readGitHubUserAccessToken(input, false);
    return {
      status: refreshed.revoke ? "revoked" : "refresh_failed",
      errorCode: refreshed.errorCode,
    };
  }
  const saved = await input.prisma.gitHubUserAuthorization.updateMany({
    where: {
      userId: input.userId,
      appSlug,
      revision: claimedAuthority.revision,
      revokedAt: null,
      refreshAttemptId,
    },
    data: {
      encryptedAccessToken: encryptServerToken(refreshed.accessToken, env),
      // The previous refresh token has been consumed, even if the response
      // unexpectedly omits its replacement.
      encryptedRefreshToken: refreshed.refreshToken
        ? encryptServerToken(refreshed.refreshToken, env)
        : null,
      accessTokenExpiresAt: refreshed.accessTokenExpiresAt,
      refreshTokenExpiresAt: refreshed.refreshTokenExpiresAt,
      refreshAttemptId: null,
      revision: { increment: 1 },
      lastErrorCode: null,
    },
  });
  if (saved.count !== 1) return readGitHubUserAccessToken(input, false);
  return {
    status: "ready",
    accessToken: refreshed.accessToken,
    refreshed: true,
    authority: { appSlug, revision: claimedAuthority.revision + 1 },
  };
}

export async function revokeGitHubUserAuthorization(input: {
  readonly prisma: PrismaClient;
  readonly githubUserId: string | number | bigint;
  readonly errorCode?: string;
  readonly env?: GitHubUserAuthorizationEnvironment;
  /** Required for a refusal observed through a previously captured user token. */
  readonly authority?: GitHubUserAuthorizationAuthority;
}): Promise<boolean> {
  const appSlug =
    input.authority?.appSlug ??
    resolveGitHubUserAuthorizationAppSlug(input.env);
  const users = await input.prisma.user.findMany({
    where: { githubUserId: BigInt(input.githubUserId) },
    select: { id: true },
  });
  if (users.length === 0) return false;
  const userIds = users.map((user) => user.id);
  return input.prisma.$transaction(async (tx) => {
    const changed = await tx.gitHubUserAuthorization.updateMany({
      where: {
        appSlug,
        userId: { in: userIds },
        revokedAt: null,
        ...(input.authority
          ? { revision: input.authority.revision, refreshAttemptId: null }
          : {}),
      },
      data: {
        revokedAt: new Date(),
        revision: { increment: 1 },
        refreshAttemptId: null,
        lastErrorCode: input.errorCode ?? "github_app_authorization_revoked",
      },
    });
    if (changed.count > 0)
      await tx.repositoryPermissionCache.deleteMany({
        where: { userId: { in: userIds }, authorizationAppSlug: appSlug },
      });
    return changed.count > 0;
  });
}

const githubRefreshTimeoutMs = 10_000;

type RefreshResult =
  | {
      readonly ok: true;
      readonly accessToken: string;
      readonly refreshToken: string | null;
      readonly accessTokenExpiresAt: Date | null;
      readonly refreshTokenExpiresAt: Date | null;
    }
  | {
      readonly ok: false;
      readonly errorCode: string;
      readonly revoke: boolean;
      readonly retryable: boolean;
    };

async function refreshGitHubUserAccessToken(input: {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly now: Date;
  readonly fetch: FetchLike;
}): Promise<RefreshResult> {
  const controller = new AbortController();
  const unknown: RefreshResult = {
    ok: false,
    errorCode: "github_user_token_refresh_reauthorization_required",
    revoke: false,
    retryable: false,
  };
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async (): Promise<RefreshResult> => {
        const response = await input.fetch(githubOAuthTokenUrl, {
          method: "POST",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: input.clientId,
            client_secret: input.clientSecret,
            grant_type: "refresh_token",
            refresh_token: input.refreshToken,
          }),
        });
        const body: unknown = await response.json();
        if (!body || typeof body !== "object") return unknown;
        const payload = body as Record<string, unknown>;
        if (!response.ok || typeof payload.error === "string") {
          if (payload.error === "bad_refresh_token")
            return {
              ok: false,
              errorCode: "github_user_token_refresh_bad_refresh_token",
              revoke: true,
              retryable: false,
            };
          // Explicit OAuth rejection did not consume the token. Transport errors,
          // 5xx and malformed responses never establish that fact.
          if (
            payload.error === "incorrect_client_credentials" ||
            payload.error === "unsupported_grant_type"
          ) {
            return {
              ok: false,
              errorCode: `github_user_token_refresh_${payload.error}`,
              revoke: false,
              retryable: true,
            };
          }
          return unknown;
        }
        const accessToken = readString(payload.access_token);
        if (!accessToken) return unknown;
        return {
          ok: true,
          accessToken,
          refreshToken: readString(payload.refresh_token),
          accessTokenExpiresAt: secondsFromNow(payload.expires_in, input.now),
          refreshTokenExpiresAt: secondsFromNow(
            payload.refresh_token_expires_in,
            input.now,
          ),
        };
      })().catch(() => unknown),
      new Promise<RefreshResult>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          resolve(unknown);
        }, githubRefreshTimeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function markGitHubUserAuthorizationError(input: {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly authority: GitHubUserAuthorizationAuthority;
  readonly errorCode: string;
  readonly revoke: boolean;
  readonly refreshAttemptId?: string;
  readonly clearAttempt?: boolean;
}): Promise<boolean> {
  return input.prisma.$transaction(async (tx) => {
    const changed = await tx.gitHubUserAuthorization.updateMany({
      where: {
        userId: input.userId,
        appSlug: input.authority.appSlug,
        revision: input.authority.revision,
        revokedAt: null,
        refreshAttemptId: input.refreshAttemptId ?? null,
      },
      data: {
        lastErrorCode: input.errorCode,
        ...(input.clearAttempt ? { refreshAttemptId: null } : {}),
        ...(input.revoke
          ? {
              revokedAt: new Date(),
              revision: { increment: 1 },
              refreshAttemptId: null,
            }
          : {}),
      },
    });
    if (changed.count === 1 && input.revoke) {
      await tx.repositoryPermissionCache.deleteMany({
        where: {
          userId: input.userId,
          authorizationAppSlug: input.authority.appSlug,
        },
      });
    }
    return changed.count === 1;
  });
}

function resolveAccessTokenExpiresAt(input: {
  readonly account: GitHubOAuthAccountTokenInput;
  readonly now: Date;
}): Date | null {
  const epochSeconds = readNumber(input.account.expires_at);
  if (epochSeconds !== null) return new Date(epochSeconds * 1000);

  return secondsFromNow(input.account.expires_in, input.now);
}

function resolveRefreshTokenExpiresAt(input: {
  readonly account: GitHubOAuthAccountTokenInput;
  readonly now: Date;
}): Date | null {
  const epochSeconds = readNumber(input.account.refresh_token_expires_at);
  if (epochSeconds !== null) return new Date(epochSeconds * 1000);

  return secondsFromNow(input.account.refresh_token_expires_in, input.now);
}

function secondsFromNow(value: unknown, now: Date): Date | null {
  const seconds = readNumber(value);
  if (seconds === null) return null;
  return new Date(now.getTime() + seconds * 1000);
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}
