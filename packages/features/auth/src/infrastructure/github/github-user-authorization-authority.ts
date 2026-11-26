import type { Prisma, PrismaClient } from "@prisma/client";

export type GitHubUserAuthorizationAuthority = {
  readonly appSlug: string;
  readonly revision: number;
};

export type GitHubUserAuthorizationEnvironment = {
  readonly [key: string]: string | undefined;
};

export function resolveGitHubUserAuthorizationAppSlug(
  env: GitHubUserAuthorizationEnvironment = process.env,
): string {
  return (
    env.GITHUB_APP_SLUG?.trim() ||
    env.GITHUB_APP_CLIENT_ID?.trim() ||
    "github-app"
  );
}

/** Capture before external permission IO; a later write must use this revision. */
export async function readGitHubUserAuthorizationAuthority(input: {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly env?: GitHubUserAuthorizationEnvironment;
}): Promise<GitHubUserAuthorizationAuthority | null> {
  const appSlug = resolveGitHubUserAuthorizationAppSlug(input.env);
  const authorization = await input.prisma.gitHubUserAuthorization.findUnique({
    where: { userId_appSlug: { userId: input.userId, appSlug } },
    select: { revision: true, revokedAt: true, refreshAttemptId: true },
  });
  return authorization &&
    !authorization.revokedAt &&
    !authorization.refreshAttemptId
    ? { appSlug, revision: authorization.revision }
    : null;
}

/** Only local cache IO belongs in this short transaction, never an HTTP call. */
export async function withGitHubUserAuthorizationAuthority<T>(input: {
  readonly prisma: PrismaClient;
  readonly userId: string;
  readonly appSlug: string;
  readonly expectedRevision?: number;
  readonly readOnly?: boolean;
  readonly run: (
    tx: Prisma.TransactionClient,
    authority: GitHubUserAuthorizationAuthority,
  ) => Promise<T>;
}): Promise<T | null> {
  return input.prisma.$transaction(
    async (tx) => {
      // Snapshot reads work with the dashboard's SELECT-only role. Publication
      // instead holds FOR SHARE against every revocation/reauthorization writer.
      const revision = input.readOnly
        ? (
            await tx.gitHubUserAuthorization.findFirst({
              where: {
                userId: input.userId,
                appSlug: input.appSlug,
                revokedAt: null,
                refreshAttemptId: null,
              },
              select: { revision: true },
            })
          )?.revision
        : (
            await tx.$queryRaw<readonly { revision: number }[]>`
          SELECT "revision" FROM "GitHubUserAuthorization"
          WHERE "userId" = ${input.userId} AND "appSlug" = ${input.appSlug}
            AND "revokedAt" IS NULL AND "refreshAttemptId" IS NULL
          FOR SHARE
        `
          )[0]?.revision;
      if (
        revision === undefined ||
        (input.expectedRevision !== undefined &&
          revision !== input.expectedRevision)
      )
        return null;
      return input.run(tx, { appSlug: input.appSlug, revision });
    },
    input.readOnly ? { isolationLevel: "RepeatableRead" } : undefined,
  );
}
