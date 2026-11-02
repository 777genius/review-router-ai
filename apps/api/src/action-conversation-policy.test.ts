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
  createConversationCandidatePolicy,
  conversationCandidateMemoryPolicy,
  createConversationPublicationAuthority,
  type ConversationCapturedPolicy,
} from "./action-conversation-policy.js";
import * as conversationInference from "./action-conversation-inference.js";
import { conversationCapabilityFixture } from "../../../packages/platform/config/src/tests/conversation-qualification-fixture.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  {
    templateConfirmation: false,
    disposableConfirmation: false,
    expected: false,
  },
  { templateConfirmation: true, disposableConfirmation: false, expected: true },
  { templateConfirmation: false, disposableConfirmation: true, expected: true },
  { templateConfirmation: true, disposableConfirmation: true, expected: true },
])(
  "keeps the same effective candidate confirmation policy for capture and writes: %j",
  ({ templateConfirmation, disposableConfirmation, expected }) => {
    const template = createMemoryPolicyConfig({
      memoryEnabled: true,
      automaticLearning: true,
      requireConfirmation: templateConfirmation,
      settingsRevision: "7",
    });
    const disposable = createMemoryPolicyConfig({
      memoryEnabled: true,
      automaticLearning: true,
      requireConfirmation: disposableConfirmation,
      settingsRevision: "3",
    });
    expect(
      conversationCandidateMemoryPolicy(template, disposable),
    ).toMatchObject({
      memoryEnabled: true,
      automaticLearning: true,
      requireConfirmation: expected,
      settingsRevision: "3",
    });
    for (const restricted of [template, disposable]) {
      expect(
        conversationCandidateMemoryPolicy(
          { ...template, memoryEnabled: restricted !== template },
          { ...disposable, memoryEnabled: restricted !== disposable },
        ).memoryEnabled,
      ).toBe(false);
      expect(
        conversationCandidateMemoryPolicy(
          { ...template, automaticLearning: restricted !== template },
          { ...disposable, automaticLearning: restricted !== disposable },
        ).automaticLearning,
      ).toBe(false);
    }
  },
);

