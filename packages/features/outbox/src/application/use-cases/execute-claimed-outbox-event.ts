import type { Clock } from "@reviewrouter/shared";
import {
  nextOutboxRetryAt,
  safeOutboxErrorSummary,
  type OutboxClaimTerm,
  type OutboxEvent,
  type OutboxHandler,
} from "../../domain/outbox-event";
import type { OutboxEventRepositoryPort } from "../ports/outbox-event-repository-port";

type ClaimRepository = Pick<
  OutboxEventRepositoryPort,
  "renewClaim" | "markProcessed" | "markRetry" | "markDeadLetter"
>;

type Claim = Omit<OutboxClaimTerm, "claimUntil">;

type ExecutionResult =
  | "processed"
  | "retried"
  | "dead_lettered"
  | "stale_claim";

/** Internal owner of one acquired claim, from dispatch admission to settlement. */
export async function executeClaimedOutboxEvent(
  input: {
    readonly event: OutboxEvent;
    readonly handler: OutboxHandler | undefined;
    readonly processingLeaseMs: number;
    readonly heartbeatIntervalMs: number;
  },
  dependencies: {
    readonly outbox: ClaimRepository;
    readonly clock: Clock;
  },
): Promise<ExecutionResult> {
  const { event, handler } = input;
  const claim = requireClaim(event);
  // Storage failures leave ownership uncertain and must be visible to the batch.
  const renewed = await dependencies.outbox.renewClaim({
    ...claim,
    claimUntil: new Date(
      dependencies.clock.now().getTime() + input.processingLeaseMs,
    ),
  });
  if (renewed.status === "stale_claim") return "stale_claim";

  if (!handler) {
    const result = await dependencies.outbox.markDeadLetter({
      id: event.id,
      ...claim,
      deadLetteredAt: dependencies.clock.now(),
      errorCode: "unsupported_event_version",
      safeErrorSummary: `No handler registered for ${event.type}@v${event.version}`,
    });
    return result.status === "applied" ? "dead_lettered" : "stale_claim";
  }

  const heartbeat = startClaimHeartbeat({
    outbox: dependencies.outbox,
    clock: dependencies.clock,
    claim,
    processingLeaseMs: input.processingLeaseMs,
    heartbeatIntervalMs: input.heartbeatIntervalMs,
  });
  try {
    try {
      await handler.handle(event);
    } finally {
      // A throwing handler must also await the last renewal before its outcome.
      await heartbeat.stop();
    }
  } catch (error) {
    if (heartbeat.isStale()) return "stale_claim";
    const safeError = safeOutboxErrorSummary(error);
    const preserveReconciliation =
      error !== null &&
      typeof error === "object" &&
      (error as { readonly preserveReconciliation?: unknown })
        .preserveReconciliation === true;
    if (
      (event.attempts >= event.maxAttempts && !preserveReconciliation) ||
      !safeError.retryable
    ) {
      const result = await dependencies.outbox.markDeadLetter({
        id: event.id,
        ...claim,
        deadLetteredAt: dependencies.clock.now(),
        errorCode: safeError.code,
        safeErrorSummary: safeError.summary,
      });
      return result.status === "applied" ? "dead_lettered" : "stale_claim";
    }
    const result = await dependencies.outbox.markRetry({
      id: event.id,
      ...claim,
      nextAttemptAt: nextOutboxRetryAt({
        attempts: event.attempts,
        now: dependencies.clock.now(),
      }),
      errorCode: safeError.code,
      safeErrorSummary: safeError.summary,
    });
    return result.status === "applied" ? "retried" : "stale_claim";
  }

  if (heartbeat.isStale()) return "stale_claim";
  try {
    const result = await dependencies.outbox.markProcessed({
      id: event.id,
      ...claim,
      processedAt: dependencies.clock.now(),
    });
    return result.status === "applied" ? "processed" : "stale_claim";
  } catch {
    // The handler completed; an uncertain settlement belongs to lease recovery.
    return "stale_claim";
  }
}

function requireClaim(event: OutboxEvent): Claim {
  if (!event.claimId || event.claimVersion === null || !event.claimOwnerHash) {
    throw new Error("outbox_claim_term_missing");
  }
  return {
    claimId: event.claimId,
    claimVersion: event.claimVersion,
    claimOwnerHash: event.claimOwnerHash,
  };
}

function startClaimHeartbeat(input: {
  readonly outbox: Pick<ClaimRepository, "renewClaim">;
  readonly clock: Clock;
  readonly claim: Claim;
  readonly processingLeaseMs: number;
  readonly heartbeatIntervalMs: number;
}): { readonly stop: () => Promise<void>; readonly isStale: () => boolean } {
  let stopped = false;
  let stale = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let currentRenewal = Promise.resolve();

  const renew = () => {
    if (stopped) return;
    currentRenewal = (async () => {
      const result = await input.outbox.renewClaim({
        ...input.claim,
        claimUntil: new Date(
          input.clock.now().getTime() + input.processingLeaseMs,
        ),
      });
      stale ||= result.status === "stale_claim";
    })()
      .catch(() => {
        // An uncertain renewal cannot authorize a subsequent outcome.
        stale = true;
      })
      .finally(() => {
        if (!stopped && !stale) schedule();
      });
  };

  const schedule = () => {
    timer = setTimeout(renew, input.heartbeatIntervalMs);
    timer.unref?.();
  };

  schedule();
  return {
    isStale: () => stale,
    stop: async () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      await currentRenewal;
    },
  };
}
