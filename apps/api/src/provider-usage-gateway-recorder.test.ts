import type {
  UsageFact,
  UsageIdentity,
} from "@reviewrouter/features-provider-usage";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  prepare: vi.fn(async (fact: UsageFact) => fact.identity),
  read: vi.fn(async () => null),
  findIdentity: vi.fn<() => Promise<UsageIdentity | null>>(async () => null),
  snapshot: vi.fn<() => unknown>(() => ({
    snapshotVersion: 3,
    configurationCanonicalJson: '{"providers":[]}',
    agent: { agentKind: "codex" },
    gateway: {
      providerIndex: 0,
      invocationId: "inv",
      attemptId: "attempt",
      bindingId: "binding",
    },
  })),
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
vi.mock(
  "@reviewrouter/features-review-run-control",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@reviewrouter/features-review-run-control")
    >()),
    parseReviewRunRuntimeSnapshot: mocks.snapshot,
  }),
);
vi.mock("@reviewrouter/features-provider-usage/composition", () => ({
  PrismaUsageStore: class {
    prepare = mocks.prepare;
  },
  PrismaUsageAttributionReader: class {
    findIdentity = mocks.findIdentity;
  },
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

  it("persists exact same-kind reviewer ownership before dispatch and denies a sibling model", async () => {
    const authorization = {
      authorizationId: "auth",
      workspaceId: "workspace",
      scmRepositoryIdentityId: "repo",
      sourceRunId: "12",
      sourceRunAttempt: "1",
      maxExpiresAt: new Date(Date.now() + 60000),
      runtimeSnapshotCanonicalJson: "snapshot",
    };
    const prisma = {
      scmRepositoryIdentity: {
        findUnique: async () => ({ externalRepositoryId: "123" }),
      },
      providerUsageGrant: { findFirst: async () => null },
      reviewRunAuthorization: {
        findUnique: async () => ({ workspaceId: "workspace" }),
      },
    };
    const recorder = createGatewayUsageRecorder(prisma as never);
    const snapshot = {
      snapshotVersion: 4,
      configurationCanonicalJson: '{"providers":[]}',
      reviewers: [0, 1].map((index) => ({
        reviewerId: `reviewer-${index}`,
        providerIndex: 0,
        requestedModel: index === 0 ? "primary/model" : "vendor/model",
        agentProfile: { agentKind: "codex" },
        transport: { allocationId: "shared-allocation" },
      })),
      allocations: [
        {
          allocationId: "shared-allocation",
          invocationId: "shared-invocation",
          attemptId: "shared-attempt",
          bindingId: "shared-binding",
        },
      ],
    };
    const request = {
      authorization: authorization as never,
      executionRef: "shared-execution",
      requestRef: "reviewer-request",
      occurredAt: new Date().toISOString(),
      model: "vendor/model",
      reviewerId: "reviewer-1",
    };
    mocks.snapshot.mockReturnValueOnce(snapshot);
    await recorder.prepare(request);
    const identity = mocks.prepare.mock.calls.at(-1)![0].identity;
    expect(identity).toMatchObject({
      parentScope: "reviewer-1",
      requestedModel: "vendor/model",
      runtimeType: "codex",
      invocationId: "shared-invocation",
      attemptId: "shared-attempt",
      bindingId: "shared-binding",
    });
    mocks.findIdentity.mockResolvedValueOnce(identity);
    expect(
      await recorder.ownsRequest({
        authorizationId: "auth",
        executionRef: request.executionRef,
        requestRef: request.requestRef,
        reviewerId: "reviewer-1",
      }),
    ).toBe(true);
    mocks.findIdentity.mockResolvedValueOnce(identity);
    expect(
      await recorder.ownsRequest({
        authorizationId: "auth",
        executionRef: request.executionRef,
        requestRef: request.requestRef,
        reviewerId: "reviewer-0",
      }),
    ).toBe(false);
    const before = mocks.prepare.mock.calls.length;
    mocks.snapshot.mockReturnValueOnce(snapshot);
    await expect(
      recorder.prepare({ ...request, model: "primary/model" }),
    ).rejects.toThrow("usage_gateway_reviewer_mismatch");
    mocks.snapshot.mockReturnValueOnce(snapshot);
    const { reviewerId: _reviewerId, ...missingSelector } = request;
    void _reviewerId;
    await expect(recorder.prepare(missingSelector)).rejects.toThrow(
      "usage_gateway_snapshot_missing",
    );
    expect(mocks.prepare.mock.calls.length).toBe(before);
  });
});
