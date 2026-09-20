import { createHash } from "node:crypto";
import type {
  AuthorityValidity,
  AuthorityRef,
  CheckSpec,
  DeliveryClaim,
  Digest,
  EffectChange,
  EffectView,
  Evidence,
  Instant,
  NumericId,
  Observation,
  PublicationCheckGateway,
  PublicationEffectStore,
  PublicationSeed,
  Terminal,
} from "./publication-ports.js";

export const SDK_GROWTH_CHECK_NAME =
  "ReviewRouter / SDK growth authority" as const;
export const SDK_GROWTH_RECONCILIATION_LIMIT = 20 as const;

export class PublicationContractError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PublicationContractError";
  }
}

export type PublicationEnvelopeInput = Readonly<{
  intentId: string;
  authority: AuthorityRef;
  repositoryId: NumericId;
  installationId: NumericId;
  appId: NumericId;
  repositoryFullName: string;
  headSha: string;
  admitted: boolean;
  output: Readonly<{ title: string; summary: string }>;
  createdAt: Instant;
}>;

export function buildPublicationSeed(
  input: PublicationEnvelopeInput,
): PublicationSeed {
  const intentId = requiredText(input.intentId, "intent_id_invalid", 2_048);
  const authority = freezeAuthority(input.authority);
  const check: CheckSpec = Object.freeze({
    repositoryId: numericId(input.repositoryId, "repository_id_invalid"),
    installationId: numericId(input.installationId, "installation_id_invalid"),
    appId: numericId(input.appId, "app_id_invalid"),
    repositoryFullName: fullName(input.repositoryFullName),
    headSha: commitSha(input.headSha),
    name: SDK_GROWTH_CHECK_NAME,
    externalId: sdkGrowthExternalId(intentId),
    conclusion: input.admitted ? "success" : "failure",
    output: freezeOutput(input.output),
  });
  const createdAt = instant(input.createdAt);
  const canonical = canonicalJson({
    contractVersion: 1,
    intentId,
    authority: {
      ...authority,
      receiptFence: authority.receiptFence.toString(),
      authorityEpoch: authority.authorityEpoch.toString(),
    },
    check,
    createdAt,
  });
  return Object.freeze({
    contractVersion: 1,
    intentId,
    envelopeDigest: sha256(canonical),
    authority,
    check,
    createdAt,
  });
}

export function sdkGrowthExternalId(intentId: string): string {
  return `rr-sdk-growth-v1:${sha256(
    requiredText(intentId, "intent_id_invalid", 2_048),
  )}`;
}

export function validatePublicationSeed(
  value: PublicationSeed,
): PublicationSeed {
  if (
    value.check.conclusion !== "success" &&
    value.check.conclusion !== "failure"
  ) {
    fail("check_conclusion_invalid");
  }
  const rebuilt = buildPublicationSeed({
    intentId: value.intentId,
    authority: value.authority,
    repositoryId: value.check.repositoryId,
    installationId: value.check.installationId,
    appId: value.check.appId,
    repositoryFullName: value.check.repositoryFullName,
    headSha: value.check.headSha,
    admitted: value.check.conclusion === "success",
    output: value.check.output,
    createdAt: value.createdAt,
  });
  if (
    value.contractVersion !== 1 ||
    value.check.name !== SDK_GROWTH_CHECK_NAME ||
    value.check.externalId !== rebuilt.check.externalId ||
    value.envelopeDigest !== rebuilt.envelopeDigest
  ) {
    fail("publication_envelope_invalid");
  }
  return rebuilt;
}

