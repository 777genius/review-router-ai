import type { Prisma, PrismaClient } from "@prisma/client";
import {
  assertRateLimit,
  PrismaRateLimitStore,
  RateLimitExceededError,
  type RateLimitRule,
} from "@reviewrouter/features-rate-limits";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode,
} from "@reviewrouter/features-review-skills";
import type {
  ReviewSkillsCatalogActor,
  ReviewSkillsCatalogAdmissionPort,
  ReviewSkillsCatalogOperation,
  ReviewSkillScanProfile,
} from "@reviewrouter/features-review-skills";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const requestLimits: Record<
  ReviewSkillsCatalogOperation,
  Readonly<{ user: number; workspace: number; global: number }>
> = {
  search: { user: 30, workspace: 120, global: 1000 },
  resolve: { user: 6, workspace: 20, global: 100 },
  scan: { user: 30, workspace: 90, global: 1000 },
  read: { user: 120, workspace: 600, global: 6000 },
  import: { user: 30, workspace: 100, global: 1000 },
};

function rules(
  input: ReviewSkillsCatalogActor,
  prefix: string,
  limits: Readonly<{ user: number; workspace: number; global: number }>,
  windowMs: number,
  amount = 1,
): RateLimitRule[] {
  return [
    {
      key: `skill-catalog:${prefix}:user:${input.actor.userId}`,
      limit: limits.user,
      windowMs,
      amount,
    },
    {
      key: `skill-catalog:${prefix}:workspace:${input.workspaceId}`,
      limit: limits.workspace,
      windowMs,
      amount,
    },
    {
      key: `skill-catalog:${prefix}:global`,
      limit: limits.global,
      windowMs,
      amount,
    },
  ];
}

async function consume(
  tx: Prisma.TransactionClient,
  quotaRules: readonly RateLimitRule[],
  now: Date,
) {
  try {
    const rateLimits = new PrismaRateLimitStore(tx);
    for (const rule of [...quotaRules].sort((a, b) =>
      a.key.localeCompare(b.key, "en"),
    )) {
      await assertRateLimit(rule, { rateLimits, clock: { now: () => now } });
    }
  } catch (error) {
    if (error instanceof RateLimitExceededError) throw error;
    throw new ReviewSkillsError(ReviewSkillsErrorCode.Unavailable);
  }
}

/** Request attempts and physical-job admission share the same reusable PG limiter. */
export function createSkillCatalogAdmission(
  prisma: PrismaClient,
): ReviewSkillsCatalogAdmissionPort {
  return {
    async assertAllowed(input) {
      await prisma.$transaction(async (tx) => {
        const time = await tx.$queryRaw<
          readonly { now: Date }[]
        >`SELECT clock_timestamp() AT TIME ZONE 'UTC' AS "now"`;
        await consume(
          tx,
          rules(
            input,
            `request:${input.operation}`,
            requestLimits[input.operation],
            minute,
          ),
          time[0]!.now,
        );
      });
    },
  };
}

/** Invoked only for a new physical job, in the job/outbox transaction. */
export function admitSkillCatalogJob(
  tx: Prisma.TransactionClient,
  input: ReviewSkillsCatalogActor &
    Readonly<{ profile: ReviewSkillScanProfile; now: Date }>,
): Promise<void> {
  const ai = input.profile.mode === "ai";
  const quotaRules = rules(
    input,
    `jobs:${input.profile.mode}`,
    ai
      ? { user: 3, workspace: 10, global: 100 }
      : { user: 10, workspace: 30, global: 200 },
    ai ? day : hour,
  );
  if (ai)
    quotaRules.push(
      ...rules(
        input,
        "model-call-units",
        { user: 12, workspace: 40, global: 400 },
        day,
        input.profile.maxCalls,
      ),
    );
  return consume(tx, quotaRules, input.now);
}
