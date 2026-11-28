import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type * as c from "@agent-teams/account-gateway/contracts";
import type { ConsumerControlClient } from "@agent-teams/account-gateway/http";
import type { BindingSelection } from "@reviewrouter/features-provider-accounts";
import {
  canonicalJson,
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewTrustDomain,
  type ReviewRunAuthorization,
  type ReviewRunGatewayExecutionBinding,
} from "@reviewrouter/features-review-run-control";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config/review-configuration";
import { workspacePolicyFixture } from "../../../packages/features/review-config/src/tests/current-policy-fixture";
import { createReviewRunGatewayCheckout } from "./review-run-gateway-checkout";
import type { NativeGatewayRelayPolicyObservation } from "./native-gateway-relay-policy";
import {
  codexOAuthModelSettingsProfile,
  createReviewRunGatewayModelSettingsReader,
  gatewayModelSettingsRuntimeEnvKey,
  serializeSelectedGatewayModelSettings,
  type SelectedGatewayModelSettings,
} from "./review-run-gateway-model-settings";

function fixture(
  model = "gpt-prefix/dynamic",
  reasoningEffort?: "minimal" | "high" | "max" | "ultra",
  options: {
    readonly source?: "codex" | "openrouter" | "glm" | "kimi" | "minimax";
    readonly native?: boolean;
  } = {},
) {
  const source = options.source ?? "codex";
  const profileRef =
    source === "codex"
      ? codexOAuthModelSettingsProfile
      : source === "glm"
        ? "glm-coding-global-responses-apikey-v1"
        : source === "kimi"
          ? "kimi-code-global-responses-apikey-v1"
          : source === "minimax"
            ? "minimax-mplan-global-responses-apikey-v1"
            : "openrouter-openai-responses-apikey-v1";

  const nativeContext = {
    schemaVersion: 1 as const,
    profileId: profileRef,
    providerId: "native-provider",
    productId: "native-product",
  };
  const configuration = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        model,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
        gatewayBindingId: "binding-1",
        gatewayProfileRef: profileRef,
      },
    ],
  });
  const deadline = "2126-01-01T00:00:00.000Z";
  const snapshot = {
    snapshotVersion: 3,
    configurationSource: "workspace",
    configurationVersion: 1,
    workspaceConfigurationVersion: 1,
    repositoryConfigurationVersion: null,
    effectivePolicyDigest: `sha256:${"a".repeat(64)}`,
    agent: {
      profileRef: "codex-default",
      agentKind: "codex",
      binarySha256: "a".repeat(64),
      packageVersion: "0.147.0",
      modelTransports: ["account_gateway"],
      contextGateway: true,
      cancellation: true,
    },
    agentProfileDigest: "b".repeat(64),
    producer: {
      producerReleaseId: "release-1",
      actionCommitSha: "c".repeat(40),
      runtimeCommitSha: "d".repeat(40),
    },
    configurationCanonicalJson: canonicalJson(configuration),
    deadline,
    gateway: {
      providerIndex: 0,
      bindingId: "binding-1",
      connectionId: "connection-private",
      bindingRevision: 1,
      policySubject: "binding-1",
      policyRevision: 1,
      permittedAccountRef: "account-private",
      ...(source === "glm" ? { expectedAuthorizationEpoch: 7 } : {}),
      profileRef,
      ...(options.native ? { nativeContext } : {}),
      invocationId: "invocation-1",
      attemptId: "attempt-1",
      operationId: "operation-1",
      limits: {
        requests: 1,
        concurrency: 1,
        requestBytes: 4096,
        outputBytes: 4096,
        tokens: 4096,
      },
    },
  };
  let authorization = {
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 1,
    sourceRunId: "run-1",
    sourceRunAttempt: "1",
    headSha: "a".repeat(40),
    baseSha: "b".repeat(40),
    mergeBaseSha: "b".repeat(40),
    reviewRevisionHash: "c".repeat(64),
    workflowIdentityHash: "d".repeat(64),
    trustDomain: ReviewTrustDomain.TrustedManaged,
    authorizationId: "authorization-1",
    version: 1,
    maxExpiresAt: new Date(deadline),
    runtimeSnapshotCanonicalJson: canonicalJson(snapshot),
  } as ReviewRunAuthorization;
  // The GLM case uses a personal-owner fixture: a user-owned binding in its owner's workspace.
  const personalOwner = source === "glm";
  let row: BindingSelection | null = {
    ...(personalOwner
      ? {
          personalUse: {
            workspaceId: "workspace-1",
            personalOwnerUserId: "user-1",
            donorUserId: "user-1",
            donorRole: "owner" as const,
          },
        }
      : {}),
    binding: {
      id: "binding-1",
      workspaceId: "workspace-1",
      connectionId: "connection-private",
      state: "active",
      revision: 1,
      policyRevision: 1,
      pendingFence: null,
      fenceAck: null,
    },
    connection: {
      id: "connection-private",
      owner: personalOwner
        ? { kind: "user", userId: "user-1" }
        : { kind: "workspace", workspaceId: "workspace-1" },
      ...(personalOwner ? { authorizationEpochMirror: 7 } : {}),
      gatewayAccountRef: "account-private",
      gatewayOperationRef: null,
      profileRef,
      displayName: "Account",
      state: "active",
      metadataRevision: 1,
    },
  };
  let account: c.Account = {
    accountRef: "account-private",
    ownerRef: personalOwner
      ? `rru_${createHash("sha256").update("rr-user-owner-v1\0user-1").digest("hex")}`
      : `rrw_${createHash("sha256").update("rr-workspace-owner-v1\0workspace-1").digest("hex")}`,
    profileId: profileRef,
    displayName: "Account",
    state: "active",
    metadataRevision: 1,
    authorizationEpoch: 7,
  };
  let catalog: c.AccountModels = {
    status: "snapshot",
    physicalGeneration: "generation-private",
    principalVersion: "principal-private",
    fetchedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 300000).toISOString(),
    ...(source === "codex"
      ? {
          source,
          models: [
            {
              modelId: model,
              reasoning: {
                allowed: ["max", "minimal", "high"],
                default: "high",
              },
              fast: { allowed: ["balanced"], default: "balanced" },
              tools: { allowed: ["function"], default: "function" },
            },
          ],
        }
      : {
          // The GLM plan serves its catalogue from native, not from a vendor source.
          source:
            source === "glm" || source === "kimi" || source === "minimax"
              ? ("native_catalog" as const)
              : ("openrouter" as const),
          models: [
            {
              modelId: model,
              reasoning: null,
              fast: null,
              tools: { allowed: ["function"], default: "function" },
            },
          ],
        }),
  };
  let duringRead: (() => void) | undefined;
  let duringGet: (() => void) | undefined;
  const get = vi.fn<ConsumerControlClient["get"]>(async () => {
    duringGet?.();
    return structuredClone(account);
  });
  const scopedModels: ConsumerControlClient["readAccountModels"] = async (
    request,
  ) => {
    if (
      request.ownerRef !== account.ownerRef ||
      request.accountRef !== account.accountRef ||
      request.profileId !== account.profileId ||
      request.expectedAuthorizationEpoch !== account.authorizationEpoch
    )
      throw new Error("fixture_wrong_account_models_scope");
    duringRead?.();
    return structuredClone(catalog);
  };
  const readAccountModels =
    vi.fn<ConsumerControlClient["readAccountModels"]>(scopedModels);
  const readAccountModelsV2 = vi.fn<
    ConsumerControlClient["readAccountModelsV2"]
  >(async (request, options) => {
    const value = await scopedModels(request, options);
    if (value.status !== "snapshot") return value;
    const { source: _source, ...snapshot } = value;
    void _source;
    return {
      ...snapshot,
      sourceId: "native-models",
      profileId: profileRef,
      admission: { unavailableFallback: "deny" },
    };
  });
  let nativeObservation: NativeGatewayRelayPolicyObservation | undefined = {
    expiresAt: Date.now() + 30_000,
    policy: {
      profiles: [
        {
          outputTokens: 4096,
          profile: {
            profileId: profileRef,
            protocol: "openai-responses",
            modelIds: [model],
            authKinds: [],
            nativeContext,
            modelPolicy: {
              contract: "native-account-models/v2",
              sourceId: "native-models",
              unavailableFallback: "deny",
            },
          },
        },
      ],
      ingressBytes: 4096,
      requestTimeoutMs: 10_000,
      waitBudgetMs: 0,
      maxWaits: 0,
      maxSessions: 4,
      maxInFlight: 2,
    },
  };
  const readSettings = createReviewRunGatewayModelSettingsReader({
    ...options,
    accounts: { findBinding: vi.fn(async () => structuredClone(row)) },
    control: { get, readAccountModels, readAccountModelsV2 },
    ...(options.native
      ? {
          nativePolicySource: {
            read: async () => nativeObservation,
            isFresh: (value: NativeGatewayRelayPolicyObservation) =>
              Date.now() < value.expiresAt,
          },
        }
      : {}),
    profiles: [
      {
        profileId: profileRef,
        protocol: "openai-responses",
        modelIds: [
          source === "codex"
            ? "gpt-5.6-sol"
            : source === "glm"
              ? "glm-5.3-flash"
              : source === "kimi"
                ? "k3-256k"
                : source === "minimax"
                  ? "MiniMax-M3.1-Flash"
                  : "openai/gpt-5.4-mini",
        ],
        authKinds: [source === "codex" ? "oauth" : "api_key"],
      },
    ],
  });
  let live = true;
  let attachment: ReviewRunGatewayExecutionBinding | null = null;
  const issuer = vi.fn(async () => ({
    token: "scm-readonly-token",
    expiresAt: new Date(deadline),
    permissions: { contents: "read" as const, pullRequests: "read" as const },
  }));
  const checkout = createReviewRunGatewayCheckout({
    authorizations: {
      resolveReviewRunAuthorizationToken: async () => ({
        status: ReviewRunAuthorizationTokenResolutionStatus.Valid,
        authorization,
      }),
    },
    bindings: {
      read: async () => ({
        status: live ? ("live" as const) : ("denied" as const),
        binding: attachment,
      }),
    } as never,
    confirmAuthority: async (_token, original) =>
      live && original.version === authorization.version,
    resolveRepository: async () => ({
      githubInstallationId: "123",
      githubRepositoryId: "456",
      repositoryFullName: "owner/repo",
    }),
    issuer: { issueContentsReadToken: issuer },
    readSelectedModelSettings: readSettings,
    maxInFlight: 4,
    timeoutMs: 30000,
  });
  return {
    checkout,
    issuer,
    get,
    readAccountModels,
    readAccountModelsV2,
    nativeSnapshot: () => structuredClone(nativeObservation!),
    nativeCatalog: (value: NativeGatewayRelayPolicyObservation | undefined) => {
      nativeObservation = value;
    },
    configuration,
    read: (epoch?: number) =>
      readSettings({
        authorization,
        signal: new AbortController().signal,
        ...(epoch === undefined ? {} : { executionAuthorizationEpoch: epoch }),
      }),
    issue: () =>
      checkout.issue("authorization-token", new AbortController().signal, {
        providerInstanceId: "codex-rotating:456",
        workflowSchemaVersion: 2,
      }),
    catalog: (value: c.AccountModels) => {
      catalog = value;
    },
    snapshot: () =>
      structuredClone(catalog) as Extract<
        c.AccountModels,
        { status: "snapshot" }
      >,
    during: (work: () => void) => {
      duringRead = work;
    },
    duringGet: (work: () => void) => {
      duringGet = work;
    },
    changeEpoch: () => {
      account = { ...account, authorizationEpoch: 8 };
    },
    foreign: () => {
      account = { ...account, ownerRef: "foreign-owner" };
    },
    remove: () => {
      row = null;
    },
    changeBinding: () => {
      row = row ? { ...row, binding: { ...row.binding, revision: 2 } } : null;
    },
    revoke: () => {
      live = false;
    },
    changeAuthorization: () => {
      authorization = { ...authorization, version: 2 };
    },
    attach: (epoch: number) => {
      attachment = {
        authorizationEpoch: epoch,
      } as ReviewRunGatewayExecutionBinding;
    },
  };
}

