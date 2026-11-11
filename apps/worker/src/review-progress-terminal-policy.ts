import type { Prisma } from "@prisma/client";

export type TerminalOutcome =
  | "complete"
  | "complete_with_gaps"
  | "failed"
  | "superseded";

export function executionStateTerminal(
  value: string | undefined,
  publicationOutcome: "succeeded" | "failed" | "superseded",
): TerminalOutcome | null {
  if (publicationOutcome === "failed") return "failed";
  if (publicationOutcome === "superseded") return "superseded";
  if (value === "completed") return "complete";
  if (value === "partial") return "complete_with_gaps";
  if (value === "failed") return "failed";
  if (value === "superseded") return "superseded";
  return null;
}

export function terminalSnapshot(
  value: Prisma.JsonValue,
  terminal: TerminalOutcome,
  now: Date,
): Prisma.InputJsonObject {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !isRecord(value.counts)
  ) {
    throw new Error("review_progress_snapshot_invalid");
  }
  assertTerminalCounts(value.counts, terminal);
  return {
    ...value,
    phase: "terminal",
    terminal,
    updatedAt: now.toISOString(),
  } as Prisma.InputJsonObject;
}

/** Validate the required-count invariants before terminal persistence. */
function assertTerminalCounts(
  counts: Record<string, Prisma.JsonValue>,
  terminal: TerminalOutcome,
): void {
  const requiredCompleted = counts.requiredCompleted;
  const requiredTotal = counts.requiredTotal;
  const requiredExhausted = counts.requiredExhausted;
  const requiredCancelled = counts.requiredCancelled;
  if (
    !isRequiredCount(requiredCompleted) ||
    !isRequiredCount(requiredTotal) ||
    !isRequiredCount(requiredExhausted) ||
    !isRequiredCount(requiredCancelled)
  )
    throw new Error("review_progress_snapshot_invalid");
  if (
    terminal === "complete" &&
    (requiredCompleted !== requiredTotal ||
      requiredExhausted !== 0 ||
      requiredCancelled !== 0)
  )
    throw new Error("review_progress_complete_outcome_inconsistent");
  if (
    terminal === "complete_with_gaps" &&
    requiredExhausted + requiredCancelled < 1
  )
    throw new Error("review_progress_partial_outcome_inconsistent");
}

/** Terminal counts must satisfy the same nonnegative-integer invariant as publication. */
function isRequiredCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
