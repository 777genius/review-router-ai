import { Prisma } from "@prisma/client";
import { claimedPublicationFence } from "./review-progress-claim-eligibility-policy";
import type { PrismaReviewProgressPublicationStore } from "./review-progress-store";

/** Persist a GitHub installation cooldown monotonically in the retry transaction. */
export async function persistInstallationCooldown(
  transaction: Prisma.TransactionClient,
  installationId: bigint,
  cooldownUntil: Date,
  now: Date,
): Promise<void> {
  await transaction.$executeRaw(Prisma.sql`
    INSERT INTO "ReviewProgressInstallationBudgetV1"
      ("githubInstallationId", "nextMutationAt", "cooldownUntil", "updatedAt")
    VALUES (
      ${installationId},
      ${cooldownUntil},
      ${cooldownUntil},
      ${now}
    )
    ON CONFLICT ("githubInstallationId") DO UPDATE SET
      "nextMutationAt" = GREATEST(
        "ReviewProgressInstallationBudgetV1"."nextMutationAt",
        EXCLUDED."nextMutationAt"
      ),
      "cooldownUntil" = GREATEST(
        "ReviewProgressInstallationBudgetV1"."cooldownUntil",
        EXCLUDED."cooldownUntil"
      ),
      "updatedAt" = EXCLUDED."updatedAt"
  `);
}

/** Reserve the installation budget inside the same serializable transaction. */
export async function reserveInstallationBudgetMutation(
  transaction: Prisma.TransactionClient,
  input: Parameters<
    PrismaReviewProgressPublicationStore["reserveInstallationMutation"]
  >[0],
): Promise<{ allowed: true } | { allowed: false; retryAt: Date }> {
  const { budget, lockedAt } = await lockInstallationBudget(
    transaction,
    input.publication.repository.githubInstallationId,
  );
  const stillClaimed = await transaction.reviewProgressPublicationV1.count({
    where: {
      ...claimedPublicationFence(input.publication),
      claimUntil: { gt: lockedAt },
    },
  });
  if (stillClaimed !== 1) return { allowed: false as const, retryAt: lockedAt };
  const availableAt = await takeInstallationMutation(transaction, {
    installationId: input.publication.repository.githubInstallationId,
    budget,
    lockedAt,
    minimumIntervalMs: input.minimumIntervalMs,
  });
  return availableAt === null
    ? { allowed: true as const }
    : { allowed: false as const, retryAt: availableAt };
}

/**
 * Takes one mutation from a locked installation budget, or returns when the
 * budget (interval or rate-limit cooldown) allows the next one.
 */
async function takeInstallationMutation(
  transaction: Prisma.TransactionClient,
  input: {
    readonly installationId: bigint;
    readonly budget: { nextMutationAt: Date; cooldownUntil: Date | null };
    readonly lockedAt: Date;
    readonly minimumIntervalMs: number;
  },
): Promise<Date | null> {
  const availableAt = maxDate(
    input.budget.nextMutationAt,
    input.budget.cooldownUntil,
  );
  if (availableAt > input.lockedAt) return availableAt;
  await transaction.reviewProgressInstallationBudgetV1.update({
    where: { githubInstallationId: input.installationId },
    data: {
      nextMutationAt: new Date(
        input.lockedAt.getTime() + input.minimumIntervalMs,
      ),
      updatedAt: input.lockedAt,
    },
  });
  return null;
}

/**
 * Plan 88: a start notice shares the pull request's progress comment and the
 * installation's write budget with live progress. It may write only while no
 * progress publication of the pull request is claimed or waiting to publish,
 * and then takes one installation mutation like the publisher does.
 */
export async function reserveProgressCommentNotice(
  transaction: Prisma.TransactionClient,
  input: {
    readonly scope: {
      readonly workspaceId: string;
      readonly repositoryConnectionId: string;
      readonly scmRepositoryIdentityId: string;
      readonly pullRequestNumber: number;
    };
    readonly installationId: bigint;
    readonly minimumIntervalMs: number;
  },
): Promise<
  | { readonly allowed: true; readonly commentId: bigint | null }
  | { readonly allowed: false }
> {
  const { budget, lockedAt } = await lockInstallationBudget(
    transaction,
    input.installationId,
  );
  const publication = await transaction.reviewProgressPublicationV1.findUnique({
    where: {
      workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
        input.scope,
    },
    select: {
      claimUntil: true,
      desiredVersion: true,
      publishedVersion: true,
      commentId: true,
    },
  });
  if (
    publication !== null &&
    ((publication.claimUntil !== null && publication.claimUntil > lockedAt) ||
      publication.desiredVersion > publication.publishedVersion)
  ) {
    return { allowed: false };
  }
  const availableAt = await takeInstallationMutation(transaction, {
    installationId: input.installationId,
    budget,
    lockedAt,
    minimumIntervalMs: input.minimumIntervalMs,
  });
  return availableAt === null
    ? { allowed: true, commentId: publication?.commentId ?? null }
    : { allowed: false };
}

/** Acquire the installation row lock before inspecting its budget. */
async function lockInstallationBudget(
  transaction: Prisma.TransactionClient,
  installationId: bigint,
) {
  // A new budget starts on the database clock, as every later check does; a
  // worker clock ahead of it would read as a cooldown that nothing set.
  await transaction.$executeRaw(Prisma.sql`
  INSERT INTO "ReviewProgressInstallationBudgetV1"
    ("githubInstallationId", "nextMutationAt", "updatedAt")
  VALUES (
    ${installationId},
    clock_timestamp() AT TIME ZONE 'UTC',
    clock_timestamp() AT TIME ZONE 'UTC'
  )
  ON CONFLICT DO NOTHING
`);
  await transaction.$queryRaw(Prisma.sql`
  SELECT 1 FROM "ReviewProgressInstallationBudgetV1"
  WHERE "githubInstallationId" = ${installationId}
  FOR UPDATE
`);
  // clock_timestamp() advances while waiting for the row lock; now() would
  // return the transaction-start time and could expire this reservation early.
  const clockQuery = Prisma.sql`SELECT clock_timestamp() AS "lockedAt"`;
  const rows: { lockedAt: Date }[] = await transaction.$queryRaw(clockQuery);
  const lockedAt = rows[0]?.lockedAt;
  if (!(lockedAt instanceof Date) || Number.isNaN(lockedAt.getTime())) {
    throw new Error("review_progress_installation_clock_invalid");
  }
  const budgetClient = transaction.reviewProgressInstallationBudgetV1;
  const budget = await budgetClient.findUniqueOrThrow({
    where: { githubInstallationId: installationId },
  });
  return { budget, lockedAt };
}

function maxDate(first: Date, second: Date | null): Date {
  return second && second > first ? second : first;
}
