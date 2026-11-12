import type { ProgressSnapshot } from "@reviewrouter/features-review-progress";

export function parseSnapshot(value: unknown): ProgressSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error("review_progress_snapshot_invalid");
  }
  const counts = value.counts;
  const fileCoverage = value.fileCoverage;
  if (
    typeof value.generation !== "number" ||
    !Number.isSafeInteger(value.generation) ||
    !isPhase(value.phase) ||
    !isTerminal(value.terminal) ||
    typeof value.updatedAt !== "string" ||
    !isRecord(counts) ||
    !validCounts(counts) ||
    !validCoverage(fileCoverage) ||
    !validOptionalSourceIdentity(value.sourceIdentity)
  )
    throw new Error("review_progress_snapshot_invalid");
  return value as unknown as ProgressSnapshot;
}

function validOptionalSourceIdentity(value: unknown): boolean {
  if (value === undefined) return true;
  return (
    isRecord(value) &&
    typeof value.sourceRunId === "string" &&
    /^[1-9][0-9]{0,19}$/u.test(value.sourceRunId) &&
    typeof value.sourceRunAttempt === "string" &&
    /^[1-9][0-9]{0,9}$/u.test(value.sourceRunAttempt)
  );
}

function validCounts(value: Record<string, unknown>): boolean {
  return [
    "total",
    "completed",
    "exhausted",
    "cancelled",
    "running",
    "pending",
    "retrying",
    "recovered",
    "requiredTotal",
    "requiredCompleted",
    "requiredExhausted",
    "requiredCancelled",
    "optionalTotal",
    "optionalCompleted",
  ].every((key) => isNonNegativeSafeInteger(value[key]));
}

function validCoverage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.valid !== "boolean") return false;
  if (value.valid === false) return true;
  return ["total", "covered", "uncovered", "excluded"].every((key) =>
    isNonNegativeSafeInteger(value[key]),
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPhase(value: unknown): value is ProgressSnapshot["phase"] {
  if (typeof value !== "string") return false;
  return [
    "preparing",
    "reviewing",
    "assembling",
    "publishing",
    "terminal",
  ].includes(value);
}

function isTerminal(value: unknown): value is ProgressSnapshot["terminal"] {
  if (typeof value !== "string") return false;
  return [
    "none",
    "complete",
    "complete_with_gaps",
    "failed",
    "cancelled",
    "superseded",
  ].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
