import { afterEach, expect, test, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  PrismaProviderAccountRepository,
  type BindingSelection,
} from "@reviewrouter/features-provider-accounts";
import type * as c from "@agent-teams/account-gateway/contracts";
import { GatewayError } from "@agent-teams/account-gateway/http";
import type { ReviewProviderConfiguration } from "@reviewrouter/features-review-config";
import { createGatewayModelAccountOptions } from "./gateway-model-account-options";
import { assertGatewayReviewConfigSupported } from "./gateway-review-config-catalog";

afterEach(() => vi.restoreAllMocks());
const setting = (
  modelId: string,
): Extract<c.AccountModels, { source: "codex" }>["models"][number] => ({
  modelId,
  reasoning: {
    allowed: ["minimal", "high"],
    default: "high",
  },
  fast: { allowed: ["balanced"], default: "balanced" },
  tools: { allowed: ["function"], default: "function" },
});
const snapshot = (
  models: string[],
  source: "codex" | "openrouter" = "codex",
): c.AccountModels => ({
  status: "snapshot",
  physicalGeneration: "generation-private",
  principalVersion: "principal-private",
  fetchedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 300000).toISOString(),
  ...(source === "codex"
    ? { source, models: models.map(setting) }
    : {
        source,
        models: models.map((modelId) => ({
          modelId,
          reasoning: null,
          fast: null,
          tools: { allowed: ["function"], default: "function" },
        })),
      }),
});
const catalogEnabled = {
  REVIEW_ROUTER_CODEX_ACCOUNT_MODEL_CATALOG_ENABLED: "1",
};
function fixture(
  env: Readonly<Record<string, string | undefined>> = {},
  source: "codex" | "openrouter" = "codex",
) {
  const profileRef =
    source === "codex"
      ? "openai-codex-oauth-responses-v1"
      : "openrouter-openai-responses-apikey-v1";
  let authorized = true;
  let revision = 1;
  let duringModels: (() => void) | undefined;
  let response = snapshot(["new-authorized-model"], source);
  vi.spyOn(
    PrismaProviderAccountRepository.prototype,
    "findBinding",
  ).mockImplementation(
    async ({ bindingId }) =>
      ({
        binding: {
          id: bindingId,
          connectionId: "connection-private",
          workspaceId: "workspace",
          state: "active",
          revision,
          policyRevision: 1,
          pendingFence: null,
          fenceAck: null,
        },
        connection: {
          id: "connection-private",
          owner: { kind: "workspace", workspaceId: "workspace" },
          gatewayAccountRef: "account-private",
          gatewayOperationRef: null,
          profileRef,
          displayName: "Account",
          state: "active",
          metadataRevision: 1,
        },
      }) satisfies BindingSelection,
  );
  const readAccountModels = vi.fn(async () => {
    duringModels?.();
    return response;
  });
  const get = vi.fn(
    async (): Promise<c.Account> => ({
      accountRef: "account-private",
      ownerRef: "owner-private",
      profileId: profileRef,
      displayName: "Account",
      state: "active",
      metadataRevision: 1,
      authorizationEpoch: 7,
    }),
  );
  const prisma = {
    workspace: {
      findUnique: async () =>
        authorized
          ? {
              personalOwnerUserId: null,
              deletionState: "active",
              members: [{ role: "member" }],
            }
          : null,
    },
    $queryRaw: async () => [{ id: "binding" }],
  } as unknown as PrismaClient;
  const api = createGatewayModelAccountOptions({
    prisma,
    env,
    profiles: [
      {
        id: profileRef,
        label: source === "codex" ? "Codex" : "OpenRouter",
        protocol: "openai-responses",
        provider: source,
        authKind: source === "codex" ? "oauth" : "api_key",
        models: ["old-seed"],
      },
    ],
    gateway: { get, readAccountModels },
    ownerRef: () => "owner-private",
    authorizeWorkspace: async () => ({
      workspaceId: "workspace",
      actor: { userId: "viewer" },
    }),
  });
  return {
    api,
    get,
    readAccountModels,
    respond: (value: c.AccountModels) => {
      response = value;
    },
    revoke: () => {
      duringModels = () => {
        authorized = false;
      };
    },
    changeBinding: () => {
      duringModels = () => {
        revision += 1;
      };
    },
  };
}