export function validateEffectView(effect: EffectView): EffectView {
  validatePublicationSeed(effect.seed);
  if (!isEffectState(effect.state)) fail("effect_state_invalid");
  if (effect.attempt) {
    requiredText(effect.attempt.id, "attempt_id_invalid", 256);
    instant(effect.attempt.startedAt);
    reconciliationCount(effect.attempt.reconciliationCount);
  }
  if (effect.lastObservation) validateEvidence(effect.lastObservation);
  switch (effect.state) {
    case "ready":
      if (effect.attempt !== null) fail("ready_has_attempt");
      if (effect.lastObservation !== null) fail("ready_has_observation");
      break;
    case "sending":
      if (effect.attempt === null) fail("attempt_required");
      if (effect.attempt.reconciliationCount !== 0) {
        fail("sending_has_reconciliation");
      }
      if (effect.lastObservation !== null) fail("sending_has_observation");
      break;
    case "reconcile-required":
      if (effect.attempt === null) fail("attempt_required");
      if (
        effect.attempt.reconciliationCount <= 0 ||
        effect.attempt.reconciliationCount >= SDK_GROWTH_RECONCILIATION_LIMIT
      ) {
        fail("reconciliation_count_invalid");
      }
      if (
        effect.lastObservation?.kind !== "absent" &&
        effect.lastObservation?.kind !== "unknown"
      ) {
        fail("reconcile_requires_uncertainty");
      }
      break;
    case "superseded":
      if (effect.attempt !== null) fail("superseded_has_attempt");
      validateTerminalEvidence(effect.state, effect.lastObservation);
      break;
    case "applied":
    case "not-applied":
    case "recovery-required":
      if (effect.attempt === null) fail("terminal_attempt_required");
      validateTerminalEvidence(effect.state, effect.lastObservation);
      validateTerminalReconciliation(
        effect.state,
        effect.lastObservation!,
        effect.attempt.reconciliationCount,
      );
      break;
  }
  return effect;
}

export function validateEffectChange(
  effect: EffectView,
  change: EffectChange,
): void {
  validateEffectView(effect);
  if (isTerminal(effect.state)) fail("terminal_state_cannot_reopen");
  switch (change.kind) {
    case "start":
      if (effect.state !== "ready" || effect.attempt !== null) {
        fail("attempt_already_started");
      }
      requiredText(change.attemptId, "attempt_id_invalid", 256);
      return;
    case "reconcile":
      requireSameAttempt(effect, change.attemptId);
      requireNextReconciliation(effect, change.reconciliationCount);
      validateEvidence(change.observation);
      if (
        (effect.state !== "sending" && effect.state !== "reconcile-required") ||
        (change.observation.kind !== "absent" &&
          change.observation.kind !== "unknown")
      ) {
        fail("reconcile_requires_uncertainty");
      }
      return;
    case "finish":
      if (!isTerminal(change.outcome)) fail("terminal_outcome_invalid");
      if (change.outcome === "superseded") {
        if (
          change.attemptId !== null ||
          change.reconciliationCount !== 0 ||
          effect.state !== "ready" ||
          effect.attempt !== null
        ) {
          fail("superseded_requires_not_started");
        }
      } else {
        if (change.attemptId === null) fail("attempt_required");
        requireSameAttempt(effect, change.attemptId);
        if (
          effect.state !== "sending" &&
          effect.state !== "reconcile-required"
        ) {
          fail("terminal_source_state_invalid");
        }
        const expectedCount = isProviderObservation(change.evidence)
          ? effect.attempt!.reconciliationCount + 1
          : effect.attempt!.reconciliationCount;
        if (change.reconciliationCount !== expectedCount) {
          fail("reconciliation_count_invalid");
        }
        reconciliationCount(change.reconciliationCount);
      }
      validateTerminalEvidence(change.outcome, change.evidence);
      validateTerminalReconciliation(
        change.outcome,
        change.evidence,
        change.reconciliationCount,
      );
      return;
    default:
      fail("effect_change_invalid");
  }
}

export type PublicationRunResult =
  | Terminal
  | "retry"
  | "stale-claim"
  | "missing";

type PlannedAction =
  | Readonly<{ kind: "terminal"; result: Terminal }>
  | Readonly<{ kind: "wait" }>
  | Readonly<{
      kind: "dispatch" | "inspect";
      attemptId: string;
      spec: CheckSpec;
    }>;

/**
 * Runs one claimed delivery turn. Database callbacks make synchronous
 * decisions; provider I/O starts only after those transactions return.
 * A persisted attempt is never replaced, so each intent has at most one POST.
 */
