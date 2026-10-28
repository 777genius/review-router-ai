import type { UsageFact } from "@reviewrouter/features-provider-usage";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async (fact: UsageFact) => fact.identity),
  read: vi.fn(async () => null),
  strict: vi.fn(() => ({
    providers: [
      {
        kind: "openrouter",
        authMode: "openrouter_api_key",
        model: "vendor/model",
      },
    ],
  })),
}));
vi.mock("@reviewrouter/features-review-config", () => ({
  parseReviewConfigurationStrict: mocks.strict,
}));
vi.mock("@reviewrouter/features-review-run-control", () => ({
  parseReviewRunRuntimeSnapshot: () => ({
    configurationCanonicalJson: '{"providers":[]}',
    agent: { agentKind: "codex" },
    gateway: {
      providerIndex: 0,
      invocationId: "inv",
      attemptId: "attempt",
      bindingId: "binding",
    },
  }),
}));
vi.mock("@reviewrouter/features-provider-usage/composition", () => ({
  PrismaUsageStore: class {
    prepare = mocks.prepare;
  },
  PrismaUsageAttributionReader: class {},
}));
vi.mock("./provider-usage-price-snapshot.js", () => ({
  providerUsagePriceSnapshots: async () => ({ read: mocks.read }),
}));
import { createGatewayUsageRecorder } from "./provider-usage-gateway-recorder";
import { lifecycleVerificationContract } from "@reviewrouter/shared";
describe("Gateway requested provider attribution", () => {
  it("uses selected OpenRouter provider while keeping Codex engine and unknown observed vendor", async () => {
    const prisma = {
      scmRepositoryIdentity: {
        findUnique: async () => ({ externalRepositoryId: "123" }),
      },
      providerUsageGrant: { findFirst: async () => null },
    };
    const recorder = createGatewayUsageRecorder(prisma as never);
    const authorization = {
      authorizationId: "auth",
      workspaceId: "workspace",
      scmRepositoryIdentityId: "repo",
      sourceRunId: "12",
      sourceRunAttempt: "1",
      maxExpiresAt: new Date(Date.now() + 60000),
      runtimeSnapshotCanonicalJson: "snapshot",
    };
    await recorder.prepare({
      authorization: authorization as never,
      executionRef: "exec",
      requestRef: "request",
      occurredAt: new Date().toISOString(),
      model: "vendor/model",
    });
    expect(mocks.strict).toHaveBeenCalledWith({ providers: [] });
    expect(mocks.read).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "openrouter",
        model: "vendor/model",
      }),
    );
    expect(mocks.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({
          provider: "openrouter",
          runtimeType: "codex",
        }),
        actualProvider: null,
      }),
      expect.anything(),
    );
    const legacyIdentity = mocks.prepare.mock.calls.at(-1)![0].identity;
    await recorder.prepare({
      authorization: authorization as never,
      executionRef: "exec",
      requestRef: "lifecycle-request",
      occurredAt: legacyIdentity.occurredAt,
      model: "vendor/model",
      role: "lifecycle_verification",
    });
    const companionIdentity = mocks.prepare.mock.calls.at(-1)![0].identity;
    expect(companionIdentity).toEqual({
      ...legacyIdentity,
      callId: expect.any(String),
      runtimeType: lifecycleVerificationContract.executor,
    });
    expect(companionIdentity.callId).not.toBe(legacyIdentity.callId);
  });
});