// RED if first paint discovers all account catalogs, a seed replaces an empty
// snapshot, private identities escape, or a model from another source probes.
test("discovers only selected account models and uses the same capabilities for probes", async () => {
  const f = fixture(catalogEnabled);
  const page = await f.api.list();
  expect(page.status).toBe("ok");
  expect(f.readAccountModels).not.toHaveBeenCalled();
  const result = await f.api.get("binding", { forceRefresh: true });
  expect(f.readAccountModels).toHaveBeenCalledWith({
    ownerRef: "owner-private",
    accountRef: "account-private",
    profileId: "openai-codex-oauth-responses-v1",
    expectedAuthorizationEpoch: 7,
    forceRefresh: true,
  });
  expect(result).toMatchObject({
    status: "ok",
    value: {
      profile: { models: ["new-authorized-model"] },
      account: {
        modelCatalog: {
          status: "snapshot",
          source: "codex",
          models: ["new-authorized-model"],
        },
        connection: { modelSettings: [setting("new-authorized-model")] },
      },
    },
  });
  expect(JSON.stringify(result)).not.toMatch(
    /generation-private|principal-private|owner-private|account-private/,
  );
  await expect(
    f.api.resolveProbe("binding", "new-authorized-model"),
  ).resolves.toMatchObject({ bindingId: "binding" });
  await expect(f.api.resolveProbe("binding", "old-seed")).rejects.toMatchObject(
    { code: "binding_unavailable" },
  );
  f.respond(snapshot([]));
  expect(await f.api.get("binding")).toMatchObject({
    status: "ok",
    value: {
      profile: { models: [] },
      account: {
        modelCatalog: { models: [] },
        connection: { modelSettings: [] },
      },
    },
  });
  f.respond({ status: "unavailable" });
  expect(await f.api.get("binding")).toMatchObject({
    status: "ok",
    value: {
      account: {
        modelCatalog: {
          status: "unavailable",
          source: "legacy_profile",
          models: ["old-seed"],
        },
      },
    },
  });
  await expect(
    f.api.resolveProbe("binding", "old-seed"),
  ).resolves.toMatchObject({ bindingId: "binding" });
  for (const status of ["unknown", "unsupported"] as const) {
    f.respond({ status });
    expect(await f.api.get("binding")).toMatchObject({
      status: "ok",
      value: {
        profile: { models: [] },
        account: { modelCatalog: { status, models: [] } },
      },
    });
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
  }
});

test.each(["revoke", "changeBinding"] as const)(
  "discards discovery when authority changes during the await: %s",
  async (change) => {
    const f = fixture(catalogEnabled);
    f[change]();
    expect(await f.api.get("binding")).toEqual({ status: "denied" });
  },
);

// The consumer's contract parse must not turn invalid capabilities into the
// explicit unavailable/anchor fallback.
test.each(["duplicate", "oversize"] as const)(
  "rejects invalid catalog bounds without seed admission: %s",
  async (mode) => {
    const f = fixture(catalogEnabled);
    f.respond(
      snapshot(
        mode === "duplicate"
          ? ["same", "same"]
          : Array.from({ length: 129 }, (_, index) => `model-${index}`),
      ),
    );
    expect(await f.api.get("binding")).toMatchObject({
      status: "ok",
      value: {
        profile: { models: [] },
        account: { modelCatalog: { status: "unknown", models: [] } },
      },
    });
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
  },
);

