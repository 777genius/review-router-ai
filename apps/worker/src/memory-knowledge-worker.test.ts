import { describe, expect, it, vi } from "vitest";
import { MemoryKnowledgeError } from "@reviewrouter/features-memory";
import type { OutboxEvent } from "@reviewrouter/features-outbox";
import {
  createMemoryKnowledgeWorker,
  legacyMemoryOutboxHandlers,
} from "./memory-knowledge-worker";

const now = new Date("2026-10-23T10:00:00.000Z");
const scope = {
  kind: "repository" as const,
  workspaceId: "workspace",
  repositoryId: "repository",
};
const event = (overrides: Partial<OutboxEvent> = {}): OutboxEvent => ({
  id: "event",
  type: "memory.knowledge.command.requested",
  version: 2,
  idempotencyKey: "delivery",
  workspaceId: scope.workspaceId,
  repositoryId: scope.repositoryId,
  aggregateId: "mem_entry",
  payload: {
    scope,
    generation: "generation",
    commandId: "11111111-1111-4111-8111-111111111111",
  },
  status: "processing",
  attempts: 1,
  maxAttempts: 5,
  nextAttemptAt: null,
  claimId: "claim",
  claimVersion: 1n,
  claimOwnerHash: "owner",
  claimUntil: new Date(now.getTime() + 30000),
  occurredAt: now,
  ...overrides,
});
function fixture(enabled = true) {
  const service = {
    deliver: vi.fn(async () => null),
    expireDueEntries: vi.fn(async () => 1),
    expireDeliveryEnvelopes: vi.fn(async () => 1),
    scheduleDueDeliveries: vi.fn(async () => 1),
  };
  const quarantineLegacy = vi.fn(async () => {});
  const warn = vi.fn();
  const worker = createMemoryKnowledgeWorker({
    generation: "generation",
    enabled,
    service,
    now: () => now,
    quarantineLegacy,
    warn,
  });
  return { worker, service, quarantineLegacy, warn };
}
describe("provider-neutral memory worker", () => {
  it("delivers only stored command identity with a bounded native deadline", async () => {
    const { worker, service } = fixture();
    await worker.handlers[0]!.handle(event());
    expect(service.deliver).toHaveBeenCalledWith(
      { scope, commandId: "11111111-1111-4111-8111-111111111111" },
      expect.objectContaining({
        deadlineAt: new Date(now.getTime() + 20000),
        signal: expect.any(AbortSignal),
      }),
    );
  });
  it("rejects wrong generation, cross-workspace and raw payload before native access", async () => {
    const { worker, service } = fixture();
    for (const invalid of [
      event({ workspaceId: "other" }),
      event({
        payload: { ...(event().payload as object), generation: "other" },
      }),
      event({
        payload: {
          ...(event().payload as object),
          body: "raw unapproved text",
        },
      }),
    ]) {
      await expect(worker.handlers[0]!.handle(invalid)).rejects.toMatchObject({
        code: "invalid_memory_knowledge_event",
        retryable: false,
      });
    }
    expect(service.deliver).not.toHaveBeenCalled();
  });
  it("keeps unknown delivery reconciliation retryable without persisting native error text", async () => {
    const { worker, service } = fixture();
    service.deliver.mockRejectedValue(
      new Error("credential=private-transport-error"),
    );
    await expect(worker.handlers[0]!.handle(event())).rejects.toMatchObject({
      code: "memory_unavailable",
      retryable: true,
      preserveReconciliation: true,
    });
    await expect(worker.handlers[0]!.handle(event())).rejects.not.toThrow(
      "private-transport-error",
    );
    service.deliver.mockRejectedValue(
      new MemoryKnowledgeError("unknown_write", true),
    );
    await expect(worker.handlers[0]!.handle(event())).rejects.toMatchObject({
      code: "memory_unknown_write",
    });
  });
  it("quarantines every legacy type with metadata before requiring operator disposition", async () => {
    const { worker, quarantineLegacy, service } = fixture();
    expect(legacyMemoryOutboxHandlers).toHaveLength(10);
    for (const handler of worker.handlers.slice(1)) {
      const legacy = event({
        type: handler.type,
        version: 1,
        payload: {
          targetIndexIdentity: "old-native-target",
          body: "never copy this body",
        },
      });
      await expect(handler.handle(legacy)).rejects.toMatchObject({
        code: "memory_legacy_cutover_requires_disposition",
        retryable: false,
      });
      expect(quarantineLegacy).toHaveBeenLastCalledWith(
        legacy,
        expect.stringMatching(/^[a-f0-9]{64}$/),
      );
    }
    expect(service.deliver).not.toHaveBeenCalled();
  });
  it("continues expiry fences and envelope cleanup while disabled and avoids native recovery", async () => {
    const { worker, service } = fixture(false);
    await worker.runMaintenance();
    await worker.runMaintenance();
    expect(service.expireDueEntries).toHaveBeenCalledTimes(1);
    expect(service.expireDeliveryEnvelopes).toHaveBeenCalledTimes(1);
    expect(service.scheduleDueDeliveries).not.toHaveBeenCalled();
    await expect(worker.handlers[0]!.handle(event())).rejects.toMatchObject({
      code: "memory_disabled",
      preserveReconciliation: true,
    });
    expect(service.deliver).not.toHaveBeenCalled();
  });
});