it("fails closed when catalog transport is missing and preserves live account fences", async () => {
  const anchor = fixture("gpt-5.6-sol", "ultra");
  anchor.readAccountModels.mockRejectedValue(
    new Error("gateway_has_no_catalog_endpoint"),
  );
  await expect(anchor.issue()).rejects.toThrow();
  expect(anchor.readAccountModels).toHaveBeenCalledTimes(1);
  expect(anchor.issuer).not.toHaveBeenCalled();

  for (const change of [
    "foreign",
    "remove",
    "changeBinding",
    "revoke",
    "changeAuthorization",
  ] as const) {
    const stale = fixture("gpt-5.6-sol", "ultra", {});
    stale.duringGet(stale[change]);
    await expect(stale.issue()).rejects.toThrow();
    expect(stale.issuer).not.toHaveBeenCalled();
  }
  const attached = fixture("gpt-5.6-sol", "ultra", {});
  attached.attach(8);
  await expect(attached.issue()).rejects.toThrow();
  expect(attached.readAccountModels).not.toHaveBeenCalled();
  expect(attached.issuer).not.toHaveBeenCalled();
});

it("exports only deterministic exact-model settings while preserving saved effort omission and private identity", async () => {
  const f = fixture();
  const first = await f.issue();
  expect(first.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT).toBeUndefined();
  const json =
    first.runtimeConfig.runtimeEnv[gatewayModelSettingsRuntimeEnvKey]!;
  expect(json).toBe(
    '{"model":"gpt-prefix/dynamic","reasoning":{"allowed":["minimal","high","max"],"default":"high"}}',
  );
  for (const privateValue of [
    "account-private",
    "generation-private",
    "principal-private",
    "connection-private",
  ])
    expect(JSON.stringify(first)).not.toContain(privateValue);
  const updated = f.snapshot();
  updated.models[0]!.reasoning = {
    allowed: ["high", "max", "minimal"],
    default: "high",
  };
  updated.fetchedAt = new Date().toISOString();
  f.catalog(updated);
  expect(
    (await f.issue()).runtimeConfig.runtimeEnv[
      gatewayModelSettingsRuntimeEnvKey
    ],
  ).toBe(json);
  expect(f.readAccountModels.mock.calls).toHaveLength(2);
});

