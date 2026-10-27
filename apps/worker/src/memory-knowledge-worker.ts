import { createHash } from "node:crypto";
import {
  MemoryKnowledgeError,
  memoryKnowledgeScopeKey,
  type MemoryKnowledgeScope,
  type MemoryKnowledgeService,
} from "@reviewrouter/features-memory";
import {
  OutboxHandlerError,
  type OutboxEvent,
  type OutboxHandler,
} from "@reviewrouter/features-outbox";

export const memoryKnowledgeCommandHandler = {
  type: "memory.knowledge.command.requested",
  version: 2,
} as const;

export const legacyMemoryOutboxHandlers = [
  "memory.item.created",
  "memory.item.deleted",
  "memory.item.disabled",
  "memory.item.edited",
  "memory.item.expired",
  "memory.suggestion.created",
  "memory.suggestion.confirmed",
  "memory.suggestion.rejected",
  "memory.embedding.reindex.requested",
  "memory.embedding.delete.requested",
].map((type) => ({ type, version: 1 }));

type WorkerService = Pick<
  MemoryKnowledgeService,
  | "deliver"
  | "expireDueEntries"
  | "expireDeliveryEnvelopes"
  | "scheduleDueDeliveries"
>;

/** Existing outbox owns retries. Workers never receive human management authority. */
export function createMemoryKnowledgeWorker(input: {
  readonly generation: string;
  readonly enabled: boolean;
  readonly service: WorkerService;
  readonly now: () => Date;
  readonly quarantineLegacy: (
    event: OutboxEvent,
    targetIdentityDigest: string | null,
  ) => Promise<void>;
  readonly warn: (
    message: string,
    metadata: Readonly<Record<string, unknown>>,
  ) => void;
  readonly intervalMs?: number;
  readonly batchSize?: number;
  readonly deliveryTimeoutMs?: number;
}): {
  readonly handlers: readonly OutboxHandler[];
  runMaintenance(): Promise<void>;
} {
  const intervalMs = input.intervalMs ?? 5_000;
  const batchSize = input.batchSize ?? 100;
  const timeoutMs = input.deliveryTimeoutMs ?? 20_000;
  if (
    !Number.isInteger(intervalMs) ||
    intervalMs < 100 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > 1000 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 100 ||
    timeoutMs > 60_000
  )
    throw new MemoryKnowledgeError("invalid_input");
  let lastAttemptAt = -Infinity;
  return {
    handlers: [
      {
        ...memoryKnowledgeCommandHandler,
        async handle(event) {
          const payload = deliveryPayload(event, input.generation);
          if (!input.enabled) throw retry("disabled");
          try {
            await input.service.deliver(payload, {
              deadlineAt: new Date(input.now().getTime() + timeoutMs),
              signal: AbortSignal.timeout(timeoutMs),
            });
          } catch (error) {
            // The facade has already retained unknown execution and a same-UUID
            // observation retry. Never copy a transport error into outbox metadata.
            throw retry(
              error instanceof MemoryKnowledgeError
                ? error.code
                : "unavailable",
            );
          }
        },
      },
      ...legacyMemoryOutboxHandlers.map((definition) => ({
        ...definition,
        async handle(event: OutboxEvent) {
          const value =
            event.payload && typeof event.payload === "object"
              ? (event.payload as Record<string, unknown>).targetIndexIdentity
              : undefined;
          const identity =
            typeof value === "string"
              ? createHash("sha256").update(value).digest("hex")
              : null;
          await input.quarantineLegacy(event, identity);
          throw new OutboxHandlerError(
            "Legacy memory event requires an explicit migration or remote cleanup disposition",
            "memory_legacy_cutover_requires_disposition",
            false,
          );
        },
      })),
    ],
    async runMaintenance() {
      const now = input.now().getTime();
      if (now - lastAttemptAt < intervalMs) return;
      lastAttemptAt = now;
      try {
        // Expiry fences and envelope retention continue even when native memory
        // is disabled. Neither task claims remote cleanup completed.
        await input.service.expireDueEntries(batchSize);
        await input.service.expireDeliveryEnvelopes(batchSize);
        if (input.enabled) await input.service.scheduleDueDeliveries(batchSize);
      } catch (error) {
        input.warn("ReviewRouter memory maintenance needs reconciliation", {
          safeReason:
            error instanceof MemoryKnowledgeError ? error.code : "unavailable",
        });
      }
    },
  };
}

function retry(
  code: string,
): OutboxHandlerError & { readonly preserveReconciliation: true } {
  return Object.assign(
    new OutboxHandlerError(
      "Memory delivery remains pending reconciliation",
      `memory_${code}`,
      true,
    ),
    { preserveReconciliation: true as const },
  );
}

function deliveryPayload(
  event: OutboxEvent,
  generation: string,
): {
  readonly scope: MemoryKnowledgeScope;
  readonly commandId: string;
} {
  try {
    if (
      !event.payload ||
      typeof event.payload !== "object" ||
      Array.isArray(event.payload)
    )
      throw new Error();
    const payload = event.payload as Record<string, unknown>;
    if (
      Object.keys(payload).some(
        (key) => !["commandId", "generation", "scope"].includes(key),
      ) ||
      payload.generation !== generation ||
      typeof payload.commandId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        payload.commandId,
      )
    )
      throw new Error();
    const scope = payload.scope as MemoryKnowledgeScope;
    memoryKnowledgeScopeKey(scope);
    const keys =
      scope.kind === "workspace"
        ? ["kind", "workspaceId"]
        : scope.kind === "repository"
          ? ["kind", "workspaceId", "repositoryId"]
          : ["kind", "workspaceId", "userId"];
    if (
      Object.keys(scope).some((key) => !keys.includes(key)) ||
      event.workspaceId !== scope.workspaceId ||
      (scope.kind === "repository" &&
        event.repositoryId !== null &&
        event.repositoryId !== scope.repositoryId) ||
      !event.aggregateId
    )
      throw new Error();
    return { scope, commandId: payload.commandId };
  } catch {
    throw new OutboxHandlerError(
      "Invalid memory delivery metadata",
      "invalid_memory_knowledge_event",
      false,
    );
  }
}
