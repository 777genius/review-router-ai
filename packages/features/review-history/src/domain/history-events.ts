export const historyChangedEventType = "review.history.changed";
export const historyChangedEventVersion = 1;
export class HistoryCollisionError extends Error {
  readonly code = "history_fact_collision";
  constructor() {
    super("history_fact_collision");
  }
}
export class HistoryEventValidationError extends Error {
  readonly code = "history_event_invalid";
  constructor() {
    super("history_event_invalid");
  }
}
export type HistoryRunIdentity = Readonly<{
  rootRequestId: string;
  pullRequestId: string;
  workspaceId: string;
  scmRepositoryIdentityId: string;
  pullRequestNumber: number;
  originalRepositoryConnectionId: string;
  runSequence: string;
  requestedAt: string;
  triggerKind: string;
  headSha: string;
  reviewRevisionHash: string;
  repositoryFullName: string | null;
  pullRequestTitle: string | null;
  sourceBaseUrl: string;
}>;
export type HistoryIntentFacts = Readonly<{
  state: string;
  terminalReason: string | null;
  admissionState: string;
  executionId: string | null;
}>;
export type HistoryExecutionFacts = Readonly<{
  state: string;
  generation: string;
  finalizedArtifactId: string | null;
}>;
export type HistoryCompletionFacts = Readonly<{
  state: string;
  safeReason: string;
  publicationAttemptId: string | null;
  snapshotCommitReceiptId: string | null;
}>;
export type HistorySourceSnapshot =
  | Readonly<{
      kind: "intent";
      sourceId: string;
      attempt: number;
      sourceVersion: string;
      facts: HistoryIntentFacts;
    }>
  | Readonly<{
      kind: "execution";
      sourceId: string;
      attempt: number;
      sourceVersion: string;
      facts: HistoryExecutionFacts;
    }>
  | Readonly<{
      kind: "completion";
      sourceId: string;
      attempt: number;
      sourceVersion: string;
      facts: HistoryCompletionFacts;
    }>;
export type HistoryChangedEvent = Readonly<{
  version: 1;
  run: HistoryRunIdentity;
  snapshot: HistorySourceSnapshot;
  occurredAt: string;
  executionSeed?: Extract<HistorySourceSnapshot, { kind: "execution" }>;
  completionSeed?: Extract<HistorySourceSnapshot, { kind: "completion" }>;
}>;
const intentStates = [
  "pending_dispatch",
  "dispatching",
  "reconciling_dispatch",
  "awaiting_authorization",
  "dispatched",
  "terminal",
  "superseded",
];
const executionStates = [
  "planned",
  "running",
  "superseded",
  "completed",
  "partial",
  "failed",
];
const completionStates = [
  "awaiting_publication",
  "publication_in_progress",
  "awaiting_snapshot",
  "completed",
  "completed_superseded",
  "partial_completed",
  "publication_not_applied",
  "publication_stale_compensated",
  "publication_stale_visible",
  "blocked_publication_unknown",
];
export function parseHistoryChangedEvent(value: unknown): HistoryChangedEvent {
  const event = record(value),
    run = record(event.run);
  if (event.version !== 1) fail();
  exact(event, [
    "version",
    "run",
    "snapshot",
    "occurredAt",
    ...(event.executionSeed === undefined ? [] : ["executionSeed"]),
    ...(event.completionSeed === undefined ? [] : ["completionSeed"]),
  ]);
  exact(run, [
    "rootRequestId",
    "pullRequestId",
    "workspaceId",
    "scmRepositoryIdentityId",
    "pullRequestNumber",
    "originalRepositoryConnectionId",
    "runSequence",
    "requestedAt",
    "triggerKind",
    "headSha",
    "reviewRevisionHash",
    "repositoryFullName",
    "pullRequestTitle",
    "sourceBaseUrl",
  ]);
  for (const key of [
    "rootRequestId",
    "pullRequestId",
    "workspaceId",
    "scmRepositoryIdentityId",
    "originalRepositoryConnectionId",
    "triggerKind",
    "headSha",
    "reviewRevisionHash",
    "sourceBaseUrl",
  ])
    identifier(run[key]);
  decimal(run.runSequence);
  date(run.requestedAt);
  date(event.occurredAt);
  positive(run.pullRequestNumber);
  nullableText(run.repositoryFullName, 512);
  nullableText(run.pullRequestTitle, 500);
  if (
    run.sourceBaseUrl !== "https://github.com" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(run.headSha as string) ||
    !/^[a-f0-9]{64}$/u.test(run.reviewRevisionHash as string)
  )
    fail();
  snapshot(event.snapshot);
  if (
    event.executionSeed !== undefined &&
    snapshot(event.executionSeed).kind !== "execution"
  )
    fail();
  if (
    event.completionSeed !== undefined &&
    snapshot(event.completionSeed).kind !== "completion"
  )
    fail();
  if (
    (event.executionSeed !== undefined || event.completionSeed !== undefined) &&
    record(event.snapshot).kind !== "intent"
  )
    fail();
  if (event.executionSeed !== undefined || event.completionSeed !== undefined) {
    const parent = record(event.snapshot),
      facts = record(parent.facts);
    if (facts.state !== "dispatched" || facts.executionId === null) fail();
    for (const seed of [event.executionSeed, event.completionSeed]) {
      if (
        seed !== undefined &&
        (record(seed).sourceId !== facts.executionId ||
          record(seed).attempt !== parent.attempt)
      )
        fail();
    }
  }
  return value as HistoryChangedEvent;
}
function snapshot(value: unknown): HistorySourceSnapshot {
  const s = record(value),
    f = record(s.facts);
  exact(s, ["kind", "sourceId", "attempt", "sourceVersion", "facts"]);
  identifier(s.sourceId);
  positive(s.attempt);
  decimal(s.sourceVersion);
  if (s.kind === "intent") {
    exact(f, ["state", "terminalReason", "admissionState", "executionId"]);
    if (
      !intentStates.includes(f.state as string) ||
      !["not_evaluated", "admitted", "rejected"].includes(
        f.admissionState as string,
      )
    )
      fail();
    nullableText(f.terminalReason, 256);
    nullableText(f.executionId, 256);
  } else if (s.kind === "execution") {
    exact(f, ["state", "generation", "finalizedArtifactId"]);
    if (!executionStates.includes(f.state as string)) fail();
    decimal(f.generation);
    nullableText(f.finalizedArtifactId, 256);
  } else if (s.kind === "completion") {
    exact(f, [
      "state",
      "safeReason",
      "publicationAttemptId",
      "snapshotCommitReceiptId",
    ]);
    if (!completionStates.includes(f.state as string)) fail();
    identifier(f.safeReason);
    nullableText(f.publicationAttemptId, 256);
    nullableText(f.snapshotCommitReceiptId, 256);
  } else fail();
  return value as HistorySourceSnapshot;
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function identifier(value: unknown): void {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 512 ||
    hasControls(value)
  )
    fail();
}
function nullableText(value: unknown, max: number): void {
  if (
    value !== null &&
    (typeof value !== "string" || value.length > max || hasControls(value))
  )
    fail();
}
function decimal(value: unknown): void {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]{0,18}$/u.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    fail();
}
function date(value: unknown): void {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail();
}
function positive(value: unknown): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
    fail();
}
function fail(): never {
  throw new HistoryEventValidationError();
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  const actual = Object.keys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => !keys.includes(key))
  )
    fail();
}

function hasControls(value: string): boolean {
  return Array.from(value).some((character) => character.charCodeAt(0) < 32);
}
