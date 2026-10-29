import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import { createPersonalCanonicalAccounts } from "./personal-canonical-accounts";
import * as composition from "./personal-account-composition";
import { detachRecipientPersonalAccount } from "../../app/dashboard/personal-account-actions";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  db: vi.fn(),
  workspace: vi.fn(),
  detach: vi.fn(),
  reconcile: vi.fn(),
  models: vi.fn(),
  capabilities: vi.fn(),
  subscriptionProfileIds: undefined as string[] | undefined,
  control: {
    profiles: vi.fn(),
    get: vi.fn(),
    operation: vi.fn(),
    fence: vi.fn(),
  },
}));
vi.mock("./dashboard-mutations", () => ({
  getDashboardSignedInActor: h.actor,
}));
vi.mock("./prisma", () => ({ getPrisma: h.db }));
vi.mock("@agent-teams/account-gateway/http", async (load) => {
  const actual =
    await load<typeof import("@agent-teams/account-gateway/http")>();
  return {
    ...actual,
    createManagementClient: vi.fn((settings) => {
      actual.createManagementClient(settings);
      return {
        ...h.control,
        getProviderConnectionCapabilities: h.capabilities,
      };
    }),
    createConsumerControlClient: vi.fn((settings) => {
      actual.createConsumerControlClient(settings); // Real config validation; no method/network entry.
      return h.control;
    }),
  };
});
vi.mock("@reviewrouter/features-provider-accounts", async (load) => ({
  ...(await load<typeof import("@reviewrouter/features-provider-accounts")>()),
  PrismaProviderAccountRepository: vi.fn(function () {
    return {};
  }),
  reconcileWorkspaceBindingFences: h.reconcile,
}));
vi.mock("@reviewrouter/features-provider-accounts/synchronization", () => ({
  PrismaPersonalAccountOperations: vi.fn(function () {
    return { detachRecipientBinding: h.detach };
  }),
  PrismaPersonalCanonicalOperations: vi.fn(function () {
    return {};
  }),
}));
vi.mock("./account-gateway-accounts", () => ({
  accountGatewayProfilesConfiguration: () => ({
    apiKeyProfiles: new Map([["profile", "MiMo"]]),
    apiKeyProfileBaseURLs: new Map(),
    ...(h.subscriptionProfileIds
      ? { subscriptionProfileIds: h.subscriptionProfileIds }
      : {}),
  }),
  accountGatewayUserOwnerRef: (id: string) => `user-${id}`,
  accountGatewayWorkspaceOwnerRef: (id: string) => `workspace-${id}`,
  createDisabledPersonalAccountsAdapter: vi.fn(),
}));
vi.mock("./personal-account-sharing-queries", () => ({
  PrismaPersonalAccountSharingQueries: vi.fn(function () {}),
}));
vi.mock("./personal-account-sharing", () => ({
  createPersonalAccountSharingApi: vi.fn(() => ({})),
}));
vi.mock("./personal-canonical-accounts", () => ({
  createPersonalCanonicalAccounts: vi.fn(() => ({})),
}));
vi.mock("./gateway-model-account-options", () => ({
  createGatewayModelAccountOptions: h.models,
}));