export async function runPublicationIntent(
  input: Readonly<{
    intentId: string;
    claim: DeliveryClaim;
    effects: PublicationEffectStore;
    gateway: PublicationCheckGateway;
    newAttemptId: () => string;
    signal: AbortSignal;
  }>,
): Promise<PublicationRunResult> {
  const planned = await input.effects.withClaim<PlannedAction>(
    input.intentId,
    input.claim,
    (effect, authority, now) => {
      validateEffectView(effect);
      validateAuthorityValidity(authority);
      if (isTerminal(effect.state)) {
        return decision(null, {
          kind: "terminal",
          result: effect.state,
        } satisfies PlannedAction);
      }
      if (effect.attempt) {
        return decision(null, {
          kind: "inspect",
          attemptId: effect.attempt.id,
          spec: effect.seed.check,
        } satisfies PlannedAction);
      }
      if (authority.kind === "unavailable") {
        return decision(null, { kind: "wait" } satisfies PlannedAction);
      }
      if (authority.kind === "stale") {
        const evidence = Object.freeze({
          kind: "not-started",
          reason: authority.reason,
          at: now,
        } as const);
        const change = Object.freeze({
          kind: "finish",
          attemptId: null,
          reconciliationCount: 0,
          outcome: "superseded",
          evidence,
        } as const);
        validateEffectChange(effect, change);
        return decision(change, {
          kind: "terminal",
          result: "superseded",
        } satisfies PlannedAction);
      }
      const attemptId = requiredText(
        input.newAttemptId(),
        "attempt_id_invalid",
        256,
      );
      const change = Object.freeze({ kind: "start", attemptId } as const);
      validateEffectChange(effect, change);
      return decision(change, {
        kind: "dispatch",
        attemptId,
        spec: effect.seed.check,
      } satisfies PlannedAction);
    },
  );
  if (planned.kind !== "committed") return planned.kind;
  const action = planned.value;
  if (action.kind === "terminal") return action.result;
  if (action.kind === "wait") return "retry";

  if (action.kind === "inspect") {
    return commitObservation(
      input,
      action.attemptId,
      await safeInspect(input.gateway, action.spec, input.signal),
    );
  }

  // A database fence cannot prevent a paused remote sender. This immediate
  // check only prevents a known-stale worker from beginning a new mutation.
  const permission = await input.effects.withClaim(
    input.intentId,
    input.claim,
    (effect, authority) => {
      validateEffectView(effect);
      return decision(
        null,
        authority.kind === "current" &&
          effect.state === "sending" &&
          effect.attempt?.id === action.attemptId,
      );
    },
  );
  if (permission.kind !== "committed") return permission.kind;
  if (!permission.value) return "retry";

  const post = await safeCreate(
    input.gateway,
    action.spec,
    action.attemptId,
    input.signal,
  );
  if (post.kind === "no-effect") {
    return finish(input, action.attemptId, "not-applied", post);
  }
  // Acknowledgement and transport uncertainty both require full readback.
  return commitObservation(
    input,
    action.attemptId,
    await safeInspect(input.gateway, action.spec, input.signal),
  );
}

async function commitObservation(
  input: Pick<
    Parameters<typeof runPublicationIntent>[0],
    "intentId" | "claim" | "effects"
  >,
  attemptId: string,
  observation: Observation,
): Promise<PublicationRunResult> {
  const committed = await input.effects.withClaim<PublicationRunResult>(
    input.intentId,
    input.claim,
    (effect) => {
      validateEffectView(effect);
      requireSameAttempt(effect, attemptId);
      const nextCount = effect.attempt.reconciliationCount + 1;
      const terminal: Terminal | null =
        observation.kind === "exact"
          ? "applied"
          : observation.kind === "conflict" ||
              nextCount >= SDK_GROWTH_RECONCILIATION_LIMIT
            ? "recovery-required"
            : null;
      const change = terminal
        ? (Object.freeze({
            kind: "finish",
            attemptId,
            reconciliationCount: nextCount,
            outcome: terminal,
            evidence: observation,
          } as const) satisfies EffectChange)
        : (Object.freeze({
            kind: "reconcile",
            attemptId,
            reconciliationCount: nextCount,
            observation,
          } as const) satisfies EffectChange);
      validateEffectChange(effect, change);
      return decision(change, terminal ?? ("retry" as const));
    },
  );
  return committed.kind === "committed" ? committed.value : committed.kind;
}

async function finish(
  input: Pick<
    Parameters<typeof runPublicationIntent>[0],
    "intentId" | "claim" | "effects"
  >,
  attemptId: string,
  outcome: Terminal,
  evidence: Evidence,
): Promise<PublicationRunResult> {
  const committed = await input.effects.withClaim(
    input.intentId,
    input.claim,
    (effect) => {
      validateEffectView(effect);
      requireSameAttempt(effect, attemptId);
      const change = Object.freeze({
        kind: "finish",
        attemptId,
        reconciliationCount: effect.attempt.reconciliationCount,
        outcome,
        evidence,
      } as const);
      validateEffectChange(effect, change);
      return decision(change, outcome);
    },
  );
  return committed.kind === "committed" ? committed.value : committed.kind;
}

