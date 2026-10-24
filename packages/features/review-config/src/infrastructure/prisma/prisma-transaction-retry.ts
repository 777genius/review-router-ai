import type { Prisma, PrismaClient } from "@prisma/client";

/** Attempts of one review-config write before a conflict is reported. */
export const MAX_TRANSACTION_ATTEMPTS = 3;

/** A unique-key race the write lost; the caller rereads or reports a conflict. */
export function isPrismaReviewConfigurationWriteConflict(
  error: unknown,
): boolean {
  return hasPrismaErrorCode(error, "P2002");
}

/**
 * Serialization failures and deadlock victims, including those of raw locking
 * queries, which Prisma reports as P2010 with the PostgreSQL state.
 */
export function isPrismaReviewConfigurationSerializationConflict(
  error: unknown,
): boolean {
  if (hasPrismaErrorCode(error, "P2034")) return true;
  if (!hasPrismaErrorCode(error, "P2010")) return false;
  const candidate = error as {
    readonly message?: unknown;
    readonly meta?: { readonly code?: unknown; readonly message?: unknown };
  };
  const details = [
    candidate.meta?.code,
    candidate.meta?.message,
    candidate.message,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
  return /(?:^|\D)(?:40001|40P01)(?:\D|$)/u.test(details);
}

/**
 * Runs one interactive transaction and retries it whole after a conflict,
 * after a short random pause so that the transactions that collided do not
 * collide again at once.
 */
export async function runReviewConfigurationTransaction<Result>(
  prisma: PrismaClient,
  run: (tx: Prisma.TransactionClient) => Promise<Result>,
  {
    attempts = MAX_TRANSACTION_ATTEMPTS,
    ...options
  }: Readonly<{
    isolationLevel?: Prisma.TransactionIsolationLevel;
    /** Defaults to MAX_TRANSACTION_ATTEMPTS. */
    attempts?: number;
  }> = {},
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(run, options);
    } catch (error) {
      if (
        !isPrismaReviewConfigurationSerializationConflict(error) ||
        attempt >= attempts
      )
        throw error;
    }
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * RETRY_PAUSE_MS * attempt),
    );
  }
}

/** Upper bound of the pause before the first retry; it grows per attempt. */
const RETRY_PAUSE_MS = 25;

function hasPrismaErrorCode(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === code
  );
}