const forbidden = { code: "workspace_forbidden" };
const scopeRow = (
  personalOwnerUserId: string | null = null,
  member = true,
) => ({
  personalOwnerUserId,
  deletionState: "active",
  members: member ? [{ role: "member" }] : [],
});
beforeEach(() => {
  vi.clearAllMocks();
  h.subscriptionProfileIds = undefined;
  h.capabilities.mockReset();
  h.actor.mockReset().mockResolvedValue({ userId: "actual-u" });
  h.workspace.mockReset().mockResolvedValue(scopeRow());
  h.db.mockReturnValue({ workspace: { findUnique: h.workspace } });
  h.detach.mockReset();
  h.reconcile.mockReset();
  h.control.profiles.mockResolvedValue({
    profiles: [
      {
        profileId: "profile",
        protocol: "openai-responses",
        authKinds: ["api_key"],
        modelIds: ["qualified-model"],
      },
    ],
  });
  vi.stubEnv("REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED", "1");
  for (const [name, value] of Object.entries({
    PERSONAL_CONTROL_ORIGIN: "https://personal.example.test",
    PERSONAL_CONTROL_TOKEN: "dedicated-consumer-token",
    MANAGEMENT_ORIGIN: "https://management.example.test",
    MANAGEMENT_TOKEN: "wrong-management-token",
    CONTROL_ORIGIN: "https://api-control.example.test",
    RUN_CONTROL_BEARER: "wrong-api-token",
  }))
    vi.stubEnv(`REVIEW_ROUTER_ACCOUNT_GATEWAY_${name}`, value);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("disabled production gate returns before session, SDK or database entry", async () => {
  vi.stubEnv("REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED", "0");
  expect(await composition.productionPersonalAccounts()).toBeNull();
  expect(h.actor).not.toHaveBeenCalled();
  expect(createConsumerControlClient).not.toHaveBeenCalled();
  expect(h.db).not.toHaveBeenCalled();
});
it.each(["ORIGIN", "TOKEN"] as const)(
  "requires dedicated consumer-control %s without management/API fallback",
  async (missing) => {
    const name = `REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_${missing}`;
    vi.stubEnv(name, "");
    await expect(composition.productionPersonalAccounts()).rejects.toThrow();
    expect(h.db).not.toHaveBeenCalled();
    vi.stubEnv(
      name,
      missing === "ORIGIN"
        ? "https://personal.example.test"
        : "dedicated-consumer-token",
    );
    await composition.productionPersonalAccounts();
    expect(createConsumerControlClient).toHaveBeenLastCalledWith({
      role: "consumer-control",
      origin: "https://personal.example.test",
      token: "dedicated-consumer-token",
      timeoutMs: 10000,
      responseBytes: 2 * 1024 * 1024,
    });
    expect(h.control.profiles).not.toHaveBeenCalled();
  },
);
it("checks actual membership or exact P owner before profile discovery, allowing ordinary members", async () => {
  const service = (await composition.productionPersonalAccounts())!;
  h.workspace.mockResolvedValueOnce(scopeRow(null, false));
  await expect(service.models("org")).rejects.toMatchObject(forbidden);
  h.workspace.mockResolvedValueOnce(scopeRow("foreign-u"));
  await expect(service.models("foreign-p")).rejects.toMatchObject(forbidden);
  expect(h.control.profiles).not.toHaveBeenCalled();
  await service.models("org");
  h.workspace.mockResolvedValueOnce(scopeRow("actual-u", false));
  await service.models("own-p");
  expect(h.control.profiles).toHaveBeenCalledTimes(2);
  expect(h.models).toHaveBeenCalledTimes(2);
  expect(h.workspace.mock.lastCall?.[0].select.members.where).toEqual({
    userId: "actual-u",
  });
});
it("a switch during the workspace read blocks discovery and subsequent mutation", async () => {
  const service = (await composition.productionPersonalAccounts())!;
  h.workspace.mockImplementationOnce(async () => {
    h.actor.mockResolvedValue({ userId: "different-u" });
    return scopeRow();
  });
  await expect(service.models("org")).rejects.toMatchObject(forbidden);
  await expect(
    service.detachRecipient("org", {
      bindingId: "bx",
      expectedBindingRevision: 1,
    }),
  ).rejects.toMatchObject({ code: "workspace_forbidden" });
  expect(h.detach).not.toHaveBeenCalled();
  expect(h.control.profiles).not.toHaveBeenCalled();
  expect(h.control.fence).not.toHaveBeenCalled();
});
it("loads qualified profiles without projecting accounts and rechecks membership after discovery", async () => {
  const service = (await composition.productionPersonalAccounts())!;
  expect(await service.reviewProfiles("org")).toMatchObject([
    {
      id: "profile",
      provider: "codex-mimo",
      protocol: "openai-responses",
      models: ["qualified-model"],
    },
  ]);
  expect(h.models).not.toHaveBeenCalled();
  expect(h.control.get).not.toHaveBeenCalled();
  h.control.profiles.mockImplementationOnce(async () => {
    h.workspace.mockResolvedValue(scopeRow(null, false));
    return { profiles: [] };
  });
  await expect(service.reviewProfiles("org")).rejects.toMatchObject(forbidden);
  expect(h.models).not.toHaveBeenCalled();
  expect(h.control.get).not.toHaveBeenCalled();
});
it("retains a real committed local detach on fence outage only while the same actor remains", async () => {
  const service = (await composition.productionPersonalAccounts())!;
  const known = {
    bindingId: "bx",
    workspaceId: "org",
    revision: 2,
    state: "revoked",
    localAuthorization: "local_denied",
    remoteFenceDelivery: "remote_pending",
  };
  h.detach.mockResolvedValue(known);
  h.reconcile.mockRejectedValue(new Error("fence transport unavailable"));
  const request = { bindingId: "bx", expectedBindingRevision: 1 };
  expect(await service.detachRecipient("org", request)).toBe(known);
  expect(h.detach).toHaveBeenCalledTimes(1);
  expect(h.detach).toHaveBeenCalledWith({
    actorUserId: "actual-u",
    workspaceId: "org",
    ...request,
  });
  expect(h.reconcile).toHaveBeenCalledWith(
    { limit: 1, bindingIds: ["bx"] },
    expect.any(Object),
  );
  h.reconcile.mockImplementationOnce(async () => {
    h.actor.mockResolvedValue({ userId: "different-u" });
    throw new Error("outage");
  });
  await expect(service.detachRecipient("org", request)).rejects.toMatchObject(
    forbidden,
  );
});
it.each(["revision_conflict", "workspace_forbidden"] as const)(
  "action rejects stale context and maps typed %s without exposing diagnostics",
  async (code) => {
    const detach = vi.fn().mockRejectedValue(new ProviderAccountError(code));
    const service = {
      scope: "current-scope",
      detachRecipient: detach,
    } as unknown as NonNullable<
      Awaited<ReturnType<typeof composition.productionPersonalAccounts>>
    >;
    vi.spyOn(composition, "productionPersonalAccounts").mockResolvedValue(
      service,
    );
    const request = { bindingId: "bx", expectedBindingRevision: 1 };
    expect(
      await detachRecipientPersonalAccount("stale-scope", "org", request),
    ).toEqual({ status: "denied" });
    expect(detach).not.toHaveBeenCalled();
    expect(
      await detachRecipientPersonalAccount("current-scope", "org", request),
    ).toEqual({ status: code === "revision_conflict" ? "conflict" : "denied" });
  },
);

const glmCapability = {
  contract: "provider-connections/v1",
  profileId: "glm-coding-global-responses-apikey-v1",
  provider: { identity: "glm", label: "GLM" },
  plan: { identity: "coding_plan", label: "Coding Plan" },
  region: { identity: "global", label: "Global" },
  protocol: "openai-responses",
  modelIds: ["glm-5.3-flash"],
  authMethods: ["api_key"],
  completionInputKind: "none",
  availability: "enabled",
  oauthCallbackMode: null,
  reconnect: "replace_api_key",
  limitsContract: "account-limits/v2",
  models: [
    {
      modelId: "glm-5.3-flash",
      reasoning: null,
      fast: null,
      tools: { allowed: ["function"], default: "function" },
    },
  ],
};
it("projects enabled subscription capabilities into the existing personal composition without provider effects", async () => {
  h.subscriptionProfileIds = [glmCapability.profileId];
  h.capabilities.mockResolvedValue({
    contract: "provider-connections/v1",
    capabilities: [glmCapability],
  });
  await composition.productionPersonalAccounts();
  const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
  expect(input.profiles).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: glmCapability.profileId,
        provider: "codex",
        availability: "enabled",
        connection: expect.objectContaining({
          provider: "glm",
          personalOnly: true,
        }),
      }),
    ]),
  );
  expect(h.capabilities).toHaveBeenCalledTimes(1);
  expect(h.control.profiles).not.toHaveBeenCalled();
  expect(h.control.operation).not.toHaveBeenCalled();
});
it("applies qualified model settings to existing API-key profiles as well as subscriptions", async () => {
  h.subscriptionProfileIds = [];
  const capability = {
    ...glmCapability,
    profileId: "profile",
    provider: { identity: "mimo", label: "MiMo" },
    modelIds: ["qualified-model"],
    models: [{ ...glmCapability.models[0]!, modelId: "qualified-model" }],
  };
  h.capabilities.mockResolvedValue({
    contract: "provider-connections/v1",
    capabilities: [capability],
  });
  const service = (await composition.productionPersonalAccounts())!;
  expect(await service.reviewProfiles("org")).toMatchObject([
    {
      id: "profile",
      models: ["qualified-model"],
      connection: {
        provider: "mimo",
        modelSettings: [{ modelId: "qualified-model", reasoning: null }],
      },
    },
  ]);
  expect(h.capabilities).toHaveBeenCalledOnce();
  expect(h.control.get).not.toHaveBeenCalled();
  expect(h.control.operation).not.toHaveBeenCalled();
});
it("revalidates the current actor after the awaited capability read", async () => {
  h.subscriptionProfileIds = [glmCapability.profileId];
  h.capabilities.mockImplementation(async () => {
    h.actor.mockResolvedValue({ userId: "foreign-u" });
    return {
      contract: "provider-connections/v1",
      capabilities: [glmCapability],
    };
  });
  await expect(composition.productionPersonalAccounts()).rejects.toMatchObject(
    forbidden,
  );
  expect(createPersonalCanonicalAccounts).not.toHaveBeenCalled();
});

it("preserves legacy consumer-only composition when subscription activation and management credentials are absent", async () => {
  h.subscriptionProfileIds = [];
  vi.stubEnv("REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN", "");
  expect(await composition.productionPersonalAccounts()).not.toBeNull();
  expect(h.capabilities).not.toHaveBeenCalled();
  expect(h.control.profiles).not.toHaveBeenCalled();
});