test.each([undefined, "0", "true"])(
  "keeps authorized legacy save/probe choices without discovery unless opted in: %s",
  async (flag) => {
    const f = fixture({
      REVIEW_ROUTER_CODEX_ACCOUNT_MODEL_CATALOG_ENABLED: flag,
    });
    f.readAccountModels.mockRejectedValue(
      new GatewayError("transport", "not_dispatched"),
    );
    const result = await f.api.get("binding", { forceRefresh: true });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("account_expected");
    expect(result.value.profile.models).toEqual(["old-seed"]);
    expect(result.value.account).not.toHaveProperty("modelCatalog");
    const provider = {
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: "binding",
      gatewayProfileRef: "openai-codex-oauth-responses-v1",
      model: "old-seed",
      reasoningEffort: "high",
      fastMode: false,
      agenticContext: true,
      requiredHealthy: true,
    } satisfies ReviewProviderConfiguration;
    expect(() =>
      assertGatewayReviewConfigSupported({ providers: [provider] }, [
        result.value.profile,
      ]),
    ).not.toThrow();
    expect(() =>
      assertGatewayReviewConfigSupported(
        { providers: [{ ...provider, model: "new-authorized-model" }] },
        [result.value.profile],
      ),
    ).toThrow("gateway_review_model_unsupported");
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).resolves.toMatchObject({ bindingId: "binding" });
    await expect(
      f.api.resolveProbe("binding", "new-authorized-model"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
    expect(f.readAccountModels).not.toHaveBeenCalled();
  },
);

test.each([401, 404, 503])(
  "does not turn an enabled catalog HTTP %s failure into legacy authorization",
  async (httpStatus) => {
    const f = fixture(catalogEnabled);
    f.readAccountModels.mockRejectedValue(
      new GatewayError(
        "transport",
        "not_dispatched",
        undefined,
        undefined,
        undefined,
        httpStatus,
      ),
    );
    expect(await f.api.get("binding")).toMatchObject({
      status: "ok",
      value: {
        profile: { models: [] },
        account: { modelCatalog: { status: "unknown", models: [] } },
      },
    });
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
    expect(f.readAccountModels).toHaveBeenCalledTimes(2);
  },
);

const openRouterCatalogEnabled = {
  REVIEW_ROUTER_ACCOUNT_MODEL_CATALOG_ENABLED: "1",
};

test("preserves advertised OpenRouter reasoning controls in the selected account and profile projections", async () => {
  const f = fixture(openRouterCatalogEnabled, "openrouter");
  const model = "vendor/reasoning-model";
  const catalog = snapshot([model], "openrouter");
  if (catalog.status !== "snapshot") throw new Error("fixture_snapshot");
  catalog.models[0]!.reasoning = {
    allowed: ["medium", "high"],
    default: "medium",
  };
  f.respond(catalog);

  const result = await f.api.get("binding", { forceRefresh: true });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("account_expected");
  const modelSettings = [
    {
      modelId: model,
      reasoning: { allowed: ["medium", "high"], default: "medium" },
      fast: null,
      tools: { allowed: ["function"], default: "function" },
    },
  ];
  expect(result.value.account.connection?.modelSettings).toEqual(modelSettings);
  expect(result.value.profile.connection?.modelSettings).toEqual(modelSettings);
  expect(result.value.account.modelCatalog).toMatchObject({
    status: "snapshot",
    source: "openrouter",
    models: [model],
  });
  expect(() =>
    assertGatewayReviewConfigSupported(
      {
        providers: [
          {
            kind: "codex",
            authMode: "codex_account_gateway",
            gatewayBindingId: "binding",
            gatewayProfileRef: "openrouter-openai-responses-apikey-v1",
            model,
            reasoningEffort: "high",
            fastMode: false,
            agenticContext: true,
            requiredHealthy: true,
          },
        ],
      },
      [result.value.profile],
    ),
  ).not.toThrow();
});

test("projects a full OpenRouter account catalog and validates saved models without fixed enrollment choices", async () => {
  const f = fixture(openRouterCatalogEnabled, "openrouter");
  const models = Array.from(
    { length: 2048 },
    (_, index) => `new-vendor/model-${index}`,
  );
  f.respond(snapshot(models, "openrouter"));
  const result = await f.api.get("binding", { forceRefresh: true });
  expect(result.status).toBe("ok");
  if (result.status !== "ok") throw new Error("account_expected");
  expect(result.value.profile.models).toEqual(models);
  expect(result.value.account.modelCatalog).toMatchObject({
    source: "openrouter",
    status: "snapshot",
    models,
  });
  expect(result.value.account.connection?.modelSettings?.at(-1)).toEqual({
    modelId: models.at(-1),
    reasoning: null,
    fast: null,
    tools: { allowed: ["function"], default: "function" },
  });
  const provider = {
    kind: "codex",
    authMode: "codex_account_gateway",
    gatewayBindingId: "binding",
    gatewayProfileRef: "openrouter-openai-responses-apikey-v1",
    model: models.at(-1)!,
    fastMode: false,
    agenticContext: true,
    requiredHealthy: true,
  } satisfies ReviewProviderConfiguration;
  expect(() =>
    assertGatewayReviewConfigSupported({ providers: [provider] }, [
      result.value.profile,
    ]),
  ).not.toThrow();
  await expect(
    f.api.resolveProbe("binding", provider.model),
  ).resolves.toMatchObject({ bindingId: "binding" });
  await expect(f.api.resolveProbe("binding", "old-seed")).rejects.toMatchObject(
    { code: "binding_unavailable" },
  );
  expect(f.readAccountModels).toHaveBeenCalledWith(
    expect.objectContaining({
      profileId: "openrouter-openai-responses-apikey-v1",
      forceRefresh: true,
    }),
  );
  expect(JSON.stringify(result)).not.toMatch(
    /generation-private|principal-private|owner-private|account-private/,
  );
});

test.each([
  "wrong-source",
  "expired",
  "future",
  "oversize",
  "removed",
] as const)(
  "does not replace OpenRouter %s discovery with the enrollment model",
  async (mode) => {
    const f = fixture(openRouterCatalogEnabled, "openrouter");
    const catalog = snapshot(
      mode === "oversize"
        ? Array.from({ length: 2049 }, (_, index) => `vendor/model-${index}`)
        : mode === "removed"
          ? []
          : ["new-model"],
      mode === "wrong-source" ? "codex" : "openrouter",
    );
    if (mode === "expired" && catalog.status === "snapshot") {
      catalog.fetchedAt = new Date(Date.now() - 600000).toISOString();
      catalog.expiresAt = new Date(Date.now() - 300000).toISOString();
    }
    if (mode === "future" && catalog.status === "snapshot") {
      catalog.fetchedAt = new Date(Date.now() + 60000).toISOString();
      catalog.expiresAt = new Date(Date.now() + 300000).toISOString();
    }
    f.respond(catalog);
    expect(await f.api.get("binding")).toMatchObject({
      status: "ok",
      value: {
        profile: { models: [] },
        account: {
          modelCatalog: {
            status: mode === "removed" ? "snapshot" : "unknown",
            models: [],
          },
        },
      },
    });
    await expect(
      f.api.resolveProbe("binding", "old-seed"),
    ).rejects.toMatchObject({ code: "binding_unavailable" });
  },
);