async function safeInspect(
  gateway: PublicationCheckGateway,
  spec: CheckSpec,
  signal: AbortSignal,
): Promise<Observation> {
  try {
    const result = await gateway.inspect(spec, signal);
    validateEvidence(result);
    return result;
  } catch {
    return Object.freeze({
      kind: "unknown",
      reason: "transport",
      at: Date.now(),
    });
  }
}

async function safeCreate(
  gateway: PublicationCheckGateway,
  spec: CheckSpec,
  attemptId: string,
  signal: AbortSignal,
) {
  try {
    return await gateway.create(spec, attemptId, signal);
  } catch {
    return Object.freeze({
      kind: "unknown",
      reason: "transport",
      at: Date.now(),
    } as const);
  }
}

function validateTerminalEvidence(
  outcome: unknown,
  evidence: Evidence | null,
): void {
  if (!isTerminal(outcome)) fail("terminal_outcome_invalid");
  if (!evidence) fail("terminal_evidence_required");
  validateEvidence(evidence);
  if (outcome === "applied" && evidence.kind !== "exact") {
    fail("applied_requires_exact");
  }
  if (outcome === "not-applied" && evidence.kind !== "no-effect") {
    fail("not_applied_requires_no_effect");
  }
  if (outcome === "superseded" && evidence.kind !== "not-started") {
    fail("superseded_requires_not_started");
  }
  if (
    outcome === "recovery-required" &&
    evidence.kind !== "conflict" &&
    evidence.kind !== "unknown" &&
    evidence.kind !== "absent"
  ) {
    fail("recovery_requires_uncertainty");
  }
}

function validateTerminalReconciliation(
  outcome: Terminal,
  evidence: Evidence,
  count: number,
): void {
  reconciliationCount(count);
  if (outcome === "superseded") {
    if (count !== 0) fail("reconciliation_count_invalid");
    return;
  }
  if (outcome === "not-applied") {
    if (count !== 0) fail("reconciliation_count_invalid");
    return;
  }
  if (outcome === "applied") {
    if (count <= 0) fail("reconciliation_count_invalid");
    return;
  }
  if (
    evidence.kind !== "conflict" &&
    count !== SDK_GROWTH_RECONCILIATION_LIMIT
  ) {
    fail("reconciliation_budget_not_exhausted");
  }
  if (evidence.kind === "conflict" && count <= 0) {
    fail("reconciliation_count_invalid");
  }
}

export function validateEvidence(evidence: Evidence): void {
  instant(evidence.at);
  switch (evidence.kind) {
    case "exact":
      numericId(evidence.checkRunId, "check_run_id_invalid");
      digest(evidence.observedDigest);
      return;
    case "absent":
      return;
    case "unknown":
      if (
        evidence.reason !== "transport" &&
        evidence.reason !== "partial-read" &&
        evidence.reason !== "malformed-response" &&
        evidence.reason !== "unavailable"
      ) {
        fail("observation_reason_invalid");
      }
      return;
    case "not-started":
      validateStaleReason(evidence.reason);
      return;
    case "conflict":
      if (
        evidence.reason !== "duplicate" &&
        evidence.reason !== "identity-mismatch" &&
        evidence.reason !== "output-mismatch" &&
        evidence.reason !== "unexpected-effect"
      ) {
        fail("conflict_reason_invalid");
      }
      if (!Array.isArray(evidence.witnessIds)) {
        fail("conflict_witnesses_invalid");
      }
      if (evidence.witnessIds.length > 2) {
        fail("too_many_conflict_witnesses");
      }
      evidence.witnessIds.forEach((id) =>
        numericId(id, "check_run_id_invalid"),
      );
      digest(evidence.evidenceDigest);
      return;
    case "no-effect":
      if (
        evidence.reason !== "local-pre-dispatch" &&
        evidence.reason !== "provider-rejected"
      ) {
        fail("no_effect_reason_invalid");
      }
      digest(evidence.evidenceDigest);
      return;
    default:
      fail("evidence_kind_invalid");
  }
}

function validateAuthorityValidity(value: AuthorityValidity): void {
  if (value.kind === "current" || value.kind === "unavailable") return;
  if (value.kind === "stale") {
    validateStaleReason(value.reason);
    return;
  }
  fail("authority_validity_invalid");
}

