/** Attempts of one progress database step before its conflict reaches the phase. */
export const progressTransactionAttempts = 3;

/** Upper bound of the pause before the first retry; it grows per attempt. */
const retryPauseMs = 25;

/**
 * Re-run one database-only progress step after a serialization failure or a
 * deadlock. The step must be a whole transaction or a single statement, so a
 * failed attempt left nothing behind. Never wrap a GitHub request in it.
 */
export async function retryOnSerializationConflict<Result>(
  run: () => Promise<Result>,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (
        !isSerializationConflict(error) ||
        attempt >= progressTransactionAttempts
      )
        throw error;
    }
    // A random pause keeps the transactions that collided from colliding again.
    await new Promise((resolve) =>
      setTimeout(resolve, Math.random() * retryPauseMs * attempt),
    );
  }
}

/** PostgreSQL 40001/40P01, as Prisma reports them for ORM and raw queries. */
export function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error))
    return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  if (typeof meta !== "object" || meta === null) return false;

  // Prisma adapter-pg may wrap a PostgreSQL SQLSTATE as a raw-query P2010.
  const adapter = "driverAdapterError" in meta ? meta.driverAdapterError : null;
  const cause =
    typeof adapter === "object" && adapter !== null && "cause" in adapter
      ? adapter.cause
      : null;
  const directCode = "code" in meta ? meta.code : undefined;
  const adapterCode =
    typeof cause === "object" && cause !== null && "originalCode" in cause
      ? cause.originalCode
      : undefined;
  return (
    directCode === "40001" ||
    directCode === "40P01" ||
    adapterCode === "40001" ||
    adapterCode === "40P01"
  );
}
