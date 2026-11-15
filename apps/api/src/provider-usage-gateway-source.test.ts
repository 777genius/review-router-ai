import { describe, expect, it } from "vitest";
import {
  createGatewayUsageSource,
  gatewayUsageCallId,
  type GatewayUsageObservation,
} from "./provider-usage-gateway-source";
import {
  selectProjection,
  validateUsageFact,
  type UsageFact,
  type UsageIdentity,
} from "@reviewrouter/features-provider-usage";
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

describe("scoped diagnostic terminal accounting", () => {
  const diagnosticModel = "nvidia/nemotron-3.5-super-vl-120b-a12b";
  const diagnostic: UsageIdentity = {
    ...identity,
    repositoryId: null,
    actorId: "actor",
    runId: null,
    runAttempt: null,
    authorizationId: identity.invocationId,
    purpose: "diagnostic",
    provider: "nvidia",
    requestedModel: diagnosticModel,
    runtimeType: "diagnostic",
  };
  async function capture(
    effect: GatewayUsageObservation["effect"],
    attribution = diagnostic,
    counters: Partial<
      Pick<
        GatewayUsageObservation,
        | "inputTokens"
        | "outputTokens"
        | "cachedInputTokens"
        | "reasoningTokens"
        | "completeness"
        | "revision"
      >
    > = {},
    limit = 100,
  ) {
    const quarantine = [] as GatewayUsageObservation[];
    const page = await createGatewayUsageSource({
      workspaceId: "workspace",
      sourceInstance: "gateway",
      now: () => new Date("2026-10-21T00:01:00Z"),
      attribution: {
        async findIdentity() {
          return attribution;
        },
        async readDispatchSnapshot() {
          return null;
        },
      },
      client: {
        async listUsage(query) {
          expect(query.limit).toBe(Math.min(limit, 50));
          return {
            observations: [
              {
                ...observation,
                profileId: "nvidia-build-chat-apikey-v1",
                model: diagnosticModel,
                effect,
                revision: 2,
                completeness: "partial",
                inputTokens: null,
                outputTokens: null,
                cachedInputTokens: null,
                reasoningTokens: null,
                ...counters,
              },
            ],
            nextCursor: "end",
            highWaterCursor: "end",
          };
        },
      },
      async quarantine(value) {
        quarantine.push(value);
      },
    }).listUsage({ afterCursor: null, limit, highWaterMark: null });
    return { page, quarantine };
  }
  it.each([
    ["completed", "completed"],
    ["effect_unknown", "unknown"],
    ["not_dispatched", "failed"],
    ["rejected_before_dispatch", "failed"],
  ] as const)(
    "settles %s from its native effect even without token counters",
    async (effect, state) => {
      const { page } = await capture(effect);
      expect(page.facts).toHaveLength(2);
      expect(page.facts.every((f) => f.sourceInstance === "gateway")).toBe(
        true,
      );
      expect(new Set(page.facts.map((f) => f.eventId)).size).toBe(2);
      const prepared: UsageFact = {
        ...page.facts[0]!,
        sourceInstance: "reviewrouter/gateway-lifecycle-v1",
        eventId: diagnostic.callId,
        revision: 1,
        authority: "lifecycle",
        state: "prepared",
        dispatchEffect: "not_dispatched",
        completeness: "unknown",
      };
      const projection = selectProjection([prepared, ...page.facts]);
      expect(projection.lifecycle?.state).toBe(state);
      expect(projection.usage?.tokens.total).toBeNull();
      expect(projection.usage?.actualProvider).toBeNull();
      expect(projection.usage?.actualModel).toBeNull();
      expect(projection.identity).toEqual(diagnostic);
    },
  );
  it("replays the captured closed NVIDIA probe's 33/22 counters without inventing observed vendor/model", async () => {
    const { page } = await capture("completed", diagnostic, {
      inputTokens: 33,
      outputTokens: 22,
      cachedInputTokens: 0,
      reasoningTokens: 19,
      completeness: "complete",
    });
    const projection = selectProjection(page.facts);
    expect(projection.lifecycle?.state).toBe("completed");
    expect(projection.identity.provider).toBe("nvidia");
    expect(projection.usage?.tokens.total).toBe(55);
    expect(projection.usage?.completeness).toBe("complete");
    expect(projection.usage?.actualProvider).toBeNull();
    expect(projection.usage?.actualModel).toBeNull();
    expect(projection.usage?.cost).toBeNull();
  });
  it("keeps a full diagnostic page inside the existing atomic 100-fact bound", async () => {
    const observations = Array.from({ length: 50 }, (_, i) => ({
      ...observation,
      executionRef: `execution-${i}`,
      requestRef: `request-${i}`,
      invocationRef: `invocation-${i}`,
      attemptRef: `attempt-${i}`,
    }));
    const identities = new Map(
      observations.map((o) => {
        const callId = gatewayUsageCallId(o.executionRef, o.requestRef);
        return [
          callId,
          {
            ...diagnostic,
            callId,
            invocationId: o.invocationRef,
            authorizationId: o.invocationRef,
            attemptId: o.attemptRef,
          },
        ] as const;
      }),
    );
    const page = await createGatewayUsageSource({
      workspaceId: "workspace",
      sourceInstance: "gateway",
      now: () => new Date("2026-10-21T00:01:00Z"),
      attribution: {
        async findIdentity(scope) {
          return identities.get(scope.callId) ?? null;
        },
        async readDispatchSnapshot() {
          return null;
        },
      },
      client: {
        async listUsage(query) {
          expect(query.limit).toBe(50);
          return { observations, nextCursor: "end", highWaterCursor: "end" };
        },
      },
      async quarantine() {
        throw new Error("unexpected quarantine");
      },
    }).listUsage({ afterCursor: null, limit: 100, highWaterMark: null });
    expect(page.facts).toHaveLength(100);
    expect(page.complete).toBe(true);
    expect(page.facts.filter((f) => f.authority === "lifecycle")).toHaveLength(
      50,
    );
  });
  it("lets a known revision0 terminal effect beat persisted prepared revision1 without clocks or counters", async () => {
    const { page } = await capture("completed", diagnostic, { revision: 0 });
    const prepared: UsageFact = {
      ...page.facts[0]!,
      sourceInstance: "reviewrouter/gateway-lifecycle-v1",
      eventId: diagnostic.callId,
      revision: 1,
      authority: "lifecycle",
      state: "prepared",
      dispatchEffect: "not_dispatched",
      completeness: "unknown",
    };
    expect(page.facts.map((f) => f.revision)).toEqual([1, 1]);
    const projection = selectProjection([prepared, ...page.facts]);
    expect(projection.lifecycle?.state).toBe("completed");
    expect(projection.usage?.tokens.total).toBeNull();
  });
  it("keeps limit1 quarantine replay as one upstream observation with both correlated facts", async () => {
    const { page } = await capture("completed", diagnostic, {}, 1);
    expect(page.facts).toHaveLength(2);
    page.facts.forEach(validateUsageFact);
    expect(selectProjection(page.facts).lifecycle?.state).toBe("completed");
  });
  it("uses the same safe mapped revision for native and diagnostic lifecycle facts", async () => {
    const { page } = await capture("completed", diagnostic, {
      revision: 2147483646,
    });
    expect(page.facts.map((f) => f.revision)).toEqual([2147483647, 2147483647]);
    page.facts.forEach(validateUsageFact);
  });
  it.each([-1, 0.5, 2147483647, Number.MAX_SAFE_INTEGER])(
    "rejects unrepresentable native revision %s before a page can advance",
    async (revision) => {
      await expect(
        capture("completed", diagnostic, { revision }),
      ).rejects.toThrow("gateway_usage_revision_invalid");
    },
  );
  it.each(["dispatch_started", "response_started"] as const)(
    "does not terminalize %s",
    async (effect) => {
      const { page } = await capture(effect);
      expect(page.facts).toHaveLength(1);
      expect(page.facts[0]?.authority).toBe("native");
    },
  );
  it.each([
    { ...diagnostic, purpose: "review" as const },
    { ...diagnostic, actorId: null },
    { ...diagnostic, bindingId: null },
    { ...diagnostic, authorizationId: "review-authorization" },
    { ...diagnostic, runtimeType: "ocr" },
  ])(
    "does not invent diagnostic ownership for an ineligible identity",
    async (value) => {
      expect((await capture("completed", value)).page.facts).toHaveLength(1);
    },
  );
  it.each([
    { ...diagnostic, workspaceId: "foreign" },
    { ...diagnostic, callId: "foreign-call" },
    { ...diagnostic, invocationId: "foreign" },
    { ...diagnostic, attemptId: "foreign" },
  ])(
    "quarantines mismatched correlation before terminal projection",
    async (value) => {
      const result = await capture("completed", value);
      expect(result.page.facts).toEqual([]);
      expect(result.quarantine).toHaveLength(1);
    },
  );
});
