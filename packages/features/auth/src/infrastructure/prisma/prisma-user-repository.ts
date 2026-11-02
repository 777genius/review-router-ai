import type { PrismaClient } from "@prisma/client";
import type { AuthenticatedPrincipal } from "../../domain/authenticated-principal";
import type { ExternalIdentity } from "../../domain/external-identity";
import type { GitHubExternalIdentity } from "../../domain/github-external-identity";
import { gitHubIdentityToExternalIdentity } from "../../domain/github-external-identity";
import type { UserRepositoryPort } from "../../application/ports/user-repository-port";

export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async upsertExternalIdentity(
    identity: ExternalIdentity,
  ): Promise<AuthenticatedPrincipal> {
    // Keep one immutable request across the lock wait and all persistence reads.
    const snapshot: ExternalIdentity = {
      provider: identity.provider,
      externalUserId:
        identity.provider === "github"
          ? BigInt(identity.externalUserId).toString()
          : identity.externalUserId,
      login: identity.login,
      primaryEmail: identity.primaryEmail ?? null,
      avatarUrl: identity.avatarUrl ?? null,
    };
    const key = {
      provider: snapshot.provider,
      externalUserId: snapshot.externalUserId,
    };
    const lockKey = `auth-external-identity-v1:${JSON.stringify([
      key.provider,
      key.externalUserId,
    ])}`;

    return this.prisma.$transaction(
      async (tx) => {
        // The identity may not exist yet. Serialize its creation, then reread
        // at ReadCommitted so a waiter observes the preceding owner's commit.
        await tx.$queryRaw`
          SELECT 1 AS "locked"
          FROM pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))
        `;
        const existingIdentity = await tx.userExternalIdentity.findUnique({
          where: { provider_externalUserId: key },
          select: { userId: true, user: { select: { githubUserId: true } } },
        });
        if (
          snapshot.provider === "github" &&
          existingIdentity?.user.githubUserId != null &&
          existingIdentity.user.githubUserId !== BigInt(snapshot.externalUserId)
        ) {
          throw new Error("external_identity_owner_conflict");
        }

        const user = existingIdentity
          ? await tx.user.update({
              where: { id: existingIdentity.userId },
              data: userSnapshotForIdentity(snapshot),
            })
          : snapshot.provider === "github"
            ? await tx.user.upsert({
                // Installation owner grants can create this User before login.
                // Their independent writer uses this same immutable unique key.
                where: { githubUserId: BigInt(snapshot.externalUserId) },
                update: userSnapshotForIdentity(snapshot),
                create: userSnapshotForIdentity(snapshot),
              })
            : await tx.user.create({ data: userSnapshotForIdentity(snapshot) });

        const metadata = {
          login: snapshot.login,
          primaryEmail: snapshot.primaryEmail ?? null,
          avatarUrl: snapshot.avatarUrl ?? null,
        };
        const persistedIdentity = await tx.userExternalIdentity.upsert({
          where: { provider_externalUserId: key },
          update: metadata,
          create: { ...key, ...metadata, userId: user.id },
          select: { user: true },
        });
        // An external identity can never adopt a different User through retry
        // or metadata refresh, including a conflicting noncooperating writer.
        if (persistedIdentity.user.id !== user.id) {
          throw new Error("external_identity_owner_conflict");
        }
        return principalFromIdentity(persistedIdentity.user, snapshot);
      },
      { isolationLevel: "ReadCommitted" },
    );
  }

  async upsertGitHubUser(
    identity: GitHubExternalIdentity,
  ): Promise<AuthenticatedPrincipal> {
    return this.upsertExternalIdentity(
      gitHubIdentityToExternalIdentity(identity),
    );
  }
}

function userSnapshotForIdentity(identity: ExternalIdentity) {
  if (identity.provider === "github") {
    return {
      githubUserId: BigInt(identity.externalUserId),
      githubLogin: identity.login,
      primaryEmail: identity.primaryEmail ?? null,
      avatarUrl: identity.avatarUrl ?? null,
    };
  }
  return {
    primaryEmail: identity.primaryEmail ?? null,
    avatarUrl: identity.avatarUrl ?? null,
  };
}

function principalFromIdentity(
  user: {
    readonly id: string;
    readonly githubUserId: bigint | null;
    readonly githubLogin: string | null;
    readonly primaryEmail: string | null;
    readonly avatarUrl: string | null;
  },
  identity: ExternalIdentity,
): AuthenticatedPrincipal {
  return {
    userId: user.id,
    provider: identity.provider,
    externalUserId: identity.externalUserId,
    login: identity.login,
    githubUserId: user.githubUserId?.toString() ?? null,
    githubLogin: user.githubLogin,
    primaryEmail: user.primaryEmail,
    avatarUrl: identity.avatarUrl ?? user.avatarUrl,
  };
}
