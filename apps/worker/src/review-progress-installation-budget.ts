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
    input.now,
  );
  const stillClaimed = await transaction.reviewProgressPublicationV1.count({
    where: {
      ...claimedPublicationFence(input.publication),
      claimUntil: { gt: lockedAt },
    },
  });
  if (stillClaimed !== 1)
    return { allowed: false as const, retryAt: lockedAt };
  const availableAt = maxDate(budget.nextMutationAt, budget.cooldownUntil);
  if (availableAt > lockedAt)
    return { allowed: false as const, retryAt: availableAt };
  await transaction.reviewProgressInstallationBudgetV1.update({
    where: {
      githubInstallationId: input.publication.repository.githubInstallationId,
    },
    data: {
      nextMutationAt: new Date(lockedAt.getTime() + input.minimumIntervalMs),
      updatedAt: lockedAt,
    },
  });
  return { allowed: true as const };
}

/** Acquire the installation row lock before inspecting its budget. */
async function lockInstallationBudget(
  transaction: Prisma.TransactionClient,
  installationId: bigint,
  now: Date,
) {
  await transaction.$executeRaw(Prisma.sql`
  INSERT INTO "ReviewProgressInstallationBudgetV1"
    ("githubInstallationId", "nextMutationAt", "updatedAt")
  VALUES (${installationId}, ${now}, ${now})
  ON CONFLICT DO NOTHING
`);
  await transaction.$queryRaw(Prisma.sql`
  SELECT 1 FROM "ReviewProgressInstallationBudgetV1"
  WHERE "githubInstallationId" = ${installationId}
  FOR UPDATE
`);
  // clock_timestamp() advances while waiting for the row lock; now() would
  // return the transaction-start time and could expire this reservation early.
  const rows = await transaction.$queryRaw<Array<{ lockedAt: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "lockedAt"`,
  );
  const lockedAt = rows[0]?.lockedAt;
  if (!(lockedAt instanceof Date) || Number.isNaN(lockedAt.getTime())) {
    throw new Error("review_progress_installation_clock_invalid");
  }
  const budget =
    await transaction.reviewProgressInstallationBudgetV1.findUniqueOrThrow({
      where: { githubInstallationId: installationId },
    });
  return { budget, lockedAt };
}

function maxDate(first: Date, second: Date | null): Date {
  return second && second > first ? second : first;
}
