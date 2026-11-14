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
    value.generation < 0 ||
    !isPhase(value.phase) ||
    !isTerminal(value.terminal) ||
    (value.phase === "terminal") !== (value.terminal !== "none") ||
    !isCanonicalInstant(value.updatedAt) ||
    !isRecord(counts) ||
    !validCounts(counts) ||
    !validTerminalCounts(value.terminal, counts) ||
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
  const keys = [
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
  ];
  if (!keys.every((key) => isNonNegativeSafeInteger(value[key]))) return false;

  const counts = value as unknown as ProgressSnapshot["counts"];
  return (
    counts.requiredTotal + counts.optionalTotal === counts.total &&
    counts.requiredCompleted + counts.optionalCompleted === counts.completed &&
    counts.optionalCompleted <= counts.optionalTotal &&
    counts.optionalCompleted +
      (counts.exhausted - counts.requiredExhausted) +
      (counts.cancelled - counts.requiredCancelled) <=
      counts.optionalTotal &&
    counts.completed +
      counts.exhausted +
      counts.cancelled +
      counts.running +
      counts.pending ===
      counts.total &&
    counts.requiredCompleted +
      counts.requiredExhausted +
      counts.requiredCancelled <=
      counts.requiredTotal &&
    counts.requiredExhausted <= counts.exhausted &&
    counts.requiredCancelled <= counts.cancelled &&
    counts.retrying <= counts.running &&
    counts.recovered <= counts.completed
  );
}

function validTerminalCounts(
  terminal: unknown,
  value: Record<string, unknown>,
): boolean {
  const counts = value as unknown as ProgressSnapshot["counts"];
  if (terminal === "complete") {
    return (
      counts.requiredCompleted === counts.requiredTotal &&
      counts.requiredExhausted === 0 &&
      counts.requiredCancelled === 0
    );
  }
  if (terminal === "complete_with_gaps") {
    return (
      counts.requiredCompleted !== counts.requiredTotal &&
      counts.requiredExhausted + counts.requiredCancelled > 0
    );
  }
  return true;
}

function validCoverage(value: unknown): boolean {
  if (!isRecord(value) || typeof value.valid !== "boolean") return false;
  if (value.valid === false) return true;
  return (
    isNonNegativeSafeInteger(value.total) &&
    isNonNegativeSafeInteger(value.covered) &&
    isNonNegativeSafeInteger(value.uncovered) &&
    isNonNegativeSafeInteger(value.excluded) &&
    value.covered <= value.total &&
    value.uncovered <= value.total
  );
}

function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
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
