import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
  PrismaProviderAccountRepository,
  type BindingSelection,
} from "@reviewrouter/features-provider-accounts";
import { PrismaActionControlPlaneRepository } from "@reviewrouter/features-action-control-plane";
import {
  conversationDigest,
  type ConversationIdentity,
  type ConversationRecord,
} from "@reviewrouter/features-conversations";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import { createMemoryPolicyConfig } from "@reviewrouter/features-memory";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import {
  createConversationPolicy,
  createConversationPublicationAuthority,
} from "./action-conversation-policy.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  { change: "unchanged", multiple: false },
  { change: "binding", multiple: false },
  { change: "model", multiple: false },
  { change: "unchanged", multiple: true },
  { change: "binding", multiple: true },
  { change: "model", multiple: true },
  { change: "secondary", multiple: true },
] as const)(
  "checks primary companion authority at publication: $change, multiple=$multiple",
  async ({ change, multiple }) => {
    const boundAt = new Date("2026-10-28T01:00:00.000Z");
    const provider = {
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding_old",
      gatewayProfileRef: "gateway-responses-v1",
      model: "old-selected-model",
      agenticContext: false,
      fastMode: false,
    };
    const configuration = (
      selected: typeof provider,
      secondaryModel = "secondary-model",
    ) => ({
      config: parseReviewConfigurationStrict({
        schemaVersion: 3,
        providers: [
          selected,
          ...(multiple
            ? [
                {
                  ...provider,
                  gatewayBindingId: "binding_secondary",
                  model: secondaryModel,
                },
              ]
            : []),
        ],
        execution: {
          providerLimit: multiple ? 2 : 1,
          providerMaxParallel: multiple ? 2 : 1,
          inlineMinAgreement: 1,
        },
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
        reviewLanguage: null,
        investigationRollout: {
          recordingEnabled: false,
          shadowEnabled: false,
          contextCriticEnabled: false,
          verifiedCleanEnabled: false,
          crossRevisionReplayEnabled: false,
          productionEffectsEnabled: false,
        },
      }),
    });
    const captured = configuration(provider);
    const current = configuration(
      {
        ...provider,
        ...(change === "binding"
          ? { gatewayBindingId: "binding_new" }
          : change === "model"
            ? { model: "new-selected-model" }
            : {}),
      },
      change === "secondary" ? "changed-secondary-model" : "secondary-model",
    );
    const read = vi
      .spyOn(
        PrismaActionControlPlaneRepository.prototype,
        "findRuntimeReviewConfiguration",
      )
      .mockResolvedValue(current as never);
    const binding = {
      id: "binding_old",
      workspaceId: "workspace_probe",
      connectionId: "connection_old",
      state: "active",
      revision: 2,
      policyRevision: 2,
      pendingFenceOperationId: null,
      fenceAckOperationId: null,
      workspace: { personalOwnerUserId: null, deletionState: "active" },
      connection: {
        id: "connection_old",
        ownerWorkspaceId: "workspace_probe",
        ownerUserId: null,
        gatewayAccountRef: "account_old",
        profileRef: provider.gatewayProfileRef,
        displayName: "Old account",
        state: "active",
        metadataRevision: 2,
        authorizationEpochMirror: null,
        pendingSourceOperationId: null,
        ownerWorkspace: { personalOwnerUserId: null },
        ownerUser: null,
      },
    };
    const transaction = {
      repositoryConnection: {
        findFirst: async () => ({ id: "repository_probe" }),
      },
      workspaceAccountBinding: {
        findMany: async () => [
          {
            connectionId: binding.connectionId,
            connection: { ownerUserId: null },
          },
        ],
        findUnique: async () => binding,
      },
      $queryRaw: async (query: { strings?: unknown }) =>
        String(query.strings ?? query).includes("ScmRepositoryIdentity")
          ? [{ version: 1, boundAt }]
          : [],
    };
    const authorize = createConversationPublicationAuthority({
      prisma: {} as never,
      runtime: {
        policy: {
          getPolicy: async () => ({ policyVersion: 1, safetyPolicyVersion: 1 }),
        },
      } as never,
      env: {},
      qualification: {
        proofId: "qualified",
        repositories: [
          { workspaceId: "workspace_probe", repositoryId: "repository_probe" },
        ],
      } as never,
      identityBindingEpoch: `1:${boundAt.toISOString()}`,
    });
    try {
      const record = {
        identity: {
          workspaceId: "workspace_probe",
          repositoryId: "repository_probe",
          repositoryStableId: "1234",
        },
        boundManifest: JSON.stringify({
          publication: { enabled: true },
          policyRevision: "1:1:qualified",
          account: {
            workspaceId: "workspace_probe",
            bindingId: "binding_old",
            bindingRevision: 2,
            policySubject: "binding_old",
            policyRevision: 2,
            connectionId: "connection_old",
            gatewayAccountRef: "account_old",
            profileRef: provider.gatewayProfileRef,
            model: provider.model,
            configurationDigest: conversationDigest(captured),
          },
        }),
      } as ConversationRecord;
      expect(await authorize(transaction as never, record)).toBe(
        change === "unchanged",
      );
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      read.mockRestore();
    }
  },
);