const publicationCases = [
  { change: "unchanged", multiple: false },
  { change: "binding", multiple: false },
  { change: "model", multiple: false },
  { change: "unchanged", multiple: true },
  { change: "binding", multiple: true },
  { change: "model", multiple: true },
  { change: "secondary", multiple: true },
] as const;
it.each([
  ...publicationCases.flatMap((input) => [
    { ...input, capabilityV2: false, frozenV2: false },
    { ...input, capabilityV2: true, frozenV2: true },
  ]),
  {
    change: "qualification",
    multiple: false,
    capabilityV2: true,
    frozenV2: true,
  },
  {
    change: "qualification-downgrade",
    multiple: false,
    capabilityV2: false,
    frozenV2: true,
  },
  {
    change: "qualification-upgrade",
    multiple: false,
    capabilityV2: true,
    frozenV2: false,
  },
  {
    change: "source-stamp",
    multiple: false,
    capabilityV2: true,
    frozenV2: true,
  },
])(
  "checks primary companion authority at publication: $change, multiple=$multiple, capabilityV2=$capabilityV2, frozenV2=$frozenV2",
  async ({ change, multiple, capabilityV2, frozenV2 }) => {
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
    const mechanism = conversationCapabilityFixture({
      proofId: "qualified",
      models: [
        {
          profileId: provider.gatewayProfileRef,
          model: provider.model,
          contextWindowTokens: 128000,
          tokensPerByteUpperBound: 4,
        },
      ],
    });
    if (change === "source-stamp")
      mechanism.sourceProfile.accountPolicySourceDigest = "0".repeat(64);
    const qualification = capabilityV2
      ? mechanism
      : {
          profileVersion: 1 as const,
          proofId: "qualified",
          sourceProcessingProfile:
            "transient-checked-inline-gateway-full-thread-v1" as const,
          runtimeSha: "a".repeat(40),
          models: mechanism.models,
          repositories: [
            {
              workspaceId: "workspace_probe",
              repositoryId: "repository_probe",
            },
          ],
        };
    const authorize = createConversationPublicationAuthority({
      prisma: {} as never,
      runtime: {
        policy: {
          getPolicy: async () => ({ policyVersion: 1, safetyPolicyVersion: 1 }),
        },
      } as never,
      env: {},
      qualification,
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
            ...(frozenV2
              ? {
                  qualificationCapabilityDigest:
                    change === "qualification"
                      ? "0".repeat(64)
                      : conversationDigest(mechanism),
                }
              : {}),
          },
        }),
      } as ConversationRecord;
      expect(await authorize(transaction as never, record)).toBe(
        change === "unchanged",
      );
      expect(read).toHaveBeenCalledTimes(
        change.startsWith("qualification") || change === "source-stamp" ? 0 : 1,
      );
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
    candidate?: boolean;
    automaticLearning?: boolean;
    capabilityV2?: boolean;
    personal?: boolean;
    workspaceId?: string;
    repositoryId?: string;
    accountRef?: string;
    qualifiedProfile?: string;
    qualifiedModel?: string;
    staleSource?: boolean;
    configuredTokens?: number;
    profileOutputTokens?: number;
    sourceProcessingProfile?:
      | "transient-checked-inline-v1"
      | "transient-checked-inline-gateway-v1"
      | "transient-checked-inline-gateway-full-thread-v1";
  } = {},
) {
  const profileId = "openrouter-openai-responses-apikey-v1";
  const model = "vendor/dynamic-qualified-model";
  const identity: ConversationIdentity = {
    workspaceId: options.workspaceId ?? "workspace_probe",
    repositoryId: options.repositoryId ?? "repository_probe",
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
      owner: options.personal
        ? { kind: "user", userId: "selected-user" }
        : { kind: "workspace", workspaceId: identity.workspaceId },
      gatewayAccountRef: options.accountRef ?? "account_probe",
      gatewayOperationRef: null,
      profileRef: profileId,
      displayName: "Account",
      state: "active",
      metadataRevision: 1,
      ...(options.personal ? { authorizationEpochMirror: 7 } : {}),
    },
    ...(options.personal
      ? {
          personalUse: {
            workspaceId: identity.workspaceId,
            personalOwnerUserId: null,
            donorUserId: "selected-user",
            donorRole: "owner" as const,
          },
        }
      : {}),
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
  let repositorySelected = true;
  const transaction = {
    $queryRaw: async () => [],
    repositoryConnection: {
      findFirst: vi.fn(async () =>
        repositorySelected ? { id: identity.repositoryId } : null,
      ),
    },
    conversationProcessing: {
      findFirst: vi.fn(async () => ({
        boundManifest: JSON.stringify({
          account: captured!.policy.bindingManifest,
        }),
      })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    workspaceAccountBinding: {
      findMany: async () => [
        {
          connectionId: selection.connection.id,
          connection: {
            ownerUserId: options.personal ? "selected-user" : null,
          },
        },
      ],
    },
  };
  const ownerRef = `${options.personal ? "rru" : "rrw"}_${createHash("sha256")
    .update(
      options.personal
        ? "rr-user-owner-v1\0selected-user"
        : `rr-workspace-owner-v1\0${identity.workspaceId}`,
    )
    .digest("hex")}`;
  let remote = { ownerRef, profileId, authorizationEpoch: 7 };
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
      if (path === `/v1/accounts/${selection.connection.gatewayAccountRef}`)
        return Response.json({
          accountRef: selection.connection.gatewayAccountRef,
          ...remote,
          displayName: "Account",
          state: "active",
          metadataRevision: 1,
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
    tokens: options.configuredTokens ?? 2048,
  };
  let memorySettings = { requireConfirmation: false, settingsRevision: "0" };
  let captured: ConversationCapturedPolicy | undefined;
  const construction: Parameters<typeof createConversationPolicy>[0] = {
    prisma: {
      conversationProcessing: transaction.conversationProcessing,
      $transaction: async (callback: (tx: typeof transaction) => unknown) =>
        callback(transaction),
    } as never,
    runtime: {
      policy: {
        getPolicy: async () =>
          createMemoryPolicyConfig({
            ...memorySettings,
            automaticLearning: options.automaticLearning ?? true,
          }),
      },
    } as never,
    qualification: options.capabilityV2
      ? conversationCapabilityFixture({
          ...(options.staleSource
            ? {
                sourceProfile: {
                  ...conversationCapabilityFixture().sourceProfile,
                  accountPolicySourceDigest: "0".repeat(64),
                },
              }
            : {}),
          models: [
            {
              profileId: options.qualifiedProfile ?? profileId,
              model: options.qualifiedModel ?? model,
              contextWindowTokens: 131_072,
              tokensPerByteUpperBound: 4,
            },
          ],
        })
      : {
          profileVersion: 1,
          proofId: "qualified-catalog-probe",
          sourceProcessingProfile:
            options.sourceProcessingProfile ?? "transient-checked-inline-v1",
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
      ...(options.personal
        ? { REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED: "1" }
        : {}),
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
            outputTokens: options.profileOutputTokens ?? 2048,
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
    onCaptured: (value) => {
      captured = value;
    },
  };
  const { qualification, ...shared } = construction;
  const policy = options.candidate
    ? createConversationCandidatePolicy({
        ...shared,
        candidateRunId: "measurement:full-product:scenario",
        template: identity,
        models: qualification.models,
      })
    : createConversationPolicy(construction);
  const namespace = `eval_${"a".repeat(40)}`;
  const processingIdentity = options.candidate
    ? {
        ...identity,
        workspaceId: `${namespace}_workspace`,
        repositoryId: namespace,
        repositoryStableId: `synthetic:${namespace}`,
        repositoryFullName: `disposable/${namespace}`,
      }
    : identity;
  return {
    fetch,
    model,
    catalogBytes: Buffer.byteLength(catalogJson),
    bindingReads,
    identity,
    processingIdentity,
    qualification,
    transaction,
    unselectRepository: () => {
      repositorySelected = false;
    },
    changeRemote: (change: Partial<typeof remote>) => {
      remote = { ...remote, ...change };
    },
    checkSelection: () => captured!.checkSelection(transaction as never),
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
    capture: (value = processingIdentity) =>
      policy.capture(value, "processing_probe", {
        deadlineAt: new Date(Date.now() + 30_000),
      }),
  };
}

it.each([
  {
    workspaceId: "new-workspace-a",
    repositoryId: "new-repository-a",
    accountRef: "selected-account-a",
  },
  {
    workspaceId: "new-workspace-b",
    repositoryId: "new-repository-b",
    accountRef: "selected-account-b",
  },
])(
  "v2 reuses mechanism/model evidence with the current primary user account for $repositoryId",
  async (scope) => {
    const f = dynamicModelFixture({
      ...scope,
      capabilityV2: true,
      personal: true,
    });
    const policy = await f.capture();
    expect(policy.automaticLearning).toBe(true);
    expect(policy.bindingManifest.qualificationCapabilityDigest).toBe(
      conversationDigest(f.qualification),
    );
    expect(policy.bindingManifest).toMatchObject({
      workspaceId: scope.workspaceId,
      gatewayAccountRef: scope.accountRef,
      expectedAuthorizationEpoch: 7,
      model: f.model,
    });
    expect(
      await policy.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
    ).toBe(true);
    expect(await f.checkSelection()).toBe(true);
    for (const [selection] of f.bindingReads.mock.calls)
      expect(selection).toMatchObject({
        workspaceId: scope.workspaceId,
        bindingId: "binding_probe",
      });
  },
);

it.each([
  { ownerRef: "another-user" },
  { profileId: "another-profile" },
  { authorizationEpoch: 8 },
])("v2 does not authorize changed user account facts %j", async (change) => {
  const f = dynamicModelFixture({ capabilityV2: true, personal: true });
  const policy = await f.capture();
  f.changeRemote(change);
  expect(
    await policy.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
  ).toBe(false);
});

it("v2 still rejects unselected repositories and foreign workspace bindings", async () => {
  const f = dynamicModelFixture({ capabilityV2: true, personal: true });
  await f.capture();
  f.unselectRepository();
  expect(await f.checkSelection()).toBe(false);
  expect(f.transaction.repositoryConnection.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        selected: true,
        archived: false,
        installation: { status: "active" },
      }),
    }),
  );
  await expect(
    f.capture({ ...f.identity, workspaceId: "foreign-workspace" }),
  ).rejects.toThrow();
});