it.each([undefined, "minimal", "high", "max", "ultra"] as const)(
  "keeps explicit saved effort unchanged while evaluating its wire value: %s",
  async (effort) => {
    const f = fixture("gpt-prefix/dynamic", effort);
    expect(
      (await f.issue()).runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT,
    ).toBe(effort);
  },
);

it("normalizes vendor Ultra/default to Max and represents disabled reasoning precisely", async () => {
  expect(
    serializeSelectedGatewayModelSettings(
      {
        model: "gpt-prefix/dynamic",
        reasoning: { allowed: ["ultra", "max", "high"], default: "ultra" },
      },
      "gpt-prefix/dynamic",
    ),
  ).toBe(
    '{"model":"gpt-prefix/dynamic","reasoning":{"allowed":["high","max"],"default":"max"}}',
  );
  expect(
    serializeSelectedGatewayModelSettings(
      {
        model: "gpt-prefix/dynamic",
        reasoning: { allowed: ["max"], default: "ultra" },
      },
      "gpt-prefix/dynamic",
    ),
  ).toBe(
    '{"model":"gpt-prefix/dynamic","reasoning":{"allowed":["max"],"default":"max"}}',
  );
  const f = fixture();
  const catalog = f.snapshot();
  catalog.models[0]!.reasoning = null;
  f.catalog(catalog);
  expect(
    JSON.parse(
      (await f.issue()).runtimeConfig.runtimeEnv[
        gatewayModelSettingsRuntimeEnvKey
      ]!,
    ),
  ).toEqual({ model: "gpt-prefix/dynamic", reasoning: null });
  const explicit = fixture("gpt-prefix/dynamic", "high");
  explicit.catalog(catalog);
  await expect(explicit.issue()).rejects.toThrow();
  expect(explicit.issuer).not.toHaveBeenCalled();
});

