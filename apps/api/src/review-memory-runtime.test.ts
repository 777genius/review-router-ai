import Fastify from "fastify";
import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryKnowledgeService,
  memoryKnowledgeTopicsDigest,
  createMemoryPolicyConfig,
  createMemoryBodyHash,
  memoryKnowledgeDigest,
  type MemoryKnowledgeBundle,
  type MemoryKnowledgeEntryMetadata,
} from "@reviewrouter/features-memory";
import type { MemoryKnowledgeRuntime } from "@reviewrouter/features-memory/composition";
import {
  canonicalJson,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  captureAuthorizedMemoryContext,
  ReviewMemoryRuntimeGateway,
  registerReviewMemoryRuntimeRoutes,
  reviewMemoryRuntimeScopes,
} from "./review-memory-runtime";
import {
  reviewMemoryBinding,
  reviewMemorySnapshotHash,
} from "./review-memory-wire";
import type {
  MemoryAdmissionDiagnostic,
  MemoryAdmissionObserver,
} from "./review-memory-admission";

const now = new Date();
const binding = {
  authorizationId: "auth-1",
  repositoryConnectionId: "repo-1",
  pullRequestNumber: 7,
  baseSha: "b".repeat(40),
  headSha: "a".repeat(40),
  reviewRevisionHash: "c".repeat(64),
};
const request = { protocolVersion: 2, ...binding };
const runtimeSnapshot = {
  snapshotVersion: 3,
  configurationSource: "workspace",
  configurationVersion: 1,
  workspaceConfigurationVersion: 1,
  repositoryConfigurationVersion: null,
  effectivePolicyDigest: `sha256:${"b".repeat(64)}`,
  agent: {
    profileRef: "codex-default",
    agentKind: "codex",
    binarySha256: "a".repeat(64),
    packageVersion: "0.159.2",
    modelTransports: ["account_gateway"],
    contextGateway: true,
    cancellation: true,
  },
  agentProfileDigest: "d".repeat(64),
  producer: {
    producerReleaseId: "release-1",
    actionCommitSha: "a".repeat(40),
    runtimeCommitSha: "a".repeat(40),
  },
  configurationCanonicalJson: canonicalJson({ schemaVersion: 3 }),
  deadline: new Date(now.getTime() + 600_000).toISOString(),
  gateway: null,
};
const authorization = {
  ...binding,
  workspaceId: "workspace-1",
  trustDomain: "trusted_managed",
  mutationEpoch: 1n,
  expiresAt: new Date(now.getTime() + 300_000),
  maxExpiresAt: new Date(now.getTime() + 600_000),
  runtimeSnapshotCanonicalJson: canonicalJson(runtimeSnapshot),
} as ReviewRunAuthorization;
const source = {
  type: "manual" as const,
  sourceId: "manual:1",
  revision: "1",
  updatedAt: now.toISOString(),
  statementAt: now.toISOString(),
  repositoryId: null,
  pullRequestNumber: null,
  url: null,
  visibility: "private" as const,
  claimedBodyDigest: null,
  observedCommitSha: null,
};
const actor = {
  kind: "workspace_user" as const,
  id: "user-1",
  githubUserId: null,
  login: null,
};
const scope = {
  kind: "repository" as const,
  workspaceId: "workspace-1",
  repositoryId: "repo-1",
};
const metadata: MemoryKnowledgeEntryMetadata = {
  ref: { type: "entry", scope, entryId: "mem_1" },
  generation: "generation-1",
  revision: "1",
  contentApprovalRevision: "1",
  bodyDigest: "e".repeat(64),
  topicsDigest: "f".repeat(64),
  kind: "rule",
  lifecycle: "active",
  approval: {
    actor,
    approvedAt: now.toISOString(),
    authorityRevision: "manual:1",
  },
  source,
  applicability: {
    validUntil: null,
    observedCommitSha: null,
    exceptionRule: null,
  },
  originalStatementAt: now.toISOString(),
  lastVerifiedAt: now.toISOString(),
  pendingCommandId: null,
  revocationCommandId: null,
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
};
const expiresAt = new Date(now.getTime() + 30_000).toISOString();
const bundle: MemoryKnowledgeBundle = {
  generation: "generation-1",
  hash: "d".repeat(64),
  expiresAt,
  degraded: false,
  scopes: [
    {
      scope,
      epoch: "3",
      items: [
        {
          type: "entry",
          entry: {
            ref: metadata.ref,
            body: "Use UTC for persisted event timestamps.",
            bodyDigest: createMemoryBodyHash(
              "Use UTC for persisted event timestamps.",
            ),
            statementAt: now.toISOString(),
            sourceFactIds: ["fact-1"],
            topicIds: ["time"],
            contentApprovalRevision: "1",
            kind: "rule",
          },
          metadata,
        },
      ],
    },
  ],
};
const receipt = {
  generation: "generation-1",
  bundleHash: bundle.hash,
  expiresAt,
  scopes: [
    {
      scope,
      epoch: "3",
      entries: [
        { ref: metadata.ref, revision: "1", contentApprovalRevision: "1" },
      ],
    },
  ],
};
const headers = { authorization: "Bearer run-token" };

