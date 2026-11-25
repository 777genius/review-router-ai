// Generated from provider-usage/domain/usage.ts. Do not edit.
import {
  validateUsagePriceSnapshot,
  type UsagePriceSnapshot,
} from "./usage-price-v1.js";
/** Safe RR-owned DTO. All tokens are inclusive totals; subdivisions never add to total. */
export interface UsageTokens {
  inputTotal: number | null;
  outputTotal: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
  reasoning: number | null;
  total: number | null;
}
export interface UsageCost {
  amount: string;
  currency: string;
  basis: "estimated" | "source_reported";
  source: string;
  asOf: string;
  priceVersion: string | null;
}
export interface UsageIdentity {
  callId: string;
  workspaceId: string;
  repositoryId: string | null;
  actorId: string | null;
  runId: string | null;
  runAttempt: number | null;
  invocationId: string;
  attemptId: string;
  bindingId: string | null;
  authorizationId: string;
  route: "gateway" | "direct";
  purpose: "review" | "diagnostic";
  provider: string;
  requestedModel: string | null;
  runtimeType: string;
  parentScope: string | null;
  granularity: "call" | "turn";
  occurredAt: string;
}
export interface UsageFact {
  serviceTier?: string | null;
  priceSnapshot?: UsagePriceSnapshot | null;
  schemaVersion: 1;
  sourceInstance: string;
  eventId: string;
  revision: number;
  authority: "lifecycle" | "native" | "runtime" | "runner";
  identity: UsageIdentity;
  actualProvider: string | null;
  actualModel: string | null;
  tokens: UsageTokens;
  cost: UsageCost | null;
  completeness: "complete" | "partial" | "unknown";
  state:
    | "prepared"
    | "dispatched"
    | "completed"
    | "failed"
    | "cancelled"
    | "unknown";
  dispatchEffect: "not_dispatched" | "dispatched" | "effect_unknown";
  durationMs: number | null;
  ttftMs: number | null;
  correctionReason: string | null;
  /** Exact, complete manifest. null means summary boundaries are unproven. */
  childCallIds: readonly string[] | null;
}
export type UsageErrorCode =
  | "usage_invalid_fact"
  | "usage_hash_conflict"
  | "usage_identity_conflict"
  | "usage_authority_conflict"
  | "usage_report_expired"
  | "source_window_expired"
  | "usage_scope_deleted"
  | "usage_checkpoint_stale";
