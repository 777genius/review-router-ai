import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
import Fastify from "fastify";
import type { PrismaClient } from "@reviewrouter/platform-db";
import {
  canonicalJson,
  type UsageFact,
  type UsageIdentity,
} from "@reviewrouter/features-provider-usage";
const mocks = vi.hoisted(() => ({
  ingest: vi.fn(async () => ({ status: "accepted", hash: "hash" })),
  findIdentity: vi.fn<() => Promise<UsageIdentity | null>>(async () => null),
  readDispatchSnapshot: vi.fn(async () => null),
  snapshot: vi.fn<() => unknown>(() => ({
    snapshotVersion: 3,
    configurationCanonicalJson: "{}",
    gateway: null,
    agent: { agentKind: "codex" },
  })),
  configuration: vi.fn(() => ({
    providers: [{ kind: "codex", model: "model" }],
  })),
}));
vi.mock("@reviewrouter/features-provider-usage/composition", () => ({
  PrismaUsageStore: class {
    ingest = mocks.ingest;
  },
  PrismaUsageReportReader: class {},
  PrismaUsageAttributionReader: class {
    findIdentity = mocks.findIdentity;
    readDispatchSnapshot = mocks.readDispatchSnapshot;
  },
  createProviderUsage: async () => ({ ingestUsage: { execute: mocks.ingest } }),
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
vi.mock("./provider-usage-price-snapshot", () => ({
  providerUsagePriceSnapshots: async () => ({ read: async () => null }),
}));
vi.mock("@reviewrouter/features-review-config", () => ({
  parseReviewConfigurationStrict: mocks.configuration,
}));
import {
  createProviderUsageApi,
  registerProviderUsageRoutes,
  selectProducerCoverage,
} from "./provider-usage-routes";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
function fixture() {
  const token = "rr-usage-v1-test";
  const now = new Date();
  const grant = {
    id: "grant",
    tokenHash: createHash("sha256").update(token).digest("hex"),
    workspaceId: "workspace",
    invocationId: "invocation",
    repositoryId: "123",
    runId: "456",
    runAttempt: 2,
    authorizationId: "authorization",
    actorId: null,
    bindingId: null as string | null,
    producerDigest: "digest",
    workflowIdentity: "workflow",
    jobIdentity: "job",
    publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    issuedAt: now,
    expiresAt: new Date(now.getTime() + 86400000),
    revokedAt: null,
    closedAt: null,
  };
  const prisma = {
    providerUsageGrant: {
      findUnique: vi.fn(async () => grant),
      updateMany: vi.fn(),
    },
    workspace: { findUnique: vi.fn(async () => ({ deletionState: "active" })) },
    reviewRunAuthorization: {
      findUnique: vi.fn(async () => ({
        state: "active",
        expiresAt: new Date(now.getTime() + 3600000),
        revokedAt: null as Date | null,
      })),
    },
  };
  const completion = vi.fn(async (): Promise<Date | null> => null);
  const api = createProviderUsageApi({
    resolveRunClosedAt: completion,
    prisma: prisma as unknown as PrismaClient,
    authorizations: {
      resolveReviewRunAuthorizationToken: vi.fn(async () => ({
        status: "denied",
        reason: "test",
      })),
    } as never,
    resolveRepository: vi.fn(),
    confirmAuthority: vi.fn(),
  });
  const fact: UsageFact = {
    schemaVersion: 1,
    sourceInstance: "runner/grant",
    eventId: "event",
    revision: 1,
    authority: "runtime",
    identity: {
      callId: "grant-call",
      workspaceId: "workspace",
      repositoryId: "123",
      actorId: null,
      runId: "456",
      runAttempt: 2,
      invocationId: "invocation",
      attemptId: "attempt",
      bindingId: null,
      authorizationId: "authorization",
      route: "direct",
      purpose: "review",
      provider: "codex",
      requestedModel: "model",
      runtimeType: "codex",
      parentScope: null,
      granularity: "call",
      occurredAt: now.toISOString(),
    },
    actualProvider: "openai",
    actualModel: "model",
    tokens: {
      inputTotal: 10,
      outputTotal: 2,
      total: 12,
      cacheRead: null,
      cacheWrite: null,
      reasoning: null,
    },
    cost: null,
    completeness: "complete",
    state: "completed",
    dispatchEffect: "dispatched",
    durationMs: 1,
    ttftMs: null,
    correctionReason: null,
    childCallIds: null,
  };
  const report = {
    schemaVersion: 1 as const,
    producerDigest: "digest",
    workflowIdentity: "workflow",
    jobIdentity: "job",
    facts: [fact],
  };
  return { api, prisma, grant, token, fact, report, completion };
}
describe("provider usage report-only API", () => {
  it("commits a valid report with a bounded ACK without requiring a still-active execution token", async () => {
    const f = fixture();
    f.prisma.reviewRunAuthorization.findUnique.mockResolvedValue({
      state: "revoked",
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: new Date(Date.now() - 1000),
    });
    const result = await f.api.report(f.token, f.report);
    expect(result.accepted).toEqual([
      {
        eventId: "event",
        revision: 1,
        status: "accepted",
        hash: createHash("sha256").update(canonicalJson(f.fact)).digest("hex"),
      },
    ]);
  });
  it.each([
    "workspaceId",
    "repositoryId",
    "runId",
    "invocationId",
    "authorizationId",
    "bindingId",
    "actorId",
  ] as const)("denies a forged %s before ledger write", async (field) => {
    const f = fixture();
    f.fact.identity[field] = "foreign";
    mocks.ingest.mockClear();
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_scope_mismatch",
    );
    expect(mocks.ingest).not.toHaveBeenCalled();
  });
  it("denies a foreign producer namespace and forged requested provider", async () => {
    const f = fixture();
    f.fact.sourceInstance = "runner/other";
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_scope_mismatch",
    );
    f.fact.sourceInstance = "runner/grant";
    f.fact.identity.provider = "forged";
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_scope_mismatch",
    );
  });
  it("accepts the exact durable v4 reviewer request and rejects borrowing a same-kind sibling's attribution", async () => {
    const f = fixture();
    f.grant.bindingId = "shared-binding";
    f.grant.invocationId = "shared-invocation";
    f.fact.identity = {
      ...f.fact.identity,
      callId: "shared-gateway-call",
      parentScope: "reviewer-1",
      requestedModel: "model-1",
      invocationId: "shared-invocation",
      bindingId: "shared-binding",
      route: "gateway",
    };
    const durable = structuredClone(f.fact.identity);
    const snapshot = {
      snapshotVersion: 4,
      primaryReviewerId: "reviewer-0",
      configurationCanonicalJson: "{}",
      reviewers: [0, 1].map((index) => ({
        reviewerId: `reviewer-${index}`,
        providerIndex: index,
        requestedModel: `model-${index}`,
        agentProfile: { agentKind: "codex" },
        transport: { allocationId: "shared-allocation" },
      })),
      allocations: [
        {
          allocationId: "shared-allocation",
          invocationId: "shared-invocation",
          bindingId: "shared-binding",
        },
      ],
    };
    function selectV4() {
      mocks.snapshot.mockReturnValueOnce(snapshot);
      mocks.configuration.mockReturnValueOnce({
        providers: [0, 1].map((index) => ({
          kind: "codex",
          model: `model-${index}`,
        })),
      });
      mocks.findIdentity.mockResolvedValueOnce(durable);
      mocks.ingest.mockClear();
    }
    selectV4();
    expect((await f.api.report(f.token, f.report)).accepted).toHaveLength(1);
    expect(mocks.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ identity: durable }),
      expect.objectContaining({
        invocationId: "shared-invocation",
        serverPriceSnapshot: null,
      }),
    );
    for (const patch of [
      { parentScope: "reviewer-0", requestedModel: "model-0" },
      { callId: "foreign-gateway-call" },
      { attemptId: "foreign-attempt" },
      { parentScope: null },
    ]) {
      f.fact.identity = { ...durable, ...patch };
      selectV4();
      await expect(f.api.report(f.token, f.report)).rejects.toThrow(
        "usage_scope_mismatch",
      );
      expect(mocks.ingest).not.toHaveBeenCalled();
    }
    // The missing selector is rejected before the durable lookup.
    mocks.findIdentity.mockReset().mockResolvedValue(null);
  });
  it("uses App-verified closure for the final replay day and never extends the expiry", async () => {
    const f = fixture();
    f.grant.issuedAt = new Date(Date.now() - 7.5 * 86400000);
    f.completion.mockResolvedValue(new Date(Date.now() - 7.4 * 86400000));
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_report_expired",
    );
    expect(f.completion).toHaveBeenCalledTimes(1);
  });
  it("fails closed when completion cannot be verified after seven days", async () => {
    const f = fixture();
    f.grant.issuedAt = new Date(Date.now() - 7.5 * 86400000);
    f.completion.mockRejectedValue(new Error("network"));
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_run_completion_unavailable",
    );
  });
  it("rejects native authority and arbitrary hidden payload fields", async () => {
    const f = fixture();
    f.fact.authority = "native";
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_scope_mismatch",
    );
    f.fact.authority = "runtime";
    await expect(
      f.api.report(f.token, { ...f.report, prompt: "secret" }),
    ).rejects.toThrow();
  });
  it("expires grants and revokes every workspace grant on deletion", async () => {
    const f = fixture();
    f.grant.expiresAt = new Date(Date.now() - 1);
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_report_expired",
    );
    f.prisma.workspace.findUnique.mockResolvedValue({
      deletionState: "tombstoned",
    });
    await expect(f.api.report(f.token, f.report)).rejects.toThrow(
      "usage_scope_deleted",
    );
    expect(f.prisma.providerUsageGrant.updateMany).toHaveBeenCalled();
  });
  it("recovers only a signed manifest from its exact App-verified run", async () => {
    const f = fixture();
    const unsigned = {
      ...f.report,
      grantId: "grant",
      invocationId: "invocation",
      runAttempt: 2,
      eventHashes: [
        createHash("sha256").update(canonicalJson(f.fact)).digest("hex"),
      ],
    };
    const artifact = {
      ...unsigned,
      signature: sign(
        null,
        Buffer.from(canonicalJson(unsigned)),
        privateKey,
      ).toString("base64"),
    };
    const run = {
      repositoryId: "123",
      runId: "456",
      runAttempt: 2,
      artifactName: "reviewrouter-usage-v1-invocation-2",
    };
    expect((await f.api.recover(artifact, run)).accepted).toHaveLength(1);
    await expect(
      f.api.recover({ ...artifact, producerDigest: "forged" }, run),
    ).rejects.toThrow("usage_signature_invalid");
    await expect(
      f.api.recover(artifact, { ...run, runAttempt: 3 }),
    ).rejects.toThrow("usage_scope_mismatch");
  });
  it("HTTP rejects execution tokens at ingest when no usage grant exists and enforces payload bounds", async () => {
    const f = fixture();
    f.prisma.providerUsageGrant.findUnique.mockResolvedValue(null as never);
    const app = Fastify();
    await registerProviderUsageRoutes(app, f.api);
    const r = await app.inject({
      method: "POST",
      url: "/api/provider-usage/reports",
      headers: { authorization: "Bearer execution-token" },
      payload: f.report,
    });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toEqual({ error: "usage_grant_denied" });
    f.prisma.providerUsageGrant.findUnique.mockResolvedValue(f.grant);
    const bad = await app.inject({
      method: "POST",
      url: "/api/provider-usage/reports",
      headers: { authorization: "Bearer usage-token" },
      payload: { ...f.report, facts: Array(101).fill(f.fact) },
    });
    expect(bad.statusCode).toBe(400);
    await app.close();
  });
});

describe("producer loss coverage revisions", () => {
  const first = {
    schemaVersion: 1 as const,
    revision: 1,
    state: "partial" as const,
    reason: "spool_overflow" as const,
    droppedEvents: 2,
    occurredAt: "2026-10-21T00:00:00.000Z",
  };
  it("keeps partial coverage on old delivery and rejects revision hash conflicts", () => {
    const next = { ...first, revision: 2, droppedEvents: 3 };
    expect(selectProducerCoverage(next, first)).toEqual(next);
    expect(() =>
      selectProducerCoverage(first, { ...first, droppedEvents: 9 }),
    ).toThrow("usage_hash_conflict");
    expect(() =>
      selectProducerCoverage(next, { ...next, revision: 3, droppedEvents: 1 }),
    ).toThrow("usage_invalid_fact");
  });
});