it.each([
  "unknown",
  "unsupported",
  "unavailable",
  "removed",
  "malformed",
] as const)("denies dynamic metadata %s before SCM mint", async (mode) => {
  const f = fixture();
  if (mode === "removed") {
    const catalog = f.snapshot();
    catalog.models = [];
    f.catalog(catalog);
  } else if (mode === "malformed") {
    const catalog = f.snapshot();
    catalog.models[0]!.reasoning = { allowed: ["high"], default: "minimal" };
    f.catalog(catalog);
  } else f.catalog({ status: mode });
  await expect(f.issue()).rejects.toThrow();
  expect(f.issuer).not.toHaveBeenCalled();
});

it("retains unavailable qualified-anchor behavior without fabricated metadata", async () => {
  const f = fixture("gpt-5.6-sol", "ultra");
  f.catalog({ status: "unavailable" });
  const result = await f.issue();
  expect(result.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT).toBe("ultra");
  expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
    gatewayModelSettingsRuntimeEnvKey,
  );
});

it.each([
  "foreign",
  "remove",
  "changeEpoch",
  "changeBinding",
  "revoke",
  "changeAuthorization",
] as const)(
  "rechecks %s during catalog await before releasing settings or minting SCM access",
  async (change) => {
    const f = fixture();
    f.during(f[change]);
    await expect(f.issue()).rejects.toThrow();
    expect(f.issuer).not.toHaveBeenCalled();
  },
);