export class UsageError extends Error {
  constructor(public readonly code: UsageErrorCode) {
    super(code);
  }
}
const invalid = (): never => {
  throw new UsageError("usage_invalid_fact");
};
function exact(
  value: unknown,
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    keys.some((k) => !Object.hasOwn(value, k)) ||
    Object.keys(value).some(
      (k) => !keys.includes(k) && !optionalKeys.includes(k),
    )
  )
    invalid();
}
function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) <= 31) return true;
  }
  return false;
}
function text(value: unknown, nullable = false): void {
  if (nullable && value === null) return;
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 256 ||
    hasControlCharacter(value)
  )
    invalid();
}
function choice(value: unknown, choices: readonly string[]): void {
  if (typeof value !== "string" || !choices.includes(value)) invalid();
}
export function validateUsageFact(f: UsageFact): void {
  exact(
    f,
    [
      "schemaVersion",
      "sourceInstance",
      "eventId",
      "revision",
      "authority",
      "identity",
      "actualProvider",
      "actualModel",
      "tokens",
      "cost",
      "completeness",
      "state",
      "dispatchEffect",
      "durationMs",
      "ttftMs",
      "correctionReason",
      "childCallIds",
    ],
    ["serviceTier", "priceSnapshot"],
  );
  if (Object.hasOwn(f, "serviceTier")) text(f.serviceTier, true);
  if (Object.hasOwn(f, "priceSnapshot") && f.priceSnapshot !== null) {
    try {
      validateUsagePriceSnapshot(f.priceSnapshot);
    } catch {
      invalid();
    }
  }
  exact(f.identity, [
    "callId",
    "workspaceId",
    "repositoryId",
    "actorId",
    "runId",
    "runAttempt",
    "invocationId",
    "attemptId",
    "bindingId",
    "authorizationId",
    "route",
    "purpose",
    "provider",
    "requestedModel",
    "runtimeType",
    "parentScope",
    "granularity",
    "occurredAt",
  ]);
  exact(f.tokens, [
    "inputTotal",
    "outputTotal",
    "cacheRead",
    "cacheWrite",
    "reasoning",
    "total",
  ]);
  choice(f.authority, ["lifecycle", "native", "runtime", "runner"]);
  choice(f.completeness, ["complete", "partial", "unknown"]);
  choice(f.state, [
    "prepared",
    "dispatched",
    "completed",
    "failed",
    "cancelled",
    "unknown",
  ]);
  choice(f.dispatchEffect, ["not_dispatched", "dispatched", "effect_unknown"]);
  choice(f.identity.route, ["gateway", "direct"]);
  choice(f.identity.purpose, ["review", "diagnostic"]);
  choice(f.identity.granularity, ["call", "turn"]);
  for (const v of [
    f.identity.repositoryId,
    f.identity.actorId,
    f.identity.runId,
    f.identity.bindingId,
    f.identity.requestedModel,
    f.identity.parentScope,
    f.actualProvider,
    f.actualModel,
    f.correctionReason,
  ])
    text(v, true);
  text(f.identity.runtimeType);
  if (
    f.identity.runAttempt !== null &&
    (!Number.isSafeInteger(f.identity.runAttempt) || f.identity.runAttempt < 1)
  )
    invalid();
  if (f.cost !== null && (typeof f.cost !== "object" || Array.isArray(f.cost)))
    invalid();
  if (f.cost) {
    text(f.cost.asOf);
    exact(f.cost, [
      "amount",
      "currency",
      "basis",
      "source",
      "asOf",
      "priceVersion",
    ]);
    choice(f.cost.basis, ["estimated", "source_reported"]);
    text(f.cost.source);
    text(f.cost.priceVersion, true);
  }
  if (
    f.childCallIds !== null &&
    (!Array.isArray(f.childCallIds) || !f.childCallIds.length)
  )
    invalid();
  for (const id of f.childCallIds ?? []) text(id);

  if (
    f.schemaVersion !== 1 ||
    !Number.isSafeInteger(f.revision) ||
    f.revision < 1 ||
    f.revision > 2147483647
  )
    invalid();
  for (const s of [
    f.sourceInstance,
    f.eventId,
    f.identity.callId,
    f.identity.workspaceId,
    f.identity.invocationId,
    f.identity.authorizationId,
    f.identity.attemptId,
    f.identity.provider,
  ]) {
    if (
      typeof s !== "string" ||
      s.length < 1 ||
      s.length > 256 ||
      hasControlCharacter(s)
    )
      invalid();
  }
  if (
    !/^\d{4}-\d\d-\d\dT.*Z$/.test(f.identity.occurredAt) ||
    !Number.isFinite(Date.parse(f.identity.occurredAt))
  )
    invalid();
  for (const n of [...Object.values(f.tokens), f.durationMs, f.ttftMs]) {
    if (
      n !== null &&
      (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0)
    )
      invalid();
  }
  const t = f.tokens;
  if (
    t.inputTotal !== null &&
    t.cacheRead !== null &&
    t.cacheRead > t.inputTotal
  )
    invalid();
  if (
    t.inputTotal !== null &&
    t.cacheWrite !== null &&
    t.cacheWrite > t.inputTotal
  )
    invalid();
  if (
    t.inputTotal !== null &&
    t.cacheRead !== null &&
    t.cacheWrite !== null &&
    t.cacheRead + t.cacheWrite > t.inputTotal
  )
    invalid();
  if (
    t.outputTotal !== null &&
    t.reasoning !== null &&
    t.reasoning > t.outputTotal
  )
    invalid();
  if (
    t.total !== null &&
    t.inputTotal !== null &&
    t.outputTotal !== null &&
    t.total !== t.inputTotal + t.outputTotal
  )
    invalid();
  if (
    f.cost &&
    (!/^(0|[1-9]\d{0,17})(\.\d{1,12})?$/.test(f.cost.amount) ||
      !/^[A-Z]{3}$/.test(f.cost.currency) ||
      !Number.isFinite(Date.parse(f.cost.asOf)) ||
      (f.cost.basis === "estimated" && !f.cost.priceVersion))
  )
    invalid();
  if (
    f.childCallIds &&
    (f.identity.granularity !== "turn" ||
      f.childCallIds.length > 10000 ||
      new Set(f.childCallIds).size !== f.childCallIds.length ||
      f.childCallIds.includes(f.identity.callId))
  )
    invalid();
}
export function identityKey(f: UsageFact): string {
  return canonicalJson(f.identity);
}
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value))
    return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, v]) => JSON.stringify(k) + ":" + canonicalJson(v))
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
/** Signed producer delivery evidence, independent of individual usage facts. */
export interface UsageProducerCoverage {
  schemaVersion: 1;
  revision: number;
  state: "partial";
  reason:
    | "spool_overflow"
    | "spool_write_failed"
    | "delivery_failed"
    | "producer_unavailable";
  droppedEvents: number;
  occurredAt: string;
}
export function validateUsageProducerCoverage(
  value: unknown,
): asserts value is UsageProducerCoverage {
  exact(value, [
    "schemaVersion",
    "revision",
    "state",
    "reason",
    "droppedEvents",
    "occurredAt",
  ]);
  if (
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !Number.isSafeInteger(value.droppedEvents) ||
    (value.droppedEvents as number) < 0
  )
    invalid();
  choice(value.state, ["partial"]);
  choice(value.reason, [
    "spool_overflow",
    "spool_write_failed",
    "delivery_failed",
    "producer_unavailable",
  ]);
  if (
    typeof value.occurredAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value.occurredAt) ||
    !Number.isFinite(Date.parse(value.occurredAt)) ||
    new Date(value.occurredAt).toISOString().slice(0, 19) !==
      value.occurredAt.slice(0, 19)
  )
    invalid();
}
