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
  const budget = await lockInstallationBudget(
    transaction,
    input.publication.repository.githubInstallationId,
    input.now,
  );
  const stillClaimed = await transaction.reviewProgressPublicationV1.count({
    where: {
      ...claimedPublicationFence(input.publication),
      claimUntil: { gt: input.now },
    },
  });
  if (stillClaimed !== 1)
    return { allowed: false as const, retryAt: input.now };
  const availableAt = maxDate(budget.nextMutationAt, budget.cooldownUntil);
  if (availableAt > input.now)
    return { allowed: false as const, retryAt: availableAt };
  await transaction.reviewProgressInstallationBudgetV1.update({
    where: {
      githubInstallationId: input.publication.repository.githubInstallationId,
    },
    data: {
      nextMutationAt: new Date(input.now.getTime() + input.minimumIntervalMs),
      updatedAt: input.now,
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
  return transaction.reviewProgressInstallationBudgetV1.findUniqueOrThrow({
    where: { githubInstallationId: installationId },
  });
}

function maxDate(first: Date, second: Date | null): Date {
  return second && second > first ? second : first;
}