it("denies source revocation during account GET before catalog access, and mismatched attached execution epochs", async () => {
  const f = fixture();
  f.duringGet(f.remove);
  await expect(f.read()).rejects.toThrow();
  expect(f.readAccountModels).not.toHaveBeenCalled();
  const attached = fixture();
  attached.attach(8);
  await expect(attached.issue()).rejects.toThrow();
  expect(attached.issuer).not.toHaveBeenCalled();
});

it.each([
  { model: "wrong-model", reasoning: null },
  {
    model: "gpt-prefix/dynamic",
    reasoning: { allowed: ["high", "high"], default: "high" },
  },
  { model: "gpt-prefix/dynamic", reasoning: { allowed: [], default: "high" } },
  { model: "gpt-prefix/dynamic", reasoning: null, unexpected: "x" },
  { model: "x".repeat(129), reasoning: null },
])("rejects malformed selected-only wire projections", (value) => {
  expect(() =>
    serializeSelectedGatewayModelSettings(
      value as SelectedGatewayModelSettings,
      "gpt-prefix/dynamic",
    ),
  ).toThrow();
});

it("refuses an explicit effort removed from the current selected-model catalog", async () => {
  const f = fixture("gpt-prefix/dynamic", "high");
  const catalog = f.snapshot();
  catalog.models[0]!.reasoning = { allowed: ["minimal"], default: "minimal" };
  f.catalog(catalog);
  await expect(f.issue()).rejects.toThrow();
  expect(f.issuer).not.toHaveBeenCalled();
});