it.each([
  { qualifiedProfile: "unqualified-profile" },
  { qualifiedModel: "unqualified-model" },
  { staleSource: true },
])("v2 retains exact model/profile qualification %j", async (options) => {
  const f = dynamicModelFixture({ capabilityV2: true, ...options });
  await expect(f.capture()).rejects.toThrow("unavailable");
  expect(f.fetch).not.toHaveBeenCalled();
});

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

// A native Hindsight semantic-preview proof cannot authorize a new Gateway paid extractor.
it.each([
  ["transient-checked-inline-v1", false],
  ["transient-checked-inline-gateway-v1", false],
  ["transient-checked-inline-gateway-full-thread-v1", true],
] as const)(
  "requires the Gateway source-processing capability for learning: %s",
  async (sourceProcessingProfile, automaticLearning) => {
    const f = dynamicModelFixture({ sourceProcessingProfile });
    expect((await f.capture()).automaticLearning).toBe(automaticLearning);
  },
);

it("candidate measurement retains the selected template account without manufacturing a qualification", async () => {
  const f = dynamicModelFixture({ candidate: true });
  const policy = await f.capture();
  expect(policy.automaticLearning).toBe(true);
  expect(policy.revision).toContain("candidate-eval:measurement:");
  expect(policy.bindingManifest).toMatchObject({
    gatewayAccountRef: "account_probe",
    workspaceId: "workspace_probe",
    model: f.model,
    candidateEvaluationRunId: "measurement:full-product:scenario",
  });
  expect(policy.bindingManifest).not.toHaveProperty("qualificationProofId");
  expect(await f.checkSelection()).toBe(true);
  expect(f.transaction.repositoryConnection.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: "repository_probe",
        githubRepositoryId: 1234n,
      }),
    }),
  );
});

