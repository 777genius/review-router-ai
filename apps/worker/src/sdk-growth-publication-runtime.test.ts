import { describe, expect, it } from "vitest";
import {
  InMemoryOutboxEventRepository,
  processOutboxBatch,
} from "@reviewrouter/features-outbox";
import {
  SdkGrowthPublicationRuntime,
  type SdkGrowthClaimedEvent,
} from "./sdk-growth-publication-runtime";

const event: SdkGrowthClaimedEvent = {
  id: "event-1",
  type: "sdk_growth.publication_requested",
  version: 1,
  idempotencyKey: "intent-1",
  payload: {
    intentId: "intent-1",
    envelopeDigest: "a".repeat(64),
  },
  claimId: "claim-1",
  claimVersion: 7n,
  claimOwnerHash: "owner",
};

describe("SdkGrowthPublicationRuntime", () => {
  it("links the claimed event before invoking the application port", async () => {
    const order: string[] = [];
    const runtime = new SdkGrowthPublicationRuntime(
      {
        async run(input) {
          order.push("run");
          expect(input).toMatchObject({
            intentId: "intent-1",
            claim: {
              eventId: "event-1",
              claimId: "claim-1",
              claimVersion: 7n,
            },
          });
          return "applied";
        },
      },
      {
        async linkClaimedEvent() {
          order.push("link");
          return "linked";
        },
        async recover() {
          return { linked: 0, failed: 0 };
        },
      },
    );

    await expect(
      runtime.handle(event, new AbortController().signal),
    ).resolves.toBeUndefined();
    expect(order).toEqual(["link", "run"]);
  });

  it.each(["retry", "stale-claim", "missing"] as const)(
    "keeps %s retryable",
    async (result) => {
      const runtime = new SdkGrowthPublicationRuntime(
        {
          async run() {
            return result;
          },
        },
        {
          async linkClaimedEvent() {
            return "already-linked";
          },
          async recover() {
            return { linked: 0, failed: 0 };
          },
        },
      );
      await expect(
        runtime.handle(event, new AbortController().signal),
      ).rejects.toEqual(
        expect.objectContaining({
          code: result,
          retryable: true,
        }),
      );
    },
  );

  it("treats exhausted reconciliation as a processed terminal result", async () => {
    const runtime = new SdkGrowthPublicationRuntime(
      {
        async run() {
          return "recovery-required";
        },
      },
      {
        async linkClaimedEvent() {
          return "already-linked";
        },
        async recover() {
          return { linked: 0, failed: 0 };
        },
      },
    );

    await expect(
      runtime.handle(event, new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it("processes durable recovery on the twentieth delivery instead of dead-lettering it", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    let now = new Date("2026-09-19T00:00:00.000Z");
    let reconciliationCount = 0;
    let durableOutcome: "recovery-required" | null = null;
    const runtime = new SdkGrowthPublicationRuntime(
      {
        async run() {
          reconciliationCount += 1;
          if (reconciliationCount < 20) return "retry";
          durableOutcome = "recovery-required";
          return durableOutcome;
        },
      },
      {
        async linkClaimedEvent() {
          return "already-linked";
        },
        async recover() {
          return { linked: 0, failed: 0 };
        },
      },
    );
    await outbox.enqueue({
      type: event.type,
      version: event.version,
      idempotencyKey: event.idempotencyKey,
      payload: event.payload,
      maxAttempts: 20,
      occurredAt: now,
    });
    const handler = {
      ...runtime.handlerDefinition,
      handle: (claimed: Parameters<typeof runtime.handle>[0]) =>
        runtime.handle(claimed, new AbortController().signal),
    };

    for (let delivery = 1; delivery <= 20; delivery += 1) {
      const result = await processOutboxBatch(
        {
          limit: 1,
          handlers: [handler],
          claimOwnerHash: "worker-sdk-growth",
        },
        { outbox, clock: { now: () => now } },
      );
      if (delivery < 20) {
        expect(result).toMatchObject({ retried: 1, deadLettered: 0 });
      } else {
        expect(result).toMatchObject({ processed: 1, deadLettered: 0 });
      }
      now = new Date(now.getTime() + 10 * 60 * 1_000);
    }

    expect(durableOutcome).toBe("recovery-required");
    expect(outbox.events.get(event.idempotencyKey)).toMatchObject({
      status: "processed",
      attempts: 20,
      lastErrorCode: null,
    });
  });

  it("preserves reconciliation when linking throws after the delivery budget is exhausted", async () => {
    const outbox = new InMemoryOutboxEventRepository();
    const runtime = new SdkGrowthPublicationRuntime(
      {
        async run() {
          return "applied";
        },
      },
      {
        async linkClaimedEvent() {
          throw new Error("database temporarily unavailable");
        },
        async recover() {
          return { linked: 0, failed: 0 };
        },
      },
    );
    await outbox.enqueue({ ...event, maxAttempts: 1, occurredAt: new Date() });
    const result = await processOutboxBatch(
      {
        limit: 1,
        handlers: [
          {
            ...runtime.handlerDefinition,
            handle: (claimed) =>
              runtime.handle(claimed, new AbortController().signal),
          },
        ],
        claimOwnerHash: "worker",
      },
      { outbox, clock: { now: () => new Date() } },
    );
    expect(result).toMatchObject({ retried: 1, deadLettered: 0 });
  });

  it("rejects an event without a complete claim before any fake port call", async () => {
    let called = false;
    const runtime = new SdkGrowthPublicationRuntime(
      {
        async run() {
          called = true;
          return "applied";
        },
      },
      {
        async linkClaimedEvent() {
          called = true;
          return "linked";
        },
        async recover() {
          return { linked: 0, failed: 0 };
        },
      },
    );

    await expect(
      runtime.handle(
        { ...event, claimVersion: null },
        new AbortController().signal,
      ),
    ).rejects.toThrow("sdk_growth_claimed_event_invalid");
    expect(called).toBe(false);
  });

  it("exposes maintenance without registering production wiring", async () => {
    const runtime = new SdkGrowthPublicationRuntime(
      {
        async run() {
          return "applied";
        },
      },
      {
        async linkClaimedEvent() {
          return "linked";
        },
        async recover(limit) {
          expect(limit).toBe(25);
          return { linked: 3, failed: 1 };
        },
      },
    );

    await expect(runtime.recoverUnqueued(25)).resolves.toEqual({
      linked: 3,
      failed: 1,
    });
    expect(runtime.handlerDefinition).toEqual({
      type: "sdk_growth.publication_requested",
      version: 1,
    });
  });
});