const openRouterCatalog = {
  source: "openrouter",
} as const;

it("preserves the selected OpenRouter high effort and its advertised medium default without Codex aliases", async () => {
  const model = "vendor/reasoning-model";
  const f = fixture(model, "high", openRouterCatalog);
  const catalog = f.snapshot();
  catalog.models[0]!.reasoning = {
    allowed: ["medium", "high"],
    default: "medium",
  };
  f.catalog(catalog);

  const result = await f.issue();
  expect(result.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT).toBe("high");
  expect(
    JSON.parse(
      result.runtimeConfig.runtimeEnv[gatewayModelSettingsRuntimeEnvKey]!,
    ),
  ).toEqual({
    model,
    reasoning: { allowed: ["medium", "high"], default: "medium" },
  });
  expect(f.configuration.providers[0]!.reasoningEffort).toBe("high");
  expect(f.issuer).toHaveBeenCalledTimes(1);
});

it("rejects the Codex ultra alias for OpenRouter before SCM access even when max is advertised", async () => {
  const f = fixture("vendor/reasoning-model", "ultra", openRouterCatalog);
  const catalog = f.snapshot();
  catalog.models[0]!.reasoning = {
    allowed: ["medium", "high", "max"],
    default: "medium",
  };
  f.catalog(catalog);

  await expect(f.issue()).rejects.toThrow("gateway_model_settings_unavailable");
  expect(f.readAccountModels).toHaveBeenCalledTimes(1);
  expect(f.issuer).not.toHaveBeenCalled();
});

it("checks out a newly discovered OpenRouter model from a full catalog without injecting reasoning or exposing other models", async () => {
  const model = "new-vendor/new-review-model:free";
  const f = fixture(model, undefined, openRouterCatalog);
  const catalog = f.snapshot();
  if (catalog.source !== "openrouter") throw new Error("fixture_source");
  const selected = catalog.models[0]!;
  catalog.models = [
    ...Array.from({ length: 2047 }, (_, index) => ({
      ...selected,
      modelId: `vendor/model-${index}`,
    })),
    selected,
  ];
  f.catalog(catalog);
  const result = await f.issue();
  expect(
    JSON.parse(
      result.runtimeConfig.runtimeEnv[gatewayModelSettingsRuntimeEnvKey]!,
    ),
  ).toEqual({ model, reasoning: null });
  expect(
    result.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT,
  ).toBeUndefined();
  expect(JSON.stringify(result)).not.toMatch(
    /vendor\/model-0|account-private|generation-private|principal-private|connection-private/,
  );
  expect(f.readAccountModels).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: "openrouter-openai-responses-apikey-v1",
      expectedAuthorizationEpoch: 7,
    }),
    expect.anything(),
  );
  expect(f.issuer).toHaveBeenCalledTimes(1);
});

it.each([
  "unknown",
  "unsupported",
  "unavailable",
  "removed",
  "expired",
  "future",
  "wrong-source",
] as const)(
  "refuses OpenRouter %s metadata before minting repository access",
  async (mode) => {
    const f = fixture(
      "new-vendor/new-review-model",
      undefined,
      openRouterCatalog,
    );
    if (mode === "wrong-source") {
      f.catalog(fixture("new-vendor/new-review-model").snapshot());
    } else if (mode === "removed" || mode === "expired" || mode === "future") {
      const catalog = f.snapshot();
      if (mode === "removed") catalog.models = [];
      else if (mode === "future") {
        catalog.fetchedAt = new Date(Date.now() + 60000).toISOString();
        catalog.expiresAt = new Date(Date.now() + 300000).toISOString();
      } else {
        catalog.fetchedAt = new Date(Date.now() - 600000).toISOString();
        catalog.expiresAt = new Date(Date.now() - 300000).toISOString();
      }
      f.catalog(catalog);
    } else f.catalog({ status: mode });
    await expect(f.issue()).rejects.toThrow();
    expect(f.issuer).not.toHaveBeenCalled();
  },
);

