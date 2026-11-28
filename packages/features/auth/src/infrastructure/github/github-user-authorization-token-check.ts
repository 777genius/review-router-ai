import { Prisma, type PrismaClient } from "@prisma/client";
import { githubUserAccessTokenRefreshSkewMs } from "./github-user-authorization";

export type GitHubUserAuthorizationTokenSnapshot = Readonly<{
  id: string;
  userId: string;
  appSlug: string;
  githubUserId: bigint;
  revision: number;
  encryptedAccessToken: string;
  accessTokenExpiresAt: Date | null;
  revokedAt: Date | null;
  refreshAttemptId: string | null;
  eligible: boolean;
}>;

/** One row snapshot before provider IO; Prisma's timezone-less timestamps contain UTC. */
export async function readGitHubUserAuthorizationTokenSnapshot(
  prisma: PrismaClient,
  githubUserId: bigint,
  appSlug: string,
): Promise<GitHubUserAuthorizationTokenSnapshot | null> {
  const rows = await prisma.$queryRaw<GitHubUserAuthorizationTokenSnapshot[]>(
    Prisma.sql`
      SELECT a.id, a."userId", a."appSlug", a."githubUserId", a.revision,
        a."encryptedAccessToken", a."accessTokenExpiresAt", a."revokedAt", a."refreshAttemptId",
        (a."githubUserId" = ${githubUserId} AND a."revokedAt" IS NULL
          AND a."refreshAttemptId" IS NULL AND a."accessTokenExpiresAt" IS NOT NULL
          AND a."accessTokenExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') +
            ${githubUserAccessTokenRefreshSkewMs} * interval '1 millisecond') AS eligible
      FROM "GitHubUserAuthorization" a JOIN "User" u ON u.id = a."userId"
      WHERE u."githubUserId" = ${githubUserId} AND a."appSlug" = ${appSlug}
    `,
  );
  return rows[0] ?? null;
}

/** The caller owns the transaction; an observed refusal belongs to this token only. */
export async function applyGitHubUserAuthorizationTokenCheckInTransaction(
  transaction: Prisma.TransactionClient,
  snapshot: GitHubUserAuthorizationTokenSnapshot,
  tokenStatus: "valid" | "invalid",
): Promise<boolean> {
  await transaction.$queryRaw(Prisma.sql`
    SELECT id FROM "GitHubUserAuthorization" WHERE id = ${snapshot.id} FOR UPDATE
  `);
  // Use a separate statement after the row lock: a lock wait must not retain
  // an earlier clock observation or accidentally target a reconnected grant.
  const current = Prisma.sql`
    a.id = ${snapshot.id} AND a."userId" = ${snapshot.userId}
    AND a."appSlug" = ${snapshot.appSlug} AND a."githubUserId" = ${snapshot.githubUserId}
    AND a.revision = ${snapshot.revision}
    AND a."encryptedAccessToken" = ${snapshot.encryptedAccessToken}
    AND a."accessTokenExpiresAt" IS NOT DISTINCT FROM ${snapshot.accessTokenExpiresAt}
    AND a."revokedAt" IS NULL AND a."refreshAttemptId" IS NULL
    AND a."accessTokenExpiresAt" IS NOT NULL
    AND a."accessTokenExpiresAt" > (clock_timestamp() AT TIME ZONE 'UTC') +
      ${githubUserAccessTokenRefreshSkewMs} * interval '1 millisecond'
  `;
  if (tokenStatus === "valid") {
    const rows = await transaction.$queryRaw<Array<{ current: boolean }>>(
      Prisma.sql`SELECT true AS current FROM "GitHubUserAuthorization" a WHERE ${current}`,
    );
    return rows.length === 1;
  }
  const changed = await transaction.$queryRaw<Array<{ userId: string }>>(
    Prisma.sql`
      UPDATE "GitHubUserAuthorization" a SET "revokedAt" = (clock_timestamp() AT TIME ZONE 'UTC'),
        revision = a.revision + 1, "refreshAttemptId" = NULL,
        "lastErrorCode" = 'github_app_authorization_revoked', "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
      WHERE ${current}
      RETURNING a."userId"
    `,
  );
  if (changed.length !== 1) return false;
  await transaction.repositoryPermissionCache.deleteMany({
    where: {
      userId: snapshot.userId,
      authorizationAppSlug: snapshot.appSlug,
    },
  });
  return true;
}
