import { afterEach, describe, expect, it, vi } from "vitest";
import { processOutboxBatch } from "../application/use-cases/process-outbox-batch";
import {
  OutboxHandlerError,
  type OutboxClaimTransitionResult,
  type OutboxHandler,
} from "../domain/outbox-event";
import { InMemoryOutboxEventRepository } from "../infrastructure/memory/in-memory-outbox-event-repository";

const start = new Date("2026-10-30T12:00:00.000Z");
const definition = { type: "outbox.execution.test", version: 1 };

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("outbox execution ownership", () => {
  it.each([NaN, Infinity, -Infinity, 1.5, -1, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid batch limit %s before touching the repository",
    async (limit) => {
      const outbox = new InMemoryOutboxEventRepository();
      const recovery = vi.spyOn(outbox, "recoverStaleProcessing");
      const claim = vi.spyOn(outbox, "claimDue");
      await expect(
        processOutboxBatch(
          {
            limit,
            handlers: [],
            claimOwnerHash: "worker",
            takeoverEnabled: true,
          },
          { outbox, clock: { now: () => start } },
        ),
      ).rejects.toThrow("outbox_batch_limit_invalid");
      expect(recovery).not.toHaveBeenCalled();
      expect(claim).not.toHaveBeenCalled();
    },
  );

  it("preserves a zero batch limit without claiming work", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    await seed(outbox, "pending");
    const claim = vi.spyOn(outbox, "claimDue");
    expect(
      await processOutboxBatch(
        {
          limit: 0,
          handlers: [{ ...definition, handle: async () => undefined }],
          claimOwnerHash: "worker",
          takeoverEnabled: true,
        },
        { outbox, clock: { now: () => start } },
      ),
    ).toEqual({
      recoveredStale: 0,
      claimed: 0,
      processed: 0,
      retried: 0,
      deadLettered: 0,
      staleClaims: 0,
    });
    expect(claim).not.toHaveBeenCalled();
    expect(outbox.events.get("pending")).toMatchObject({ status: "pending" });
  });

  it("leaves unstarted work available to another worker behind a blocked handler", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(start);
    const outbox = new InMemoryOutboxEventRepository();
    await seed(outbox, "first", "second");
    const started = deferred<void>();
    const release = deferred<void>();
    const handled: string[] = [];
    const handler: OutboxHandler = {
      ...definition,
      async handle(event) {
        handled.push(`${event.id}:${event.claimOwnerHash}`);
        if (event.id === "first") {
          started.resolve();
          await release.promise;
        }
      },
    };
    const dependencies = { outbox, clock: { now: () => new Date() } };
    const firstWorker = processOutboxBatch(
      {
        limit: 2,
        handlers: [handler],
        claimOwnerHash: "first-worker",
        processingLeaseMs: 100,
        heartbeatIntervalMs: 25,
      },
      dependencies,
    );
    await started.promise;
    let firstResult;
    try {
      expect(outbox.events.get("second")).toMatchObject({
        status: "pending",
        attempts: 0,
        claimId: null,
      });
      // The first handler remains active beyond its original lease.
      await vi.advanceTimersByTimeAsync(150);
      const secondResult = await processOutboxBatch(
        {
          limit: 2,
          handlers: [handler],
          claimOwnerHash: "second-worker",
          processingLeaseMs: 100,
          takeoverEnabled: true,
        },
        dependencies,
      );
      expect(secondResult).toMatchObject({
        recoveredStale: 0,
        claimed: 1,
        processed: 1,
        staleClaims: 0,
      });
    } finally {
      release.resolve();
      firstResult = await firstWorker;
    }
    expect(firstResult).toMatchObject({ claimed: 1, processed: 1 });
    expect(handled).toEqual(["first:first-worker", "second:second-worker"]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not invoke a handler after takeover between acquisition and dispatch", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    await seed(outbox, "taken-over");
    let now = start;
    const claimDue = outbox.claimDue.bind(outbox);
    vi.spyOn(outbox, "claimDue").mockImplementationOnce(async (input) => {
      const oldClaims = await claimDue(input);
      now = new Date(start.getTime() + 101);
      await outbox.recoverStaleProcessing({
        now,
        legacyStaleBefore: start,
        nextAttemptAt: now,
        limit: 1,
        errorCode: "processing_stale",
        safeErrorSummary: "test takeover",
      });
      await claimDue({ ...input, now, claimOwnerHash: "replacement-worker" });
      return oldClaims;
    });
    const handle = vi.fn(async () => undefined);
    const result = await processOutboxBatch(
      {
        limit: 1,
        handlers: [{ ...definition, handle }],
        claimOwnerHash: "original-worker",
        processingLeaseMs: 100,
      },
      { outbox, clock: { now: () => now } },
    );
    expect(handle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ claimed: 1, processed: 0, staleClaims: 1 });
    expect(outbox.events.get("taken-over")).toMatchObject({
      status: "processing",
      claimOwnerHash: "replacement-worker",
      attempts: 2,
    });
  });

  it("renews an expired but otherwise current claim before dispatch", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    await seed(outbox, "expired-current");
    let now = start;
    const claimDue = outbox.claimDue.bind(outbox);
    vi.spyOn(outbox, "claimDue").mockImplementationOnce(async (input) => {
      const claims = await claimDue(input);
      now = new Date(start.getTime() + 101);
      return claims;
    });
    const handle = vi.fn(async () => undefined);
    expect(
      await processOutboxBatch(
        {
          limit: 1,
          handlers: [{ ...definition, handle }],
          claimOwnerHash: "worker",
          processingLeaseMs: 100,
        },
        { outbox, clock: { now: () => now } },
      ),
    ).toMatchObject({ processed: 1, staleClaims: 0 });
    expect(handle).toHaveBeenCalledOnce();
  });

  it.each(["refused", "failed"])(
    "suppresses dispatch and leaves recovery responsible when initial renewal is %s",
    async (failure) => {
      const outbox = new InMemoryOutboxEventRepository();
      await seed(outbox, "unconfirmed");
      const renew = vi.spyOn(outbox, "renewClaim");
      if (failure === "refused") {
        renew.mockResolvedValueOnce({ status: "stale_claim" });
      } else {
        renew.mockRejectedValueOnce(new Error("storage unavailable"));
      }
      const handle = vi.fn(async () => undefined);
      const result = await processOutboxBatch(
        {
          limit: 1,
          handlers: [{ ...definition, handle }],
          claimOwnerHash: "worker",
        },
        { outbox, clock: { now: () => start } },
      );
      expect(handle).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        claimed: 1,
        processed: 0,
        retried: 0,
        deadLettered: 0,
        staleClaims: 1,
      });
      expect(outbox.events.get("unconfirmed")).toMatchObject({
        status: "processing",
        claimOwnerHash: "worker",
      });
    },
  );

  it("bounds stale claims without reserving the next event", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    await seed(outbox, "first", "second", "third");
    vi.spyOn(outbox, "renewClaim").mockResolvedValue({ status: "stale_claim" });
    const handle = vi.fn(async () => undefined);
    expect(
      await processOutboxBatch(
        {
          limit: 2,
          handlers: [{ ...definition, handle }],
          claimOwnerHash: "worker",
        },
        { outbox, clock: { now: () => start } },
      ),
    ).toMatchObject({ claimed: 2, staleClaims: 2 });
    expect(handle).not.toHaveBeenCalled();
    expect(outbox.events.get("third")).toMatchObject({
      status: "pending",
      attempts: 0,
    });
  });

  it("reads fresh time for each claim in a bounded drain", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    await seed(outbox, "first", "second");
    let now = start;
    const claimDue = vi.spyOn(outbox, "claimDue");
    await processOutboxBatch(
      {
        limit: 2,
        claimOwnerHash: "worker",
        handlers: [
          {
            ...definition,
            async handle() {
              now = new Date(now.getTime() + 1_000);
            },
          },
        ],
      },
      { outbox, clock: { now: () => now } },
    );
    expect(claimDue.mock.calls.map(([input]) => input.now.getTime())).toEqual([
      start.getTime(),
      start.getTime() + 1_000,
    ]);
  });

  it.each(["claimId", "claimVersion", "claimOwnerHash"] as const)(
    "rejects a missing persisted %s before renewal or dispatch",
    async (field) => {
      const outbox = new InMemoryOutboxEventRepository();
      await seed(outbox, "incomplete");
      const claimDue = outbox.claimDue.bind(outbox);
      vi.spyOn(outbox, "claimDue").mockImplementationOnce(async (input) =>
        (await claimDue(input)).map((event) => ({ ...event, [field]: null })),
      );
      const renew = vi.spyOn(outbox, "renewClaim");
      const handle = vi.fn(async () => undefined);
      await expect(
        processOutboxBatch(
          {
            limit: 1,
            handlers: [{ ...definition, handle }],
            claimOwnerHash: "worker",
          },
          { outbox, clock: { now: () => start } },
        ),
      ).rejects.toThrow("outbox_claim_term_missing");
      expect(renew).not.toHaveBeenCalled();
      expect(handle).not.toHaveBeenCalled();
    },
  );

  it.each([
    { handlerFails: false, renewal: "applied", outcome: "processed" },
    { handlerFails: true, renewal: "applied", outcome: "retried" },
    { handlerFails: false, renewal: "stale_claim", outcome: "staleClaims" },
    { handlerFails: true, renewal: "stale_claim", outcome: "staleClaims" },
    { handlerFails: false, renewal: "failed", outcome: "staleClaims" },
    { handlerFails: true, renewal: "failed", outcome: "staleClaims" },
  ] as const)(
    "awaits an in-flight $renewal heartbeat before $outcome (handlerFails=$handlerFails)",
    async ({ handlerFails, renewal, outcome }) => {
      vi.useFakeTimers();
      vi.setSystemTime(start);
      const outbox = new InMemoryOutboxEventRepository();
      await seed(outbox, "active");
      const started = deferred<void>();
      const releaseHandler = deferred<void>();
      const finishRenewal = deferred<OutboxClaimTransitionResult>();
      const renewClaim = outbox.renewClaim.bind(outbox);
      const renew = vi
        .spyOn(outbox, "renewClaim")
        .mockImplementationOnce(renewClaim)
        .mockImplementationOnce(() => finishRenewal.promise);
      const markProcessed = vi.spyOn(outbox, "markProcessed");
      const markRetry = vi.spyOn(outbox, "markRetry");
      const markDeadLetter = vi.spyOn(outbox, "markDeadLetter");
      const batch = processOutboxBatch(
        {
          limit: 1,
          claimOwnerHash: "worker",
          processingLeaseMs: 100,
          heartbeatIntervalMs: 10,
          handlers: [
            {
              ...definition,
              async handle() {
                started.resolve();
                await releaseHandler.promise;
                if (handlerFails) throw new Error("handler unavailable");
              },
            },
          ],
        },
        { outbox, clock: { now: () => new Date() } },
      );
      await started.promise;
      await vi.advanceTimersByTimeAsync(10);
      expect(renew).toHaveBeenCalledTimes(2);
      releaseHandler.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(markProcessed).not.toHaveBeenCalled();
      expect(markRetry).not.toHaveBeenCalled();
      expect(markDeadLetter).not.toHaveBeenCalled();
      if (renewal === "failed")
        finishRenewal.reject(new Error("storage unavailable"));
      else finishRenewal.resolve({ status: renewal });
      expect(await batch).toMatchObject({ claimed: 1, [outcome]: 1 });
      if (outcome === "staleClaims") {
        expect(markProcessed).not.toHaveBeenCalled();
        expect(markRetry).not.toHaveBeenCalled();
        expect(markDeadLetter).not.toHaveBeenCalled();
        expect(outbox.events.get("active")).toMatchObject({
          status: "processing",
        });
      }
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(200);
      expect(renew).toHaveBeenCalledTimes(2);
    },
  );

  it.each([1, 3])(
    "leaves a failed successful-handler settlement to recovery (maxAttempts=%s)",
    async (maxAttempts) => {
      const outbox = new InMemoryOutboxEventRepository();
      await outbox.enqueue({
        ...definition,
        idempotencyKey: "settlement-failed",
        payload: {},
        occurredAt: start,
        maxAttempts,
      });
      const handle = vi.fn(async () => undefined);
      const markProcessed = vi
        .spyOn(outbox, "markProcessed")
        .mockRejectedValueOnce(new Error("storage unavailable"));
      const markRetry = vi.spyOn(outbox, "markRetry");
      const markDeadLetter = vi.spyOn(outbox, "markDeadLetter");

      const result = await processOutboxBatch(
        {
          limit: 1,
          claimOwnerHash: "worker",
          handlers: [{ ...definition, handle }],
        },
        { outbox, clock: { now: () => start } },
      );

      expect(result).toMatchObject({
        claimed: 1,
        processed: 0,
        retried: 0,
        deadLettered: 0,
        staleClaims: 1,
      });
      expect(handle).toHaveBeenCalledOnce();
      expect(markProcessed).toHaveBeenCalledOnce();
      expect(markRetry).not.toHaveBeenCalled();
      expect(markDeadLetter).not.toHaveBeenCalled();
      expect(outbox.events.get("settlement-failed")).toMatchObject({
        status: "processing",
        attempts: 1,
      });
    },
  );

  it.each([false, true])(
    "retains the exhausted delivery policy (preserveReconciliation=%s)",
    async (preserveReconciliation) => {
      const outbox = new InMemoryOutboxEventRepository();
      await outbox.enqueue({
        ...definition,
        idempotencyKey: "exhausted",
        payload: {},
        occurredAt: start,
        maxAttempts: 1,
      });
      const result = await processOutboxBatch(
        {
          limit: 1,
          claimOwnerHash: "worker",
          handlers: [
            {
              ...definition,
              async handle() {
                throw Object.assign(
                  new OutboxHandlerError("retry", "test_retry", true),
                  { preserveReconciliation },
                );
              },
            },
          ],
        },
        { outbox, clock: { now: () => start } },
      );
      expect(result).toMatchObject({
        retried: preserveReconciliation ? 1 : 0,
        deadLettered: preserveReconciliation ? 0 : 1,
      });
    },
  );
});

async function seed(outbox: InMemoryOutboxEventRepository, ...ids: string[]) {
  for (const idempotencyKey of ids) {
    await outbox.enqueue({
      ...definition,
      idempotencyKey,
      payload: {},
      occurredAt: start,
    });
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
