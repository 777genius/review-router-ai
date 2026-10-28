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
});
