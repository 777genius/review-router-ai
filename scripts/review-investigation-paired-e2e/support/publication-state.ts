import type { PrismaClient } from "../../../packages/platform/db/src/index.js";
import { ReviewCompletionSafeReason } from "../../../packages/features/review-processes/src/domain/review-completion-process.js";

type StateReader = Pick<
  PrismaClient,
  | "reviewExecutionV2"
  | "reviewPublicationAttemptV2"
  | "reviewCompletionProcess"
  | "reviewPublicationClaimTermV2"
  | "reviewPublicationOperationV2"
>;

const completionReasons = Object.values(ReviewCompletionSafeReason);
const operationErrors = [
  "publication_begin_stale_claim",
  "publication_claim_owned_elsewhere",
  "publication_executor_unexpected_failure",
] as const;

/** Bounded metadata only; failed diagnostics never expose database errors. */
export async function readPublicationState(
  prisma: Pick<PrismaClient, "$transaction">,
  authorizationId: string,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const query = Promise.resolve()
    .then(() =>
      prisma.$transaction(
        (transaction) => readBoundedState(transaction, authorizationId),
        { maxWait: 500, timeout: 1_000 },
      ),
    )
    .catch(() => ({ unavailable: "query_failed" as const }));
  try {
    return await Promise.race([
      query,
      new Promise<{ unavailable: "deadline" }>((resolve) => {
        timer = setTimeout(() => resolve({ unavailable: "deadline" }), 2_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedState(prisma: StateReader, authorizationId: string) {
  const executions = await prisma.reviewExecutionV2.findMany({
    where: { authorizationId },
    select: { executionId: true, state: true },
    orderBy: { executionId: "asc" },
    take: 2,
  });
  const attempts = await prisma.reviewPublicationAttemptV2.findMany({
    where: { authorizationId },
    select: {
      publicationAttemptId: true,
      executionId: true,
      state: true,
      terminalOutcome: true,
      publicationNotAfter: true,
    },
    orderBy: { createdAt: "desc" },
    take: 4,
  });
  const executionIds = executions.map((execution) => execution.executionId);
  const publicationAttemptIds = attempts.map(
    (attempt) => attempt.publicationAttemptId,
  );
  const [completions, claims, operations] = await Promise.all([
    prisma.reviewCompletionProcess.findMany({
      where: { executionId: { in: executionIds } },
      select: {
        executionId: true,
        state: true,
        attemptCount: true,
        lastSafeReason: true,
        nextActionAt: true,
        claimUntil: true,
      },
      orderBy: { executionId: "asc" },
      take: 2,
    }),
    prisma.reviewPublicationClaimTermV2.findMany({
      where: { publicationAttemptId: { in: publicationAttemptIds } },
      select: {
        publicationAttemptId: true,
        state: true,
        acquiredAt: true,
        renewedAt: true,
        expiresAt: true,
      },
      orderBy: { acquiredAt: "desc" },
      take: 8,
    }),
    prisma.reviewPublicationOperationV2.findMany({
      where: { publicationAttemptId: { in: publicationAttemptIds } },
      select: {
        publicationAttemptId: true,
        publicationKind: true,
        chunkIndex: true,
        state: true,
        retryCount: true,
        lastErrorCode: true,
        nextEligibleAt: true,
      },
      orderBy: { publicationOperationId: "asc" },
      take: 32,
    }),
  ]);
  return {
    executions,
    attempts,
    completions: completions.map((completion) => ({
      ...completion,
      lastSafeReason: safeCode(completion.lastSafeReason, completionReasons),
    })),
    claims,
    operations: operations.map((operation) => ({
      ...operation,
      lastErrorCode: safeCode(operation.lastErrorCode, operationErrors),
    })),
  };
}

function safeCode<Value extends string>(
  value: string | null,
  allowed: readonly Value[],
): Value | "other" | null {
  if (value === null) return null;
  return allowed.find((candidate) => candidate === value) ?? "other";
}