it.each([
  "foreign",
  "remove",
  "changeEpoch",
  "changeBinding",
  "revoke",
  "changeAuthorization",
] as const)(
  "rechecks OpenRouter %s after discovery before minting repository access",
  async (change) => {
    const f = fixture(
      "new-vendor/new-review-model",
      undefined,
      openRouterCatalog,
    );
    f.during(f[change]);
    await expect(f.issue()).rejects.toThrow();
    expect(f.issuer).not.toHaveBeenCalled();
  },
);

it("does not infer OpenRouter reasoning efforts or reuse Codex aliases", async () => {
  const f = fixture("new-vendor/new-review-model", "high", openRouterCatalog);
  await expect(f.issue()).rejects.toThrow();
  expect(f.issuer).not.toHaveBeenCalled();
  expect(
    serializeSelectedGatewayModelSettings(
      {
        model: "new-vendor/new-review-model",
        reasoning: { allowed: ["ultra"], default: "ultra" },
      },
      "new-vendor/new-review-model",
      "openrouter-openai-responses-apikey-v1",
    ),
  ).toBe(
    '{"model":"new-vendor/new-review-model","reasoning":{"allowed":["ultra"],"default":"ultra"}}',
  );
});

const glmCatalog = { source: "glm" } as const;

it("checks out the GLM catalogue model beside the anchor from a fresh native_catalog snapshot", async () => {
  const f = fixture("glm-5.3", undefined, glmCatalog);
  const result = await f.issue();
  expect(
    JSON.parse(
      result.runtimeConfig.runtimeEnv[gatewayModelSettingsRuntimeEnvKey]!,
    ),
  ).toEqual({ model: "glm-5.3", reasoning: null });
  expect(f.readAccountModels).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: "glm-coding-global-responses-apikey-v1",
    }),
    expect.anything(),
  );
  expect(f.issuer).toHaveBeenCalledTimes(1);
});

it("keeps the GLM anchor usable when the catalogue is only unavailable, but not the catalogue model", async () => {
  const anchor = fixture("glm-5.3-flash", undefined, glmCatalog);
  anchor.catalog({ status: "unavailable" });
  await anchor.issue();
  expect(anchor.issuer).toHaveBeenCalledTimes(1);

  const other = fixture("glm-5.3", undefined, glmCatalog);
  other.catalog({ status: "unavailable" });
  await expect(other.issue()).rejects.toThrow();
  expect(other.issuer).not.toHaveBeenCalled();
});

it.each([
  "unknown",
  "unsupported",
  "removed",
  "expired",
  "wrong-source",
] as const)(
  "refuses GLM %s catalogue metadata before minting repository access",
  async (mode) => {
    const f = fixture("glm-5.3", undefined, glmCatalog);
    if (mode === "wrong-source") {
      f.catalog(fixture("glm-5.3").snapshot());
    } else if (mode === "removed" || mode === "expired") {
      const catalog = f.snapshot();
      if (mode === "removed") catalog.models = [];
      else {
        catalog.fetchedAt = new Date(Date.now() - 600000).toISOString();
        catalog.expiresAt = new Date(Date.now() - 300000).toISOString();
      }
      f.catalog(catalog);
    } else f.catalog({ status: mode });
    await expect(f.issue()).rejects.toThrow();
    expect(f.issuer).not.toHaveBeenCalled();
  },
);

