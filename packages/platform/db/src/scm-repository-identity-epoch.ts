import { Prisma } from "@prisma/client";

/**
 * Rotate the durable identity epoch while proving that the identity is still
 * bound to the repository connection that supplied the previous identity.
 */
export async function rotateScmRepositoryIdentityEpoch(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    scmRepositoryIdentityId: string;
    repositoryConnectionId: string;
    currentWorkspaceId: string;
    boundAt: Date;
  }>,
): Promise<void> {
  const rotated = await transaction.$queryRaw<readonly { version: number }[]>(
    Prisma.sql`
      UPDATE "ScmRepositoryIdentity"
      SET "version" = "version" + 1,
          "currentWorkspaceId" = ${input.currentWorkspaceId},
          "boundAt" = GREATEST(
            COALESCE("boundAt", '-infinity'::timestamptz),
            ${input.boundAt}::timestamptz,
            transaction_timestamp()
          ) + interval '1 millisecond',
          "unboundAt" = NULL
      WHERE "scmRepositoryIdentityId" = ${input.scmRepositoryIdentityId}
        AND "currentRepositoryConnectionId" = ${input.repositoryConnectionId}
      RETURNING "version"
    `,
  );
  if (rotated.length !== 1) {
    throw new Error("repository_identity_epoch_rotation_failed");
  }
}

/** Rotate a still-bound identity when repository admission is withdrawn. */
export async function rotateRemovedScmRepositoryIdentityEpoch(
  transaction: Prisma.TransactionClient,
  input: Readonly<{
    scmRepositoryIdentityId: string;
    repositoryConnectionId: string;
    currentWorkspaceId: string;
    removedAt: Date;
  }>,
): Promise<void> {
  const rotated = await transaction.$queryRaw<readonly { version: number }[]>(
    Prisma.sql`
      UPDATE "ScmRepositoryIdentity"
      SET "version" = "version" + 1,
          "boundAt" = GREATEST(
            COALESCE("boundAt", '-infinity'::timestamptz),
            ${input.removedAt}::timestamptz,
            transaction_timestamp()
          ) + interval '1 millisecond'
      WHERE "scmRepositoryIdentityId" = ${input.scmRepositoryIdentityId}
        AND "currentRepositoryConnectionId" = ${input.repositoryConnectionId}
        AND "currentWorkspaceId" = ${input.currentWorkspaceId}
        AND "unboundAt" IS NULL
      RETURNING "version"
    `,
  );
  if (rotated.length !== 1) {
    throw new Error("repository_identity_epoch_removal_rotation_failed");
  }
}