/** HTTP/application wiring with controlled provider and authorization peers. */
describe("review memory runtime HTTP boundary", () => {
  const apps: ReturnType<typeof Fastify>[] = [];
  afterEach(async () => {
    vi.useRealTimers();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });
  async function fixture(
    enabled = true,
    clock: () => Date = () => new Date(),
    observer?: MemoryAdmissionObserver,
  ) {
    const access = {
      authorize: vi.fn<
        (token: string) => Promise<ReviewRunAuthorization | null>
      >(async () => authorization as ReviewRunAuthorization | null),
    };
    const policy = {
      getPolicy: vi.fn(async () =>
        createMemoryPolicyConfig({ memoryEnabled: true }),
      ),
    };
    const service = {
      bundle: vi.fn<MemoryKnowledgeService["bundle"]>(async () => bundle),
      createBundleReceipt: vi.fn<MemoryKnowledgeService["createBundleReceipt"]>(
        () => receipt,
      ),
      admitReceipt: vi.fn(async () => true),
    };
    const runtime = {
      enabled,
      generation: "generation-1",
      policy,
      forAccess: vi.fn(() => service),
    } as unknown as MemoryKnowledgeRuntime;
    const rows = new Map<string, Record<string, unknown>>();
    const prisma = {
      repositoryConnection: {
        findFirst: vi.fn(async () => ({ visibility: "private" })),
      },
      memoryKnowledgeBundleReceipt: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          rows.set(String(data.id), data);
          return data;
        }),
        findUnique: vi.fn(
          async ({ where }: { where: { id: string } }) =>
            rows.get(where.id) ?? null,
        ),
      },
    };
    const gateway = new ReviewMemoryRuntimeGateway({
      prisma: prisma as unknown as PrismaClient,
      runtime,
      access,
      now: clock,
    });
    const app = Fastify({ logger: false });
    apps.push(app);
    await registerReviewMemoryRuntimeRoutes(app, gateway, observer);
    await app.ready();
    return { app, gateway, service, access, policy, prisma, rows };
  }

  it("reports preflight outcomes and safe errors while ignoring throwing diagnostic sinks", async () => {
    const events: MemoryAdmissionDiagnostic[] = [];
    const { app, gateway } = await fixture(
      true,
      () => now,
      (event) => {
        events.push(event);
        throw new Error("private diagnostic sink failure");
      },
    );
    const admit = vi.spyOn(gateway, "admit");
    const payload = {
      ...request,
      bundleId: "bundle-1",
      eligibilityEpoch: "1",
      policyVersion: "1",
      providerGeneration: "generation-1",
    };
    const send = () =>
      app.inject({
        method: "POST",
        url: "/api/action/v2/memory/admit",
        headers,
        payload,
      });
    for (const eligible of [true, false]) {
      admit.mockResolvedValueOnce(eligible);
      const response = await send();
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ protocolVersion: 2, eligible });
    }
    admit.mockRejectedValueOnce(new Error("do-not-log-token-or-body"));
    const failed = await send();
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ code: "memory_unavailable" });
    expect(events).toEqual([
      {
        boundary: "preflight",
        phase: "complete",
        outcome: "eligible",
        authorizationId: binding.authorizationId,
        elapsedMs: expect.any(Number),
      },
      {
        boundary: "preflight",
        phase: "complete",
        outcome: "denied",
        authorizationId: binding.authorizationId,
        elapsedMs: expect.any(Number),
      },
      {
        boundary: "preflight",
        phase: "complete",
        outcome: "error",
        errorCode: "unavailable",
        elapsedMs: expect.any(Number),
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("do-not-log");
    expect(JSON.stringify(events)).not.toContain("private diagnostic");
  });

  it.each([
    { expiry: 120_000, maximum: 240_000, deadline: 300_000, expected: 240_000 },
    { expiry: 240_000, maximum: 120_000, deadline: 300_000, expected: 120_000 },
    { expiry: 240_000, maximum: 300_000, deadline: 120_000, expected: 120_000 },
  ])(
    "freezes the initial trusted run bounds before hashing and persisting the receipt: %j",
    async ({ expiry, maximum, deadline, expected }) => {
      const { app, access, service, rows } = await fixture();
      const initial = {
        ...authorization,
        expiresAt: new Date(now.getTime() + expiry),
        maxExpiresAt: new Date(now.getTime() + maximum),
        runtimeSnapshotCanonicalJson: canonicalJson({
          ...runtimeSnapshot,
          deadline: new Date(now.getTime() + deadline).toISOString(),
        }),
      };
      access.authorize.mockResolvedValueOnce(initial).mockResolvedValue({
        ...initial,
        expiresAt: new Date(now.getTime() + 600_000),
      });
      service.bundle.mockImplementation(async (input) => {
        const bounded = {
          generation: bundle.generation,
          scopes: bundle.scopes,
          degraded: bundle.degraded,
          expiresAt: input.snapshotNotAfter!.toISOString(),
        };
        return { ...bounded, hash: memoryKnowledgeDigest(bounded) };
      });
      service.createBundleReceipt.mockImplementation(
        MemoryKnowledgeService.prototype.createBundleReceipt,
      );
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v2/memory/bundle",
        headers,
        payload: request,
      });
      expect(response.statusCode).toBe(200);
      const wire = response.json();
      const expectedExpiry = new Date(now.getTime() + expected);
      expect(service.bundle.mock.calls[0]?.[0].snapshotNotAfter).toEqual(
        expectedExpiry,
      );
      expect(wire.expiresAt).toBe(expectedExpiry.toISOString());
      const row = rows.get(wire.bundleId)!;
      expect(row.expiresAt).toEqual(expectedExpiry);
      expect(row.receipt).toMatchObject({
        expiresAt: expectedExpiry.toISOString(),
      });
      expect(row.snapshotHash).toBe(reviewMemorySnapshotHash(wire));
      expect(service.bundle).toHaveBeenCalledOnce();
    },
  );

  it("does not accept a caller-supplied snapshot lifetime", async () => {
    const { app, access, service } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: { ...request, snapshotNotAfter: "2126-01-01T00:00:00.000Z" },
    });
    expect(response.statusCode).toBe(400);
    expect(access.authorize).not.toHaveBeenCalled();
    expect(service.bundle).not.toHaveBeenCalled();
  });

  it("requires current live authorization for a future receipt and preserves the snapshot across legitimate token renewal", async () => {
    let currentTime = now;
    const { app, access, service } = await fixture(true, () => currentTime);
    const initial = {
      ...authorization,
      expiresAt: new Date(now.getTime() + 60_000),
      maxExpiresAt: new Date(now.getTime() + 300_000),
      runtimeSnapshotCanonicalJson: canonicalJson({
        ...runtimeSnapshot,
        deadline: new Date(now.getTime() + 300_000).toISOString(),
      }),
    };
    // The authority peer represents a renewal completed before the old token
    // expired. Only the new token can authorize subsequent receipt admissions.
    const renewed = {
      ...initial,
      expiresAt: new Date(now.getTime() + 180_000),
    };
    access.authorize.mockImplementation(async (token) => {
      const current = token === "renewed-token" ? renewed : initial;
      return currentTime.getTime() < current.expiresAt.getTime()
        ? current
        : null;
    });
    const longerBundle = {
      ...bundle,
      expiresAt: initial.maxExpiresAt.toISOString(),
    };
    service.bundle.mockResolvedValue(longerBundle);
    service.createBundleReceipt.mockReturnValue({
      ...receipt,
      expiresAt: longerBundle.expiresAt,
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: request,
    });
    expect(response.statusCode).toBe(200);
    const wire = response.json();
    currentTime = new Date(now.getTime() + 61_000);
    expect(Date.parse(wire.expiresAt)).toBeGreaterThan(currentTime.getTime());
    const admit = {
      method: "POST" as const,
      url: "/api/action/v2/memory/admit",
      headers,
      payload: {
        ...request,
        bundleId: wire.bundleId,
        eligibilityEpoch: wire.eligibilityEpoch,
        policyVersion: wire.policyVersion,
        providerGeneration: wire.providerGeneration,
      },
    };
    expect((await app.inject(admit)).statusCode).toBe(403);
    expect(service.admitReceipt).not.toHaveBeenCalled();
    const eligible = await app.inject({
      ...admit,
      headers: { authorization: "Bearer renewed-token" },
    });
    expect(eligible.statusCode).toBe(200);
    expect(eligible.json()).toEqual({ protocolVersion: 2, eligible: true });
    expect(service.bundle).toHaveBeenCalledOnce();
    expect(wire.expiresAt).toBe(initial.maxExpiresAt.toISOString());
  });

  it("preserves a private workspace fact for internal tasks and excludes its exact bytes before public description inference", async () => {
    const workspaceScope = {
      kind: "workspace" as const,
      workspaceId: scope.workspaceId,
    };
    const body = "Private workspace terminology: use settlement window.";
    const provider = {
      ref: { ...metadata.ref, scope: workspaceScope },
      body,
      bodyDigest: createMemoryBodyHash(body),
      contentApprovalRevision: "1",
      kind: "rule" as const,
      topicIds: ["terms"],
      statementAt: now.toISOString(),
      sourceFactIds: ["fact-1"],
    };
    const stored = {
      ...metadata,
      ref: provider.ref,
      bodyDigest: provider.bodyDigest,
      topicsDigest: memoryKnowledgeTopicsDigest(provider.topicIds),
      source: { ...source, visibility: "private" as const },
    };
    const service = new MemoryKnowledgeService({
      generation: "generation-1",
      providerProfileVersion: "test",
      store: {
        maintenanceState: async () => ({
          generation: "generation-1",
          epoch: "0",
          paused: false,
        }),
        scopeEpoch: async () => "1",
        findEntry: async () => stored,
      } as never,
      reader: {
        read: async () => provider,
        recall: async () => [{ type: "entry", entry: provider }],
        list: async () => ({ entries: [provider], nextCursor: null }),
      },
      writer: {} as never,
      observer: {} as never,
      access: {
        authorize: async () => {},
        verifySource: async () => stored.source,
        sourceApplicable: async () => true,
      },
      policy: { getPolicy: async () => createMemoryPolicyConfig() },
      quota: {} as never,
      now: () => now,
    });
    const capture = (
      audience: "internal" | "public",
      allowedTasks: ("review" | "investigation" | "pr_description")[],
    ) =>
      captureAuthorizedMemoryContext(
        {
          service,
          actor,
          scopes: [workspaceScope],
          contextPolicy: {
            audience,
            repositoryId: scope.repositoryId,
            allowedTasks,
          },
        },
        { deadlineAt: new Date(now.getTime() + 5000) },
      );
    const internal = await capture("internal", ["review", "investigation"]);
    const description = await capture("public", ["pr_description"]);
    expect(internal.text).toContain(body);
    expect(description.text).not.toContain(body);
    expect(
      description.bundle.scopes.flatMap((section) => section.items),
    ).toEqual([]);
    expect(internal.receipt.contextPolicy?.allowedTasks).not.toContain(
      "pr_description",
    );
  });

  it("uses only repository knowledge for untrusted forks unless workspace access is explicitly configured", () => {
    const policy = createMemoryPolicyConfig({ memoryEnabled: true });
    expect(
      reviewMemoryRuntimeScopes(authorization, policy).map(
        (value) => value.kind,
      ),
    ).toEqual(["workspace", "repository"]);
    const fork = {
      ...authorization,
      trustDomain: "untrusted_contribution" as const,
    };
    expect(reviewMemoryRuntimeScopes(fork, policy)).toEqual([scope]);
    expect(
      reviewMemoryRuntimeScopes(
        fork,
        createMemoryPolicyConfig({
          memoryEnabled: true,
          forkPullRequestMode: "disabled",
        }),
      ),
    ).toEqual([]);
    expect(
      reviewMemoryRuntimeScopes(
        fork,
        createMemoryPolicyConfig({
          memoryEnabled: true,
          forkPullRequestMode: "workspace_without_user_prefs",
        }),
      ).map((value) => value.kind),
    ).toEqual(["workspace", "repository"]);
    expect(
      reviewMemoryRuntimeScopes(
        authorization,
        createMemoryPolicyConfig({ memoryEnabled: false }),
      ),
    ).toEqual([]);
  });

  it("rejects raw retrieval text and unknown fields before authorizing or querying the provider", async () => {
    const { app, access, service } = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: { ...request, safeRetrievalQuery: "private source sentinel" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.body).not.toContain("private source sentinel");
    expect(access.authorize).not.toHaveBeenCalled();
    expect(service.bundle).not.toHaveBeenCalled();
  });

  it("binds the signed review authorization before provider retrieval and denies a different repository or revision", async () => {
    const { app, service } = await fixture();
    for (const override of [
      { repositoryConnectionId: "another-repo" },
      { authorizationId: "another-auth" },
      { headSha: "f".repeat(40) },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/action/v2/memory/bundle",
        headers,
        payload: { ...request, ...override },
      });
      expect(response.statusCode).toBe(403);
    }
    expect(service.bundle).not.toHaveBeenCalled();
  });

  it("persists only a bodyless admission receipt bound to the exact rendered snapshot", async () => {
    const { app, service, prisma } = await fixture();
    const result = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: request,
    });
    expect(result.statusCode).toBe(200);
    expect(result.headers["cache-control"]).toBe("private, no-store");
    const wire = result.json();
    expect(wire.items[0].body).toBe("Use UTC for persisted event timestamps.");
    expect(service.bundle).toHaveBeenCalledWith(
      expect.objectContaining({
        query:
          "Approved repository review conventions and maintained project knowledge",
        scopes: [{ kind: "workspace", workspaceId: "workspace-1" }, scope],
        limitPerScope: 6,
      }),
      expect.anything(),
    );
    const stored =
      prisma.memoryKnowledgeBundleReceipt.create.mock.calls[0]![0].data;
    expect(JSON.stringify(stored)).not.toContain(wire.items[0].body);
    expect(stored.snapshotHash).toBe(reviewMemorySnapshotHash(wire));
    expect(stored.bindingDigest).toBe(
      memoryKnowledgeDigest(reviewMemoryBinding(binding)),
    );
    const admitted = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/admit",
      headers,
      payload: {
        ...request,
        bundleId: wire.bundleId,
        eligibilityEpoch: wire.eligibilityEpoch,
        policyVersion: wire.policyVersion,
        providerGeneration: wire.providerGeneration,
      },
    });
    expect(admitted.json()).toEqual({ protocolVersion: 2, eligible: true });
  });

  it("rejects authorization changes during retrieval before creating a receipt", async () => {
    const { app, access, prisma } = await fixture();
    access.authorize
      .mockResolvedValueOnce(authorization)
      .mockResolvedValueOnce({ ...authorization, mutationEpoch: 2n });
    const result = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: request,
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ code: "memory_conflict" });
    expect(prisma.memoryKnowledgeBundleReceipt.create).not.toHaveBeenCalled();
  });

  it("disabled memory selects no scope and creates no reusable receipt", async () => {
    const { app, service, prisma } = await fixture(false);
    service.bundle.mockResolvedValue({ ...bundle, scopes: [] });
    service.createBundleReceipt.mockReturnValue({ ...receipt, scopes: [] });
    const result = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: request,
    });
    expect(result.json()).toMatchObject({
      items: [],
      reason: "memory_disabled",
    });
    expect(service.bundle).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: [] }),
      expect.anything(),
    );
    expect(prisma.memoryKnowledgeBundleReceipt.create).not.toHaveBeenCalled();
  });

  it("fails admission for changed policy, expired receipt or provider generation", async () => {
    const { app, policy, rows, service } = await fixture();
    const wire = (
      await app.inject({
        method: "POST",
        url: "/api/action/v2/memory/bundle",
        headers,
        payload: request,
      })
    ).json();
    const admit = {
      ...request,
      bundleId: wire.bundleId,
      eligibilityEpoch: wire.eligibilityEpoch,
      policyVersion: wire.policyVersion,
      providerGeneration: wire.providerGeneration,
    };
    for (const override of [
      { providerGeneration: "old-generation" },
      { eligibilityEpoch: "different-epoch" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/action/v2/memory/admit",
            headers,
            payload: { ...admit, ...override },
          })
        ).json().eligible,
      ).toBe(false);
    policy.getPolicy.mockResolvedValueOnce(
      createMemoryPolicyConfig({ memoryEnabled: true, policyVersion: 2 }),
    );
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/action/v2/memory/admit",
          headers,
          payload: admit,
        })
      ).json().eligible,
    ).toBe(false);
    rows.get(wire.bundleId)!.expiresAt = new Date(0);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/action/v2/memory/admit",
          headers,
          payload: admit,
        })
      ).json().eligible,
    ).toBe(false);
    expect(service.admitReceipt).not.toHaveBeenCalled();
  });

  it("bounds stalled initial authorization and prevents later native calls after the request deadline", async () => {
    const { app, access, service, prisma } = await fixture();
    let resolve!: (value: ReviewRunAuthorization) => void;
    access.authorize.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const start = Date.now();
    const result = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: request,
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ code: "memory_deadline_exceeded" });
    expect(Date.now() - start).toBeLessThan(3_000);
    resolve(authorization);
    await new Promise((done) => setTimeout(done, 10));
    expect(service.bundle).not.toHaveBeenCalled();
    expect(prisma.memoryKnowledgeBundleReceipt.create).not.toHaveBeenCalled();
  });

  it("never returns private native diagnostics", async () => {
    const { app, service } = await fixture();
    service.bundle.mockRejectedValueOnce(
      new Error("private-native-body-sentinel"),
    );
    const result = await app.inject({
      method: "POST",
      url: "/api/action/v2/memory/bundle",
      headers,
      payload: request,
    });
    expect(result.statusCode).toBe(503);
    expect(result.json()).toEqual({ code: "memory_unavailable" });
    expect(result.body).not.toContain("private-native-body-sentinel");
  });
});