function dynamicModelFixture(
  options: {
    source?: "codex" | "openrouter";
    fetchedAt?: string;
    expiresAt?: string;
    large?: boolean;
    oversized?: boolean;
    multiple?: boolean;
    primaryUnavailable?: boolean;
  } = {},
) {
  const profileId = "openrouter-openai-responses-apikey-v1";
  const model = "vendor/dynamic-qualified-model";
  const identity: ConversationIdentity = {
    workspaceId: "workspace_probe",
    repositoryId: "repository_probe",
    repositoryStableId: "1234",
    repositoryFullName: "owner/repository",
    pullRequestNumber: 42,
    threadId: "thread_probe",
    sourceId: "source_probe",
    sourceCommentId: "comment_probe",
    sourceRevision: "revision_probe",
    sourceUpdatedAt: new Date().toISOString(),
    sourceActor: { id: "actor_probe", login: "maintainer", kind: "human" },
  };
  const selection: BindingSelection = {
    binding: {
      id: "binding_probe",
      workspaceId: identity.workspaceId,
      connectionId: "connection_probe",
      state: "active",
      revision: 1,
      policyRevision: 1,
      pendingFence: null,
      fenceAck: null,
    },
    connection: {
      id: "connection_probe",
      owner: { kind: "workspace", workspaceId: identity.workspaceId },
      gatewayAccountRef: "account_probe",
      gatewayOperationRef: null,
      profileRef: profileId,
      displayName: "Account",
      state: "active",
      metadataRevision: 1,
    },
  };
  let config = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        gatewayBindingId: selection.binding.id,
        gatewayProfileRef: profileId,
        model,
        agenticContext: false,
        fastMode: false,
      },
      ...(options.multiple
        ? [
            {
              kind: "codex",
              authMode: "codex_account_gateway",
              gatewayBindingId: "binding_secondary",
              gatewayProfileRef: profileId,
              model: "vendor/secondary-model",
              agenticContext: false,
              fastMode: false,
            },
          ]
        : []),
    ],
    execution: {
      ...workspacePolicyFixture.execution,
      providerLimit: options.multiple ? 2 : 1,
      providerMaxParallel: options.multiple ? 2 : 1,
    },
  });
  vi.spyOn(
    PrismaActionControlPlaneRepository.prototype,
    "findRuntimeReviewConfiguration",
  ).mockImplementation(async () => ({ config }) as never);
  const bindingReads = vi
    .spyOn(PrismaProviderAccountRepository.prototype, "findBinding")
    .mockResolvedValue(options.primaryUnavailable ? null : selection);
  const transaction = {
    $queryRaw: async () => [],
    workspaceAccountBinding: {
      findMany: async () => [
        {
          connectionId: selection.connection.id,
          connection: { ownerUserId: null },
        },
      ],
    },
  };
  const ownerRef = `rrw_${createHash("sha256")
    .update(`rr-workspace-owner-v1\0${identity.workspaceId}`)
    .digest("hex")}`;
  const source = options.source ?? "openrouter";
  const capability = (modelId: string) => ({
    modelId,
    reasoning: null,
    fast:
      source === "codex"
        ? { allowed: ["balanced"], default: "balanced" }
        : null,
    tools:
      source === "codex"
        ? { allowed: ["function"], default: "function" }
        : { allowed: ["none"], default: "none" },
  });
  const catalog = {
    status: "snapshot",
    physicalGeneration: "generation_probe",
    principalVersion: "principal_probe",
    source,
    fetchedAt: options.fetchedAt ?? new Date().toISOString(),
    expiresAt:
      options.expiresAt ?? new Date(Date.now() + 300_000).toISOString(),
    models: [
      ...(options.large
        ? Array.from({ length: 2047 }, (_, index) =>
            capability(`vendor/filler-${index}-`.padEnd(128, "x")),
          )
        : []),
      capability(model),
    ],
  };
  const catalogJson = JSON.stringify(catalog);
  const fetch = vi.fn(
    async (target: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(target)).pathname;
      if (path === "/v1/accounts/account_probe")
        return Response.json({
          accountRef: selection.connection.gatewayAccountRef,
          ownerRef,
          profileId,
          displayName: "Account",
          state: "active",
          metadataRevision: 1,
          authorizationEpoch: 7,
        });
      if (path === "/v1/account-models/read") {
        expect(JSON.parse(String(init?.body))).toEqual({
          ownerRef,
          accountRef: selection.connection.gatewayAccountRef,
          profileId,
          expectedAuthorizationEpoch: 7,
        });
        return new Response(
          catalogJson + (options.oversized ? " ".repeat(2 * 1024 * 1024) : ""),
          { headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(`unexpected_gateway_path:${path}`);
    },
  );
  vi.stubGlobal("fetch", fetch);
  const limits = {
    requests: 1,
    concurrency: 1,
    requestBytes: 131_072,
    outputBytes: 262_144,
    tokens: 2048,
  };
  let memorySettings = { requireConfirmation: false, settingsRevision: "0" };
  const policy = createConversationPolicy({
    prisma: {
      $transaction: async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as never,
    runtime: {
      policy: {
        getPolicy: async () => createMemoryPolicyConfig(memorySettings),
      },
    } as never,
    qualification: {
      profileVersion: 1,
      proofId: "qualified-catalog-probe",
      sourceProcessingProfile: "transient-checked-inline-v1",
      runtimeSha: "a".repeat(40),
      repositories: [identity],
      models: [
        {
          profileId,
          model,
          contextWindowTokens: 131_072,
          tokensPerByteUpperBound: 4,
        },
      ],
    },
    env: {
      REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: "https://gateway.example",
      REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER: "bounded-probe-bearer",
      REVIEW_ROUTER_ACCOUNT_GATEWAY_POLICY: JSON.stringify({
        profiles: [{ profileRef: profileId, limits }],
      }),
      REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: JSON.stringify({
        profiles: [
          {
            profile: {
              profileId,
              protocol: "openai-responses",
              modelIds: ["openai/gpt-5.4-mini"],
              authKinds: ["api_key"],
            },
            outputTokens: 2048,
          },
        ],
        ingressBytes: 131_072,
        requestTimeoutMs: 10_000,
        waitBudgetMs: 0,
        maxWaits: 0,
        maxSessions: 1,
        maxInFlight: 1,
      }),
    },
    admitMemory: async () => true,
  });
  return {
    fetch,
    model,
    catalogBytes: Buffer.byteLength(catalogJson),
    bindingReads,
    setMemoryConfirmation: (required: boolean) => {
      memorySettings = {
        requireConfirmation: required,
        settingsRevision: String(Number(memorySettings.settingsRevision) + 1),
      };
    },
    reorder: () => {
      config = parseReviewConfigurationStrict({
        ...config,
        providers: [...config.providers].reverse(),
      });
    },
    capture: () =>
      policy.capture(identity, "processing_probe", {
        deadlineAt: new Date(Date.now() + 30_000),
      }),
  };
}

it("admits the exact qualified dynamic model without a catalog rollout gate", async () => {
  const f = dynamicModelFixture();
  const policy = await f.capture();
  expect(policy.bindingManifest.model).toBe(f.model);
  expect(
    await policy.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
  ).toBe(true);
  expect(
    f.fetch.mock.calls.filter(([target]) =>
      String(target).endsWith("/v1/account-models/read"),
    ),
  ).toHaveLength(2);
});

it("defaults to automatic and rejects a captured request after workspace confirmation changes", async () => {
  const f = dynamicModelFixture();
  const initial = await f.capture();
  expect(initial.requireConfirmation).toBe(false);
  expect(initial.bindingManifest.memorySettings).toEqual({
    requireConfirmation: false,
    revision: "0",
  });
  f.setMemoryConfirmation(true);
  expect(
    await initial.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
  ).toBe(false);
  const changed = await f.capture();
  expect(changed.requireConfirmation).toBe(true);
  expect(changed.revision).toBe(initial.revision);
  expect(changed.bindingManifest.memorySettings).toEqual({
    requireConfirmation: true,
    revision: "1",
  });
});

it.each([
  { source: "codex" as const },
  { fetchedAt: new Date(Date.now() + 60_000).toISOString() },
  {
    fetchedAt: new Date(Date.now() - 120_000).toISOString(),
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
  },
])("rejects an inapplicable dynamic model snapshot %j", async (options) => {
  const f = dynamicModelFixture(options);
  await expect(f.capture()).rejects.toThrow("unavailable");
});

it("reads the complete qualified account catalog beyond the old 256KiB bound", async () => {
  const f = dynamicModelFixture({ large: true });
  expect(f.catalogBytes).toBeGreaterThan(262_144);
  expect(f.catalogBytes).toBeLessThan(2 * 1024 * 1024);
  expect((await f.capture()).bindingManifest.model).toBe(f.model);
});

it("keeps the SDK account catalog response bounded at 2MiB", async () => {
  const f = dynamicModelFixture({ oversized: true });
  await expect(f.capture()).rejects.toThrow("unavailable");
});

it("uses only the primary reviewer's existing account/model in a multi-reviewer conversation", async () => {
  const f = dynamicModelFixture({ multiple: true });
  const policy = await f.capture();
  expect(policy.bindingManifest).toMatchObject({
    bindingId: "binding_probe",
    model: f.model,
  });
  expect(
    await policy.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
  ).toBe(true);
  expect(f.bindingReads.mock.calls.length).toBeGreaterThan(0);
  for (const [selection] of f.bindingReads.mock.calls)
    expect(selection.bindingId).toBe("binding_probe");
  f.reorder();
  expect(
    await policy.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
  ).toBe(false);
});

it("does not silently spend a secondary account when the primary reviewer is unavailable", async () => {
  const f = dynamicModelFixture({ multiple: true, primaryUnavailable: true });
  await expect(f.capture()).rejects.toThrow();
  expect(f.bindingReads).toHaveBeenCalledTimes(1);
  expect(f.bindingReads.mock.calls[0]![0].bindingId).toBe("binding_probe");
  expect(f.fetch).not.toHaveBeenCalled();
});
