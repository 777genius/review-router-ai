import { describe, expect, it } from "vitest";
import {
  createGatewayUsageSource,
  gatewayUsageCallId,
  type GatewayUsageObservation,
} from "./provider-usage-gateway-source";
import type { UsageIdentity } from "@reviewrouter/features-provider-usage";
const identity: UsageIdentity = {
  callId: gatewayUsageCallId("execution", "request"),
  workspaceId: "workspace",
  repositoryId: "123",
  actorId: null,
  runId: "456",
  runAttempt: 1,
  invocationId: "invocation",
  attemptId: "attempt",
  bindingId: "binding",
  authorizationId: "authorization",
  route: "gateway",
  purpose: "review",
  provider: "openai",
  requestedModel: "model",
  runtimeType: "codex",
  parentScope: null,
  granularity: "call",
  occurredAt: "2026-10-21T00:00:00.000Z",
};
const observation: GatewayUsageObservation = {
  schemaVersion: 1,
  eventId: "event",
  revision: 1,
  executionRef: "execution",
  requestRef: "request",
  invocationRef: "invocation",
  attemptRef: "attempt",
  accountRef: "account",
  profileId: "profile",
  model: "model",
  occurredAt: "2026-10-21T00:00:01.000Z",
  effect: "completed",
  completeness: "partial",
  inputTokens: 13,
  outputTokens: 7,
  cachedInputTokens: 5,
  reasoningTokens: 3,
  cost: null,
};
describe("Gateway safe source mapper", () => {
  it("reuses original immutable attribution and inclusive counters for a correction", async () => {
    const source = createGatewayUsageSource({
      workspaceId: "workspace",
      sourceInstance: "gateway",
      now: () => new Date("2026-10-21T00:01:00Z"),
      attribution: {
        async readDispatchSnapshot() {
          return null;
        },
        async findIdentity(scope) {
          expect(scope).toEqual({
            workspaceId: "workspace",
            callId: gatewayUsageCallId("execution", "request"),
          });
          return identity;
        },
      },
      client: {
        async listUsage(query) {
          expect(query.highWaterCursor).toBe("frozen");
          return {
            observations: [observation],
            nextCursor: "end",
            highWaterCursor: "end",
          };
        },
      },
      async quarantine() {
        throw new Error("unexpected quarantine");
      },
    });
    const page = await source.listUsage({
      afterCursor: null,
      limit: 100,
      highWaterMark: "frozen",
    });
    expect(page.facts[0]?.identity).toEqual(identity);
    expect(page.facts[0]?.actualProvider).toBeNull();
    expect(page.facts[0]?.actualModel).toBeNull();
    expect(page.facts[0]?.identity.provider).toBe("openai");
    expect(page.facts[0]?.tokens).toEqual({
      inputTotal: 13,
      outputTotal: 7,
      cacheRead: 5,
      cacheWrite: null,
      reasoning: 3,
      total: 20,
    });
    expect(page.facts[0]?.revision).toBe(2);
    expect(page.facts[0]?.cost).toBeNull();
    expect(page.facts[0]?.completeness).toBe("partial");
    expect(page.complete).toBe(true);
  });
  it("awaits durable quarantine for missing or mismatched invocation instead of guessing tenant", async () => {
    let quarantined = false;
    const source = createGatewayUsageSource({
      workspaceId: "other",
      sourceInstance: "gateway",
      now: () => new Date("2026-10-21T00:01:00Z"),
      attribution: {
        async readDispatchSnapshot() {
          return null;
        },
        async findIdentity() {
          return { ...identity, invocationId: "foreign" };
        },
      },
      client: {
        async listUsage() {
          return {
            observations: [observation],
            nextCursor: "end",
            highWaterCursor: "end",
          };
        },
      },
      async quarantine(value) {
        expect(value).toEqual(observation);
        quarantined = true;
      },
    });
    const page = await source.listUsage({
      afterCursor: null,
      limit: 100,
      highWaterMark: null,
    });
    expect(page.facts).toEqual([]);
    expect(quarantined).toBe(true);
  });
});

it("quarantines expired attributed facts durably so a recreated checkpoint can advance", async () => {
  const reasons: unknown[] = [];
  const source = createGatewayUsageSource({
    workspaceId: "workspace",
    sourceInstance: "gateway",
    now: () => new Date("2026-11-22T00:00:00Z"),
    attribution: {
      async findIdentity() {
        return identity;
      },
      async readDispatchSnapshot() {
        return null;
      },
    },
    client: {
      async listUsage() {
        return {
          observations: [observation],
          nextCursor: "end",
          highWaterCursor: "end",
        };
      },
    },
    async quarantine(value, reason) {
      reasons.push(reason);
      expect(value).toEqual(observation);
    },
  });
  const page = await source.listUsage({
    afterCursor: null,
    limit: 100,
    highWaterMark: null,
  });
  expect(reasons).toEqual(["usage_report_expired"]);
  expect(page.facts).toEqual([]);
  expect(page.complete).toBe(true);
});
it("normalizes contradictory subdivisions and avoids unsafe total sums before ledger ingest", async () => {
  const source = createGatewayUsageSource({
    workspaceId: "workspace",
    sourceInstance: "gateway",
    now: () => new Date("2026-10-21T00:01:00Z"),
    attribution: {
      async findIdentity() {
        return identity;
      },
      async readDispatchSnapshot() {
        return null;
      },
    },
    client: {
      async listUsage() {
        return {
          observations: [
            {
              ...observation,
              inputTokens: Number.MAX_SAFE_INTEGER,
              outputTokens: Number.MAX_SAFE_INTEGER,
              cachedInputTokens: Number.MAX_SAFE_INTEGER,
              reasoningTokens: Number.MAX_SAFE_INTEGER + 1,
            },
          ],
          nextCursor: "end",
          highWaterCursor: "end",
        };
      },
    },
    async quarantine() {
      throw new Error("unexpected");
    },
  });
  const page = await source.listUsage({
    afterCursor: null,
    limit: 100,
    highWaterMark: null,
  });
  expect(page.facts[0]?.tokens.total).toBeNull();
  expect(page.facts[0]?.tokens.reasoning).toBeNull();
});
