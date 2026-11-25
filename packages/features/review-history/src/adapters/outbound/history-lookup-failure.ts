import { Prisma } from "@prisma/client";

function timedOutQuery(meta: Record<string, unknown> | undefined): boolean {
  if (meta?.code === "57014") return true;
  // Prisma7's pg adapter retains SQLSTATE in structured adapter cause metadata.
  const adapter = meta?.driverAdapterError;
  if (!adapter || typeof adapter !== "object" || !("cause" in adapter))
    return false;
  const cause = adapter.cause;
  return (
    cause !== null &&
    typeof cause === "object" &&
    "kind" in cause &&
    cause.kind === "postgres" &&
    "code" in cause &&
    cause.code === "57014" &&
    "originalCode" in cause &&
    cause.originalCode === "57014"
  );
}

/** Only admitted storage failures in the optional projection read may degrade. */
export function isHistoryLookupDependencyFailure(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (["P1001", "P1002", "P1008", "P1017", "P2024"].includes(error.code) ||
      (error.code === "P2010" && timedOutQuery(error.meta)))
  );
}

/** Escape the transaction before presenting optional-read unavailability. */
export class HistoryLookupDependencyFailure extends Error {
  constructor() {
    super("history_lookup_unavailable");
    this.name = "HistoryLookupDependencyFailure";
  }
}
