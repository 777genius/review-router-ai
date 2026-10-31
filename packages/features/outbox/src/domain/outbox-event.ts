import { z } from "zod";

export const outboxEventStatusSchema = z.enum([
  "pending",
  "processing",
  "retry_wait",
  "processed",
  "dead_letter",
]);

export type OutboxEventStatus = z.infer<typeof outboxEventStatusSchema>;

export const outboxEventSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  version: z.number().int().min(1),
  idempotencyKey: z.string().min(1),
  workspaceId: z.string().nullable(),
  repositoryId: z.string().nullable(),
  aggregateId: z.string().nullable(),
  payload: z.unknown(),
  status: outboxEventStatusSchema,
  attempts: z.number().int().min(0),
  maxAttempts: z.number().int().min(1).max(20),
  nextAttemptAt: z.date().nullable(),
  claimId: z.string().min(1).nullable(),
  claimVersion: z.bigint().positive().nullable(),
  claimOwnerHash: z.string().min(1).nullable(),
  claimUntil: z.date().nullable(),
  occurredAt: z.date(),
});

export type OutboxEvent = z.infer<typeof outboxEventSchema>;

export const outboxFailureStatusSchema = z.enum([
  "processing",
  "retry_wait",
  "dead_letter",
]);

export type OutboxFailureStatus = z.infer<typeof outboxFailureStatusSchema>;

export type OutboxFailure = {
  readonly id: string;
  readonly type: string;
  readonly version: number;
  readonly workspaceId: string | null;
  readonly repositoryId: string | null;
  readonly status: OutboxFailureStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextAttemptAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly safeLastErrorSummary: string | null;
  readonly occurredAt: Date;
  readonly updatedAt: Date;
};

export type NewOutboxEvent = {
  readonly type: string;
  readonly version: number;
  readonly idempotencyKey: string;
  readonly workspaceId?: string | null;
  readonly repositoryId?: string | null;
  readonly aggregateId?: string | null;
  readonly payload: unknown;
  readonly maxAttempts?: number;
  readonly occurredAt: Date;
};

export class OutboxHandlerError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OutboxHandlerError";
  }
}

export type OutboxHandler = {
  readonly type: string;
  readonly version: number;
  handle(event: OutboxEvent): Promise<void>;
};

export type RetryDeadLetterOutboxEventResult =
  | { readonly status: "queued" }
  | { readonly status: "not_found" }
  | {
      readonly status: "not_dead_letter";
      readonly currentStatus: OutboxEventStatus;
    };

export type OutboxClaimTerm = {
  readonly claimId: string;
  readonly claimVersion: bigint;
  readonly claimOwnerHash: string;
  readonly claimUntil: Date;
};

export type OutboxHandlerDefinition = {
  readonly type: string;
  readonly version: number;
};

export type OutboxClaimTransitionResult =
  | { readonly status: "applied" }
  | { readonly status: "stale_claim" };

export const defaultOutboxProcessingStaleAfterMs = 15 * 60 * 1000;

export function outboxHandlerKey(type: string, version: number): string {
  return `${type}@v${version}`;
}

// Only reviewed, developer-defined diagnostics may be persisted. Even a lowercase
// identifier-shaped exception code could be a credential or private user input.
// Keep this bounded list in sync with the actual outbox handler contracts.
const safeOutboxHandlerErrorCodes = new Set<string>([
  "denied",
  "dispatch_cleanup_attempt_changed",
  "dispatch_cleanup_identity_conflict",
  "dispatch_cleanup_intent_missing",
  "dispatch_cleanup_intent_read_unavailable",
  "dispatch_cleanup_lookup_unavailable",
  "dispatch_cleanup_not_terminal",
  "dispatch_cleanup_payload_invalid",
  "dispatch_cleanup_run_unresolved",
  "dispatch_cleanup_target_binding_conflict",
  "dispatch_cleanup_target_binding_unavailable",
  "dispatch_cleanup_target_partial",
  "e2e_injected_permanent_failure",
  "e2e_permanent_failure",
  "github_mergeability_unknown",
  "github_review_request_ingress_envelope_invalid",
  "history_event_invalid",
  "history_fact_collision",
  "invalid_event_payload",
  "invalid_memory_knowledge_event",
  "invalid_skill_scan_event",
  "memory_conflict",
  "memory_deadline_exceeded",
  "memory_disabled",
  "memory_forbidden",
  "memory_incomplete_evidence",
  "memory_input_required",
  "memory_invalid_input",
  "memory_legacy_cutover_requires_disposition",
  "memory_not_found",
  "memory_quota_exceeded",
  "memory_unavailable",
  "memory_unknown_write",
  "memory_unsupported",
  "permission_denied",
  "rate_limited",
  "review_request_eligibility_unavailable",
  "review_request_ingress_envelope_invalid",
  "review_request_ingress_idempotency_conflict",
  "review_request_repository_invalid",
  "review_request_repository_projection_unavailable",
  "review_request_revision_merge_base_conflict",
  "review_request_revision_merge_base_unavailable",
  "review_request_revision_moved",
  "review_request_revision_pull_request_conflict",
  "review_request_revision_pull_request_unavailable",
  "review_request_revision_revision_moved",
  "review_v2_completion_artifact_conflict",
  "review_v2_finalized_event_invalid",
  "review_v2_finalized_facts_unavailable",
  "skill_scan_busy",
  "statistics_execution_collision",
  "statistics_invalid_query",
  "test_retry",
]);

export function safeOutboxErrorSummary(error: unknown): {
  readonly code: string;
  readonly summary: string;
  readonly retryable: boolean;
} {
  if (error instanceof OutboxHandlerError) {
    return {
      code: safeOutboxHandlerErrorCodes.has(error.code)
        ? error.code
        : "handler_error",
      // Provider and SDK exception messages can contain credentials, repository
      // payloads or full URL query strings. Only stable codes are durable.
      summary: "outbox_application_failure",
      retryable: error.retryable,
    };
  }

  return {
    code: "handler_error",
    summary: "outbox_handler_failure",
    retryable: true,
  };
}

export function nextOutboxRetryAt(input: {
  readonly attempts: number;
  readonly now: Date;
}): Date {
  const delaySeconds = Math.min(300, 2 ** Math.max(0, input.attempts - 1) * 5);
  return new Date(input.now.getTime() + delaySeconds * 1000);
}
