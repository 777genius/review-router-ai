import type { Clock } from "@reviewrouter/shared";
import {
  defaultOutboxProcessingStaleAfterMs,
  outboxHandlerKey,
  type OutboxHandler,
  type OutboxHandlerDefinition,
} from "../../domain/outbox-event";
import type { OutboxEventRepositoryPort } from "../ports/outbox-event-repository-port";
import { executeClaimedOutboxEvent } from "./execute-claimed-outbox-event";

export type ProcessOutboxBatchResult = {
  readonly recoveredStale: number;
  readonly claimed: number;
  readonly processed: number;
  readonly retried: number;
  readonly deadLettered: number;
  readonly staleClaims: number;
};

export async function processOutboxBatch(
  input: {
    /** Maximum claims in this bounded drain, including stale claims. */
    readonly limit: number;
    readonly handlers: readonly OutboxHandler[];
    readonly knownHandlers?: readonly OutboxHandlerDefinition[];
    readonly claimOwnerHash: string;
    readonly processingLeaseMs?: number;
    readonly heartbeatIntervalMs?: number;
    readonly takeoverEnabled?: boolean;
    readonly recoveryEventTypes?: readonly string[];
  },
  dependencies: {
    readonly outbox: OutboxEventRepositoryPort;
    readonly clock: Clock;
  },
): Promise<ProcessOutboxBatchResult> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 0) {
    throw new Error("outbox_batch_limit_invalid");
  }
  const now = dependencies.clock.now();
  const processingLeaseMs =
    input.processingLeaseMs ?? defaultOutboxProcessingStaleAfterMs;
  const recoveredStale = input.takeoverEnabled
    ? await dependencies.outbox.recoverStaleProcessing({
        ...(input.recoveryEventTypes === undefined
          ? {}
          : { eventTypes: input.recoveryEventTypes }),
        now,
        legacyStaleBefore: new Date(now.getTime() - processingLeaseMs),
        nextAttemptAt: now,
        limit: input.limit,
        errorCode: "processing_stale",
        safeErrorSummary: `Processing claim expired after ${processingLeaseMs}ms and was requeued for retry.`,
      })
    : { recovered: 0 };
  const handlers = new Map(
    input.handlers.map((handler) => [
      outboxHandlerKey(handler.type, handler.version),
      handler,
    ]),
  );
  let claimed = 0;
  let processed = 0;
  let retried = 0;
  let deadLettered = 0;
  let staleClaims = 0;

  while (claimed < input.limit) {
    // Do not reserve work behind a running handler without owning its lease.
    const [event] = await dependencies.outbox.claimDue({
      limit: 1,
      now: dependencies.clock.now(),
      claimOwnerHash: input.claimOwnerHash,
      claimForMs: processingLeaseMs,
      availableHandlers: input.handlers,
      knownHandlers: input.knownHandlers ?? input.handlers,
    });
    if (!event) break;
    claimed += 1;
    const result = await executeClaimedOutboxEvent(
      {
        event,
        handler: handlers.get(outboxHandlerKey(event.type, event.version)),
        processingLeaseMs,
        heartbeatIntervalMs:
          input.heartbeatIntervalMs ?? Math.max(1_000, processingLeaseMs / 3),
      },
      dependencies,
    );
    switch (result) {
      case "processed":
        processed += 1;
        break;
      case "retried":
        retried += 1;
        break;
      case "dead_lettered":
        deadLettered += 1;
        break;
      case "stale_claim":
        staleClaims += 1;
        break;
    }
  }

  return {
    recoveredStale: recoveredStale.recovered,
    claimed,
    processed,
    retried,
    deadLettered,
    staleClaims,
  };
}
