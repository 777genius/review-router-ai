import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { quarantineGatewayObservation } from "./provider-usage-quarantine";
const safe = {
  schemaVersion: 1 as const,
  eventId: "event",
  revision: 1,
  executionRef: "exec",
  requestRef: "request",
  invocationRef: "invocation",
  attemptRef: "attempt",
  accountRef: "account",
  profileId: "profile",
  model: "model",
  occurredAt: new Date().toISOString(),
  effect: "completed" as const,
  completeness: "partial" as const,
  inputTokens: 1,
  outputTokens: 1,
  cachedInputTokens: null,
  reasoningTokens: null,
  cost: null,
};
describe("safe native quarantine", () => {
  it("refuses arbitrary raw upstream payload before durable storage", async () => {
    const upsert = vi.fn();
    const prisma = {
      usageUnattributedObservation: { upsert },
    } as unknown as PrismaClient;
    await expect(
      quarantineGatewayObservation(prisma, "native", {
        ...safe,
        prompt: "never persist",
      } as never),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
  it("detects same-event changed payload rather than overwriting it", async () => {
    const upsert = vi.fn(async () => ({ hash: "other" }));
    const prisma = {
      usageUnattributedObservation: { upsert },
    } as unknown as PrismaClient;
    await expect(
      quarantineGatewayObservation(prisma, "native", safe),
    ).rejects.toThrow("usage_hash_conflict");
    expect(upsert.mock.calls).toHaveLength(1);
  });
  it("retains a validated v2 observation across the installed SDK validator boundary", async () => {
    const upsert = vi.fn(async ({ create }: { create: { hash: string } }) => ({
      hash: create.hash,
    }));
    const prisma = {
      usageUnattributedObservation: { upsert },
    } as unknown as PrismaClient;
    const observation = {
      ...safe,
      schemaVersion: 2 as const,
      nativeContext: null,
      cost: { currency: "USD", amountDecimal: "0.001" },
    };
    await quarantineGatewayObservation(prisma, "native", observation);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ payload: observation }),
        update: {},
      }),
    );
  });
  it("keeps the SDK v2 rejection of extra upstream fields before persistence", async () => {
    const upsert = vi.fn();
    const prisma = {
      usageUnattributedObservation: { upsert },
    } as unknown as PrismaClient;
    await expect(
      quarantineGatewayObservation(prisma, "native", {
        ...safe,
        schemaVersion: 2,
        nativeContext: null,
        prompt: "never persist",
      } as never),
    ).rejects.toThrow();
    expect(upsert).not.toHaveBeenCalled();
  });
});
