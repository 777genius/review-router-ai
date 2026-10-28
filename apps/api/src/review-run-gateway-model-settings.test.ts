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
    readonly accountModelCatalogEnabled?: boolean;
    readonly source?: "codex" | "openrouter";
  } = {
    accountModelCatalogEnabled: true,
  },
) {
  const source = options.source ?? "codex";
  const profileRef =
    source === "codex"
      ? codexOAuthModelSettingsProfile
      : "openrouter-openai-responses-apikey-v1";
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
      profileRef,
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
  let row: BindingSelection | null = {
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
      owner: { kind: "workspace", workspaceId: "workspace-1" },
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
    ownerRef: `rrw_${createHash("sha256").update("rr-workspace-owner-v1\0workspace-1").digest("hex")}`,
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
          source,
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
  const readAccountModels = vi.fn<ConsumerControlClient["readAccountModels"]>(
    async (request) => {
      if (
        request.ownerRef !== account.ownerRef ||
        request.accountRef !== account.accountRef ||
        request.profileId !== account.profileId ||
        request.expectedAuthorizationEpoch !== account.authorizationEpoch
      )
        throw new Error("fixture_wrong_account_models_scope");
      duringRead?.();
      return structuredClone(catalog);
    },
  );
  const readSettings = createReviewRunGatewayModelSettingsReader({
    ...options,
    accounts: { findBinding: vi.fn(async () => structuredClone(row)) },
    control: { get, readAccountModels },
    profiles: [
      {
        profileId: profileRef,
        protocol: "openai-responses",
        modelIds: [source === "codex" ? "gpt-5.6-sol" : "openai/gpt-5.4-mini"],
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

it("without catalog opt-in preserves only authorized anchors and all live account fences without discovery", async () => {
  const anchor = fixture("gpt-5.6-sol", "ultra", {});
  anchor.readAccountModels.mockRejectedValue(
    new Error("preserved_gateway_has_no_catalog_endpoint"),
  );
  const result = await anchor.issue();
  expect(result.runtimeConfig.runtimeEnv.CODEX_REASONING_EFFORT).toBe("ultra");
  expect(result.runtimeConfig.runtimeEnv).not.toHaveProperty(
    gatewayModelSettingsRuntimeEnvKey,
  );
  expect(anchor.get).toHaveBeenCalledTimes(1);
  expect(anchor.readAccountModels).not.toHaveBeenCalled();
  expect(anchor.issuer).toHaveBeenCalledTimes(1);

  const unseen = fixture("gpt-prefix/dynamic", undefined, {});
  await expect(unseen.issue()).rejects.toThrow();
  expect(unseen.readAccountModels).not.toHaveBeenCalled();
  expect(unseen.issuer).not.toHaveBeenCalled();

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
    expect(stale.readAccountModels).not.toHaveBeenCalled();
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
  accountModelCatalogEnabled: true,
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