it("candidate repository-isolation suffixes retain the same primary account and fresh settings authority", async () => {
  const f = dynamicModelFixture({ candidate: true });
  const id = `${f.processingIdentity.repositoryId}_service-a`;
  const policy = await f.capture({
    ...f.processingIdentity,
    repositoryId: id,
    repositoryStableId: `synthetic:${id}`,
    repositoryFullName: `disposable/${id}`,
  });
  expect(policy.bindingManifest).toMatchObject({
    gatewayAccountRef: "account_probe",
    model: f.model,
    candidateEvaluationRunId: "measurement:full-product:scenario",
    memorySettings: {
      requireConfirmation: false,
      revision: "0",
      templateRevision: "0",
    },
  });
  f.setMemoryConfirmation(true);
  expect(
    await policy.isCurrent({ deadlineAt: new Date(Date.now() + 30_000) }),
  ).toBe(false);
  expect(await f.checkSelection()).toBe(false);
  await expect(
    f.capture({
      ...f.processingIdentity,
      repositoryId: "repository_probe",
      repositoryStableId: "synthetic:repository_probe",
      repositoryFullName: "disposable/repository_probe",
    }),
  ).rejects.toThrow();
});

it("candidate measurement preserves the template's disabled standing learning policy", async () => {
  const f = dynamicModelFixture({ candidate: true, automaticLearning: false });
  expect((await f.capture()).automaticLearning).toBe(false);
});

it("candidate constructor cannot capture a real production processing scope", async () => {
  const f = dynamicModelFixture({ candidate: true });
  await expect(f.capture(f.identity)).rejects.toMatchObject({
    code: "forbidden",
  });
  expect(f.bindingReads).not.toHaveBeenCalled();
  expect(f.fetch).not.toHaveBeenCalled();
});

