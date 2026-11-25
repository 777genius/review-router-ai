import {
  normalizeProviderInvocationManifest,
  prepareReviewObservationPayload,
  stableJson,
  type ProviderInvocationManifest,
  type ReviewObservationPayload,
} from "@reviewrouter/features-review-evidence";
import {
  ReviewExecutionProviderKind,
  ReviewTaskKind,
  type ReviewWorkSlotPlan,
} from "@reviewrouter/features-review-executions";
import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import {
  parseReviewRunRuntimeSnapshot,
  reviewAgentExecutionProviderKind,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { ReviewActionV2ProtocolErrorCode } from "@reviewrouter/protocol-review-action-v2";
import { type ReviewActionV2ExecutionTimingPolicy } from "./review-action-v2-execution-evidence-dependencies.js";

// Canonical request parsing and fail-closed protocol validation for this API.

export function parseWorkSlots(value: string): readonly ReviewWorkSlotPlan[] {
  const parsed = parseCanonicalJson(value, "work_slots_invalid");
  if (!Array.isArray(parsed))
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "work_slots_invalid",
    );
  return parsed.map((item) => {
    const row = record(item, "work_slot_invalid");
    exactKeys(
      row,
      [
        "workSlotId",
        "taskKind",
        "providerKind",
        "providerVoteIdentityHash",
        "shardKey",
        "required",
        "attemptBudget",
        "retryPolicyVersion",
      ],
      "work_slot_shape_invalid",
    );
    return {
      workSlotId: text(row.workSlotId),
      taskKind: enumValue(ReviewTaskKind, row.taskKind, "task_kind_invalid"),
      providerKind: enumValue(
        ReviewExecutionProviderKind,
        row.providerKind,
        "provider_kind_invalid",
      ),
      providerVoteIdentityHash: text(row.providerVoteIdentityHash),
      shardKey: text(row.shardKey),
      required: boolean(row.required),
      attemptBudget: integer(row.attemptBudget),
      retryPolicyVersion: text(row.retryPolicyVersion),
    };
  });
}

export function parseManifest(value: string): ProviderInvocationManifest {
  const parsed = record(
    parseCanonicalJson(value, "manifest_invalid"),
    "manifest_invalid",
  );
  try {
    return normalizeProviderInvocationManifest(
      parsed as unknown as ProviderInvocationManifest,
    );
  } catch {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "manifest_invalid",
    );
  }
}

export function parsePayload(value: string): ReviewObservationPayload {
  const parsed = record(
    parseCanonicalJson(value, "payload_invalid"),
    "payload_invalid",
  );
  try {
    return prepareReviewObservationPayload(
      parsed as unknown as ReviewObservationPayload,
    ).payload;
  } catch {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "payload_invalid",
    );
  }
}

export function parseCanonicalJson(value: string, issue: string): unknown {
  try {
    const parsed: unknown = JSON.parse(value);
    if (stableJson(parsed as never) !== value) throw new Error();
    return parsed;
  } catch {
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      issue,
    );
  }
}

export function decimal(value: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "decimal_invalid",
    );
  return BigInt(value);
}

export function requireEqual<T>(left: T, right: T, issue: string): void {
  if (left !== right)
    throw failure(403, ReviewActionV2ProtocolErrorCode.Forbidden, issue);
}

export function required<T>(value: T | null | undefined, issue: string): T {
  if (value === null || value === undefined)
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      issue,
    );
  return value;
}

export function enumValue<T extends string>(
  values: Record<string, T>,
  value: unknown,
  issue: string,
): T {
  if (typeof value !== "string" || !Object.values(values).includes(value as T))
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      issue,
    );
  return value as T;
}

export function record(value: unknown, issue: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      issue,
    );
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  issue: string,
) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  )
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      issue,
    );
}

function text(value: unknown): string {
  if (typeof value !== "string")
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "string_invalid",
    );
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean")
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "boolean_invalid",
    );
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value))
    throw failure(
      422,
      ReviewActionV2ProtocolErrorCode.InvariantViolation,
      "integer_invalid",
    );
  return value;
}

export function add(date: Date, ms: number) {
  return new Date(date.getTime() + ms);
}

export function minDate(...values: readonly Date[]) {
  return new Date(Math.min(...values.map((v) => v.getTime())));
}

export function validateTiming(t: ReviewActionV2ExecutionTimingPolicy) {
  for (const value of Object.values(t))
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error("review_action_v2_execution_timing_invalid");
}

export function failure(
  statusCode: ConstructorParameters<typeof ReviewActionV2RouteFailure>[0],
  errorCode: ReviewActionV2ProtocolErrorCode,
  issue: string,
) {
  return new ReviewActionV2RouteFailure(statusCode, errorCode, [issue]);
}

export function assertCapturedReviewerManifest(
  authorization: ReviewRunAuthorization,
  slot: Pick<ReviewWorkSlotPlan, "providerVoteIdentityHash" | "providerKind">,
  manifest: ProviderInvocationManifest,
): void {
  const snapshot = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  if (snapshot?.snapshotVersion !== 4) return;
  const reviewer = snapshot.reviewers.find(
    (row) => row.providerVoteIdentityHash === slot.providerVoteIdentityHash,
  );
  if (
    !reviewer ||
    String(reviewAgentExecutionProviderKind(reviewer.agentProfile)) !==
      String(slot.providerKind) ||
    reviewer.requestedModel !== manifest.requestedModel
  )
    throw failure(
      403,
      ReviewActionV2ProtocolErrorCode.Forbidden,
      "manifest_reviewer_mismatch",
    );
}
