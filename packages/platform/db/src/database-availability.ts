import { Prisma } from "@prisma/client";

/** Qualified against Prisma 7 + adapter-pg; execution timeouts are not overload. */
export function isDatabaseAcquisitionTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return (
    error.message === "timeout exceeded when trying to connect" ||
    ("code" in error &&
      error.code === "P2028" &&
      error.message ===
        "Transaction API error: Unable to start a transaction in the given time.")
  );
}

/**
 * Availability for a safe response, never permission to retry a write. A lost
 * connection at commit has an unknown outcome until the owner reads its receipt.
 */
export function isDatabaseUnavailable(error: unknown): boolean {
  if (isDatabaseAcquisitionTimeout(error)) return true;
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  // Qualified with Prisma 7.9 + adapter-pg: raw SQL uses P2010, model queries
  // use P2039. Neither category is unavailable without the admitted SQLSTATE.
  if (error.code !== "P2010" && error.code !== "P2039") return false;
  const code = postgresSqlState(error.meta);
  return code === "57014" || code === "55P03" || code === "57P01";
}

function postgresSqlState(meta: Record<string, unknown> | undefined): unknown {
  // The pg adapter preserves both the original SQLSTATE and its postgres cause.
  const adapter = meta?.driverAdapterError;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter)) {
    return undefined;
  }
  const cause = adapter.cause;
  if (
    !cause ||
    typeof cause !== "object" ||
    !("kind" in cause) ||
    cause.kind !== "postgres" ||
    !("code" in cause) ||
    !("originalCode" in cause) ||
    cause.code !== cause.originalCode
  ) {
    return undefined;
  }
  return cause.code;
}