function validateStaleReason(reason: string): void {
  if (
    reason !== "expired" &&
    reason !== "revoked" &&
    reason !== "fenced" &&
    reason !== "epoch-changed" &&
    reason !== "binding-changed" &&
    reason !== "installation-inactive" &&
    reason !== "verifier-withdrawn"
  ) {
    fail("stale_authority_reason_invalid");
  }
}

function freezeAuthority(value: AuthorityRef): AuthorityRef {
  return Object.freeze({
    tenantId: requiredText(value.tenantId, "tenant_id_invalid", 256),
    repositoryId: requiredText(
      value.repositoryId,
      "authority_repository_id_invalid",
      256,
    ),
    pullRequest: positiveInteger(value.pullRequest, "pull_request_invalid"),
    receiptFence: positiveBigInt(value.receiptFence, "receipt_fence_invalid"),
    authorityEpoch: positiveBigInt(
      value.authorityEpoch,
      "authority_epoch_invalid",
    ),
    receiptDigest: digest(value.receiptDigest),
  });
}

function freezeOutput(value: CheckSpec["output"]): CheckSpec["output"] {
  const title = requiredText(value.title, "output_title_invalid", 256);
  const summary = requiredText(value.summary, "output_summary_invalid", 4_096);
  if (
    Buffer.byteLength(title, "utf8") > 256 ||
    Buffer.byteLength(summary, "utf8") > 4_096
  ) {
    fail("output_too_large");
  }
  return Object.freeze({ title, summary });
}

function fullName(value: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/u.test(value) || value.length > 256) {
    fail("repository_full_name_invalid");
  }
  return value;
}
function numericId(value: unknown, code: string): NumericId {
  if (
    typeof value !== "string" ||
    !/^[1-9][0-9]*$/u.test(value) ||
    BigInt(value) > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    fail(code);
  }
  return value;
}
function commitSha(value: string): string {
  if (!/^[a-f0-9]{40}$/u.test(value)) fail("head_sha_invalid");
  return value;
}
function digest(value: unknown): Digest {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) {
    fail("digest_invalid");
  }
  return value;
}
function instant(value: unknown): Instant {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("instant_invalid");
  }
  return value;
}
function positiveInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    fail(code);
  }
  return value;
}
function positiveBigInt(value: unknown, code: string): bigint {
  if (typeof value !== "bigint" || value <= 0n) fail(code);
  return value;
}
function requiredText(value: unknown, code: string, maximum: number): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maximum
  ) {
    fail(code);
  }
  return value;
}
function requireSameAttempt(
  effect: EffectView,
  attemptId: string,
): asserts effect is EffectView & {
  attempt: NonNullable<EffectView["attempt"]>;
} {
  requiredText(attemptId, "attempt_id_invalid", 256);
  if (!effect.attempt || effect.attempt.id !== attemptId) {
    fail("attempt_mismatch");
  }
}
function requireNextReconciliation(effect: EffectView, value: number): void {
  if (
    !effect.attempt ||
    value !== effect.attempt.reconciliationCount + 1 ||
    value >= SDK_GROWTH_RECONCILIATION_LIMIT
  ) {
    fail("reconciliation_count_invalid");
  }
  reconciliationCount(value);
}
function reconciliationCount(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > SDK_GROWTH_RECONCILIATION_LIMIT
  ) {
    fail("reconciliation_count_invalid");
  }
  return value;
}
function isProviderObservation(evidence: Evidence): evidence is Observation {
  return (
    evidence.kind === "exact" ||
    evidence.kind === "absent" ||
    evidence.kind === "unknown" ||
    evidence.kind === "conflict"
  );
}
function isTerminal(state: unknown): state is Terminal {
  return (
    state === "applied" ||
    state === "not-applied" ||
    state === "superseded" ||
    state === "recovery-required"
  );
}
function isEffectState(state: unknown): state is EffectView["state"] {
  return (
    state === "ready" ||
    state === "sending" ||
    state === "reconcile-required" ||
    state === "applied" ||
    state === "not-applied" ||
    state === "superseded" ||
    state === "recovery-required"
  );
}
function decision<T>(change: EffectChange | null, value: T) {
  return Object.freeze({ change, value });
}
function sha256(value: string): Digest {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Readonly<Record<string, unknown>>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}
function fail(code: string): never {
  throw new PublicationContractError(code);
}
