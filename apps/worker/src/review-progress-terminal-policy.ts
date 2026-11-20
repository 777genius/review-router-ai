import type { Prisma } from "@prisma/client";
import { settledOutcomeCountsValid } from "@reviewrouter/features-review-progress";

export type TerminalOutcome =
  | "complete"
  | "complete_with_gaps"
  | "failed"
  | "superseded";

/**
 * The terminal outcome of a settled review. A completed execution is Complete
 * only when its published summary is complete too: the Action can say "Review
 * incomplete" with every required part finished (for example unverified
 * native spans), and the progress comment must say the same.
 */
export function executionStateTerminal(
  value: string | undefined,
  publicationOutcome: "succeeded" | "failed" | "superseded",
  summaryVerdict: "complete" | "incomplete",
): TerminalOutcome | null {
  if (publicationOutcome === "failed") return "failed";
  if (publicationOutcome === "superseded") return "superseded";
  if (value === "completed")
    return summaryVerdict === "complete" ? "complete" : "complete_with_gaps";
  if (value === "partial") return "complete_with_gaps";
  if (value === "failed") return "failed";
  if (value === "superseded") return "superseded";
  return null;
}

export function terminalSnapshot(
  value: Prisma.JsonValue,
  terminal: TerminalOutcome,
  now: Date,
  facts: Readonly<{ requiredCoverageComplete?: boolean }> = {},
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
    ...(facts.requiredCoverageComplete === true
      ? { requiredCoverageComplete: true }
      : {}),
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
  const requiredGaps = requiredExhausted + requiredCancelled;
  if (requiredCompleted + requiredGaps > requiredTotal)
    throw new Error("review_progress_snapshot_invalid");
  if (terminal !== "complete" && terminal !== "complete_with_gaps") return;
  if (
    !settledOutcomeCountsValid(terminal, {
      requiredCompleted,
      requiredTotal,
      requiredExhausted,
      requiredCancelled,
    })
  )
    throw new Error(
      terminal === "complete"
        ? "review_progress_complete_outcome_inconsistent"
        : "review_progress_partial_outcome_inconsistent",
    );
}

/** Terminal counts must satisfy the same nonnegative-integer invariant as publication. */
function isRequiredCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, Prisma.JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