it("candidate selection changes invalidate the same frozen primary-account guard", async () => {
  const f = dynamicModelFixture({ candidate: true, multiple: true });
  await f.capture();
  f.reorder();
  expect(await f.checkSelection()).toBe(false);
});

it("candidate paid admission and observations address its disposable row, not the template row", async () => {
  let transport:
    | Parameters<
        typeof conversationInference.createConversationGatewayInference
      >[0]
    | undefined;
  vi.spyOn(
    conversationInference,
    "createConversationGatewayInference",
  ).mockImplementation((value) => {
    transport = value;
    return {
      generate: async () => {
        throw new Error("no_model_call_in_candidate_scope_test");
      },
    };
  });
  const f = dynamicModelFixture({ candidate: true });
  await f.capture();
  expect(
    await transport!.admitDispatch!({
      deadlineAt: new Date(Date.now() + 10_000),
    }),
  ).toBe(true);
  expect(f.transaction.conversationProcessing.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        id: "processing_probe",
        workspaceId: f.processingIdentity.workspaceId,
        repositoryId: f.processingIdentity.repositoryId,
      }),
    }),
  );
  await transport!.onObserved!({
    model: f.model,
    usage: null,
    effect: "completed",
    cleanup: "closed",
  });
  expect(f.transaction.conversationProcessing.updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        id: "processing_probe",
        workspaceId: f.processingIdentity.workspaceId,
        repositoryId: f.processingIdentity.repositoryId,
      },
    }),
  );
});

it.each([
  { cleanup: "closed", effect: "not_dispatched", settled: true },
  { cleanup: "closed", effect: "rejected_before_dispatch", settled: true },
  { cleanup: "closed", effect: "completed", settled: true },
  { cleanup: "closed", effect: "effect_unknown", settled: false },
  { cleanup: "closed", effect: "dispatch_started", settled: false },
  { cleanup: "closed", effect: "response_started", settled: false },
  { cleanup: "pending", effect: "not_dispatched", settled: false },
  { cleanup: "pending", effect: "completed", settled: false },
] as const)(
  "parent cleanup $cleanup and outcome $effect fence child authority unless settled",
  async ({ cleanup, effect, settled }) => {
    let transport:
      | Parameters<
          typeof conversationInference.createConversationGatewayInference
        >[0]
      | undefined;
    vi.spyOn(
      conversationInference,
      "createConversationGatewayInference",
    ).mockImplementation((value) => {
      transport = value;
      return {
        generate: async () => {
          throw new Error("synthetic_no_model_call");
        },
      };
    });
    const f = dynamicModelFixture({ candidate: true });
    const policy = await f.capture();
    const controls = { deadlineAt: new Date(Date.now() + 10_000) };
    expect(await policy.isCurrent(controls)).toBe(true);
    expect(await f.checkSelection()).toBe(true);
    await transport!.onObserved!({
      model: null,
      usage: null,
      effect,
      cleanup,
    });
    expect(await policy.isCurrent(controls)).toBe(settled);
    expect(await f.checkSelection()).toBe(settled);
    expect(
      f.transaction.conversationProcessing.updateMany,
    ).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: {
          observedModel: null,
          requestEffect: cleanup === "pending" ? "cleanup_pending" : effect,
        },
      }),
    );
  },
);

it.each([
  { configuredTokens: 32768, profileOutputTokens: 32768, expected: 8192 },
  { configuredTokens: 1024, profileOutputTokens: 32768, expected: 1024 },
  { configuredTokens: 32768, profileOutputTokens: 1536, expected: 1536 },
])(
  "freezes one combined output budget within both configured ceilings: %j",
  async ({ expected, ...ceilings }) => {
    const f = dynamicModelFixture(ceilings);
    const policy = await f.capture();
    expect(policy.maxOutputTokens).toBe(expected);
    expect(policy.bindingManifest.limits).toMatchObject({ tokens: expected });
  },
);