// Kimi and MiniMax serve a native catalogue too: a live-listed model is checked out
// from a fresh snapshot, and only the anchor survives an unavailable catalogue.
it.each([
  ["kimi", "k3-256k"],
  ["minimax", "MiniMax-M3.1-Flash"],
] as const)(
  "checks out a listed %s model and keeps its anchor when the catalogue is unavailable",
  async (source, anchor) => {
    const live = fixture("vendor/live-listed-model", undefined, { source });
    const result = await live.issue();
    expect(
      JSON.parse(
        result.runtimeConfig.runtimeEnv[gatewayModelSettingsRuntimeEnvKey]!,
      ),
    ).toEqual({ model: "vendor/live-listed-model", reasoning: null });
    expect(live.readAccountModels).toHaveBeenCalledWith(
      expect.objectContaining({
        profileId:
          source === "kimi"
            ? "kimi-code-global-responses-apikey-v1"
            : "minimax-mplan-global-responses-apikey-v1",
      }),
      expect.anything(),
    );

    const unavailable = fixture(anchor, undefined, { source });
    unavailable.catalog({ status: "unavailable" });
    await unavailable.issue();
    expect(unavailable.issuer).toHaveBeenCalledTimes(1);

    const other = fixture("vendor/live-listed-model", undefined, { source });
    other.catalog({ status: "unavailable" });
    await expect(other.issue()).rejects.toThrow();
    expect(other.issuer).not.toHaveBeenCalled();
  },
);

it("recovers native selected model settings with the same reader after discovery failure", async () => {
  const f = fixture("gpt-prefix/dynamic", "ultra", { native: true });
  const catalog = f.nativeSnapshot();
  f.nativeCatalog(undefined);
  await expect(f.read()).rejects.toThrow("gateway_model_settings_unavailable");
  expect(f.get).not.toHaveBeenCalled();
  f.nativeCatalog(catalog);
  await expect(f.read()).resolves.toMatchObject({
    authorizationEpoch: 7,
    settings: { model: "gpt-prefix/dynamic", reasoning: { default: "high" } },
  });
  expect(f.readAccountModelsV2).toHaveBeenCalledTimes(1);
  expect(f.readAccountModels).not.toHaveBeenCalled();
});

it.each(["provider", "product", "disabled", "expired"] as const)(
  "does not replace captured native identity for %s discovery",
  async (change) => {
    const f = fixture("gpt-prefix/dynamic", undefined, { native: true });
    const original = f.nativeSnapshot();
    const selected = original.policy.profiles[0]!;
    f.nativeCatalog({
      ...original,
      expiresAt: change === "expired" ? Date.now() : original.expiresAt,
      policy: {
        ...original.policy,
        profiles: [
          {
            ...selected,
            profile:
              change === "disabled"
                ? {
                    profileId: selected.profile.profileId,
                    protocol: "openai-responses",
                    authKinds: [],
                    modelIds: [],
                  }
                : {
                    ...selected.profile,
                    nativeContext: {
                      ...selected.profile.nativeContext!,
                      ...(change === "provider"
                        ? { providerId: "other-provider" }
                        : change === "product"
                          ? { productId: "other-product" }
                          : {}),
                    },
                  },
          },
        ],
      },
    });
    await expect(f.read()).rejects.toThrow(
      "gateway_model_settings_unavailable",
    );
    expect(f.get).not.toHaveBeenCalled();
    expect(f.readAccountModelsV2).not.toHaveBeenCalled();
  },
);

it("retains native selected-model account fences and rejects qualification expiring during the read", async () => {
  const changed = fixture("gpt-prefix/dynamic", undefined, { native: true });
  changed.during(changed.changeBinding);
  await expect(changed.read()).rejects.toThrow(
    "gateway_model_settings_unavailable",
  );
  const expiring = fixture("gpt-prefix/dynamic", undefined, { native: true });
  const expiry = expiring.nativeSnapshot().expiresAt;
  const clock = vi.spyOn(Date, "now");
  try {
    expiring.during(() => clock.mockReturnValue(expiry));
    await expect(expiring.read()).rejects.toThrow(
      "gateway_model_settings_unavailable",
    );
  } finally {
    clock.mockRestore();
  }
});
