import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { accountModelCatalogResponseBytes } from "@reviewrouter/features-provider-accounts/composition";
import {
  createConsumerControlClient,
  GatewayError,
} from "@agent-teams/account-gateway/http";
import type {
  ProviderConnectionCapabilitiesV2,
  ProviderConnectionCapabilityV2,
} from "@agent-teams/account-gateway/contracts";
import {
  canCreateConnection,
  connectionMethodAllowed,
} from "../features/account-gateway/connection-capabilities";
import { createPersonalCanonicalAccounts } from "./personal-canonical-accounts";
import * as composition from "./personal-account-composition";
import * as metadataService from "./account-metadata-service";
import * as lifecycleReader from "./account-lifecycle-reader";
import * as overviewService from "./accounts-overview";
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
  nvidiaProfile: false,
  codexProfile: false,
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
        getProviderConnectionCapabilitiesV2: h.capabilities,
        getProviderConnectionCapabilities: () => {
          throw new Error("v2 discovery must not probe v1");
        },
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
    apiKeyProfiles: new Map<string, "MiMo" | "NVIDIA Build">([
      ["profile", "MiMo"],
      ...(h.nvidiaProfile
        ? ([["nvidia-build-chat-apikey-v1", "NVIDIA Build"]] as const)
        : []),
    ]),
    apiKeyProfileBaseURLs: new Map(),
    ...(h.codexProfile
      ? { codexOAuthProfileId: "openai-codex-oauth-responses-v1" }
      : {}),
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
  h.nvidiaProfile = false;
  h.codexProfile = false;
  h.capabilities
    .mockReset()
    .mockResolvedValue(nativeCapabilities(mimoCapability));
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
      responseBytes: accountModelCatalogResponseBytes,
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
it("borrows the metadata transaction for actor and workspace authorization", async () => {
  const metadata = vi.spyOn(metadataService, "createAccountMetadataService");
  const service = (await composition.productionPersonalAccounts())!;
  await service.models("org");
  const input = metadata.mock.lastCall![0];
  const workspace = vi.fn().mockResolvedValue(scopeRow());
  const transaction = {
    workspace: { findUnique: workspace },
    userExternalIdentity: {},
    workspaceMember: {},
  } as unknown as Parameters<typeof input.authorize>[0];
  h.actor.mockClear();
  h.workspace.mockClear();
  expect(await input.authorize(transaction)).toEqual({
    userId: "actual-u",
    workspaceId: "org",
  });
  expect(workspace).toHaveBeenCalledOnce();
  expect(h.workspace).not.toHaveBeenCalled();
  expect(h.actor).toHaveBeenCalledTimes(3);
  for (const call of h.actor.mock.calls)
    expect(call).toEqual([{ prisma: transaction }]);
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

const glmCapability: ProviderConnectionCapabilityV2 = {
  profileId: "glm-coding-global-responses-apikey-v1",
  provider: { id: "glm", label: "GLM" },
  product: { id: "coding_plan", label: "Coding Plan" },
  region: { id: "global", label: "Global" },
  protocol: "openai-responses",
  methods: [{ kind: "api_key", create: true, reconnect: true }],
  accountInfo: true,
  availability: "enabled",
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
const mimoCapability: ProviderConnectionCapabilityV2 = {
  ...glmCapability,
  profileId: "profile",
  provider: { id: "mimo", label: "MiMo" },
  models: [{ ...glmCapability.models[0]!, modelId: "qualified-model" }],
};
const nativeCapabilities = (
  ...capabilities: ProviderConnectionCapabilityV2[]
): ProviderConnectionCapabilitiesV2 => ({
  contract: "provider-connections/v2",
  capabilities,
});
it("keeps construction passive and qualifies subscription facts only for fresh catalogue reads", async () => {
  h.subscriptionProfileIds = [glmCapability.profileId];
  h.capabilities.mockResolvedValue(nativeCapabilities(glmCapability));
  await composition.productionPersonalAccounts();
  const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
  expect(
    input.profiles.find((row) => row.id === glmCapability.profileId),
  ).toEqual({
    id: glmCapability.profileId,
    label: glmCapability.profileId,
    authKind: "api_key",
    availability: "deployment_configuration_required",
  });
  expect(h.capabilities).not.toHaveBeenCalled();
  expect(h.control.profiles).not.toHaveBeenCalled();
  expect(await input.catalogue!()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: glmCapability.profileId,
        provider: "codex",
        availability: "enabled",
        connection: expect.objectContaining({
          provider: "glm",
        }),
      }),
    ]),
  );
  expect(h.capabilities).toHaveBeenCalledTimes(1);
  expect(h.control.profiles).toHaveBeenCalledTimes(1);
  expect(h.control.operation).not.toHaveBeenCalled();
});
it("applies qualified model settings to existing API-key profiles as well as subscriptions", async () => {
  h.subscriptionProfileIds = [];
  h.capabilities.mockResolvedValue(nativeCapabilities(mimoCapability));
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
it.each([false, true])(
  "advertises trusted NVIDIA enrollment with legacy profile configured=%s",
  async (configured) => {
    h.subscriptionProfileIds = undefined;
    h.nvidiaProfile = configured;
    const nvidiaCapability: ProviderConnectionCapabilityV2 = {
      ...glmCapability,
      profileId: "nvidia-build-chat-apikey-v1",
      provider: { id: "nvidia", label: "NVIDIA Build" },
      product: { id: "unknown", label: "NVIDIA trial" },
      models: [
        {
          ...glmCapability.models[0]!,
          modelId: "nvidia/nemotron-3.5-super-vl-120b-a12b",
        },
      ],
    };
    if (configured)
      h.control.profiles.mockResolvedValue({
        profiles: [
          {
            profileId: nvidiaCapability.profileId,
            protocol: nvidiaCapability.protocol,
            authKinds: ["api_key"],
            modelIds: nvidiaCapability.models.map((model) => model.modelId),
          },
        ],
      });
    h.capabilities.mockResolvedValue(nativeCapabilities(nvidiaCapability));
    await composition.productionPersonalAccounts();
    let input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
    const qualified = await input.catalogue!();
    expect(qualified).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: nvidiaCapability.profileId,
          connection: expect.objectContaining({ provider: "nvidia" }),
          availability: "enabled",
        }),
      ]),
    );
    const profile = qualified.find(
      (row) => row.id === nvidiaCapability.profileId,
    )!;
    expect(canCreateConnection(profile)).toBe(true);
    expect(connectionMethodAllowed(profile, "reconnect", "api_key")).toBe(true);
    const rejectedCapabilities: ProviderConnectionCapabilityV2[] = [
      {
        ...nvidiaCapability,
        availability: "deployment_configuration_required",
      },
      {
        ...nvidiaCapability,
        provider: { id: "openrouter", label: "OpenRouter" },
      },
      { ...nvidiaCapability, profileId: "foreign-nvidia-profile" },
      {
        ...nvidiaCapability,
        methods: [{ kind: "device_code", create: true, reconnect: true }],
      },
    ];
    for (const rejected of rejectedCapabilities) {
      vi.mocked(createPersonalCanonicalAccounts).mockClear();
      h.capabilities.mockResolvedValue(nativeCapabilities(rejected));
      await composition.productionPersonalAccounts();
      input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
      const profile = (await input.catalogue!()).find(
        (row) => row.id === nvidiaCapability.profileId,
      );
      expect(profile?.connection).toBeUndefined();
      if (configured) {
        expect(profile?.availability).toBe("deployment_configuration_required");
        expect(canCreateConnection(profile!)).toBe(false);
      } else expect(profile).toBeUndefined();
    }
  },
);

it.each([404, 403] as const)(
  "capability HTTP %i leaves recovery construction available but denies fresh discovery",
  async (httpStatus) => {
    h.subscriptionProfileIds = [];
    h.nvidiaProfile = true;
    h.capabilities.mockRejectedValue(
      Object.assign(new GatewayError("safe_error", "not_dispatched"), {
        httpStatus,
      }),
    );
    await expect(
      composition.productionPersonalAccounts(),
    ).resolves.not.toBeNull();
    expect(h.capabilities).not.toHaveBeenCalled();
    expect(h.control.profiles).not.toHaveBeenCalled();
    const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
    await expect(input.catalogue!()).rejects.toMatchObject({ httpStatus });
    expect(h.capabilities).toHaveBeenCalledOnce();
  },
);

it("retains known product identities for recovery when control discovery is unavailable", async () => {
  h.control.profiles.mockRejectedValueOnce(new Error("catalogue unavailable"));
  await expect(
    composition.productionPersonalAccounts(),
  ).resolves.not.toBeNull();
  const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
  expect(h.control.profiles).not.toHaveBeenCalled();
  expect(h.capabilities).not.toHaveBeenCalled();
  for (const id of [
    "anthropic-messages-apikey-v1",
    "gemini-openai-chat-apikey-v1",
  ])
    expect(input.profiles.find((profile) => profile.id === id)).toEqual({
      id,
      label: id,
      authKind: "api_key",
      availability: "deployment_configuration_required",
    });
  await expect(input.catalogue!()).rejects.toThrow("catalogue unavailable");
  expect(h.control.operation).not.toHaveBeenCalled();
});

it.each([false, true])(
  "declares personal Codex reconnect support subject to the native method (%s)",
  async (reconnect) => {
    h.codexProfile = true;
    const profileId = "openai-codex-oauth-responses-v1";
    h.control.profiles.mockResolvedValue({
      profiles: [
        {
          profileId,
          protocol: "openai-responses",
          authKinds: ["oauth"],
          modelIds: ["qualified-model"],
        },
      ],
    });
    h.capabilities.mockResolvedValue(
      nativeCapabilities({
        ...mimoCapability,
        profileId,
        provider: { id: "openai", label: "Codex" },
        methods: [
          {
            kind: "browser",
            completionInputKind: "callback_url",
            callbackMode: "automatic",
            create: true,
            reconnect,
          },
          { kind: "device_code", create: true, reconnect: true },
          {
            kind: "credential_import",
            method: "refresh_token",
            maxBytes: 65536,
            create: true,
            reconnect,
          },
          {
            kind: "credential_import",
            method: "oauth_auth_json",
            maxBytes: 65536,
            create: true,
            reconnect,
          },
        ],
      }),
    );
    await composition.productionPersonalAccounts();
    const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
    expect(
      input.profiles.find((profile) => profile.id === profileId)?.canReconnect,
    ).toBe(true);
    const profile = (await input.catalogue!()).find(
      (profile) => profile.id === profileId,
    )!;
    expect(profile.canReconnect).toBe(reconnect);
    expect(connectionMethodAllowed(profile, "create", "browser")).toBe(true);
    expect(connectionMethodAllowed(profile, "reconnect", "browser")).toBe(
      reconnect,
    );
    expect(connectionMethodAllowed(profile, "create", "device_code")).toBe(
      true,
    );
    expect(connectionMethodAllowed(profile, "reconnect", "device_code")).toBe(
      false,
    );
    for (const method of ["refresh_token", "oauth_auth_json"] as const) {
      expect(
        connectionMethodAllowed(profile, "create", "credential_import", method),
      ).toBe(true);
      expect(
        connectionMethodAllowed(
          profile,
          "reconnect",
          "credential_import",
          method,
        ),
      ).toBe(reconnect);
    }
  },
);

it("does not advertise new personal Codex reconnect without native method qualification", async () => {
  h.codexProfile = true;
  vi.stubEnv("REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN", "");
  const profileId = "openai-codex-oauth-responses-v1";
  h.control.profiles.mockResolvedValue({
    profiles: [
      {
        profileId,
        protocol: "openai-responses",
        authKinds: ["oauth"],
        modelIds: ["qualified-model"],
      },
    ],
  });
  await composition.productionPersonalAccounts();
  const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
  const profile = (await input.catalogue!()).find(
    (profile) => profile.id === profileId,
  )!;
  expect(h.capabilities).not.toHaveBeenCalled();
  expect(profile.canReconnect).toBe(false);
  expect(connectionMethodAllowed(profile, "create", "device_code")).toBe(true);
  expect(connectionMethodAllowed(profile, "reconnect", "device_code")).toBe(
    false,
  );
  expect(connectionMethodAllowed(profile, "reconnect", "browser")).toBe(false);
});

it("retains existing native API accounts in the real overview when discovery omits their profiles", async () => {
  const ids = ["anthropic-messages-apikey-v1", "gemini-openai-chat-apikey-v1"];
  const rows = [...ids, "unknown-native-profile"].map((profileRef, index) => ({
    id: `source-${index}`,
    ownerUserId: null,
    ownerWorkspaceId: "org",
    gatewayAccountRef: `account-${index}`,
    profileRef,
    displayName: `Existing native account ${index}`,
    state: "active",
    metadataRevision: 1,
    authorizationEpochMirror: null,
    pendingSourceOperationId: null,
    bindingId: `binding-${index}`,
    bindingRevision: 1,
    bindingState: "active",
    fencePending: false,
    role: "admin",
    workspaceName: "Organization",
  }));
  h.db.mockReturnValue({
    workspace: { findUnique: h.workspace },
    $queryRaw: async () => rows,
  });
  vi.spyOn(lifecycleReader, "createAccountLifecycleReader").mockReturnValue({
    compatible: async () => false,
    writable: async () => false,
    get: async () => {
      throw new Error("native account read unavailable");
    },
  });
  vi.spyOn(metadataService, "createAccountMetadataService").mockReturnValue({
    page: async (accounts) =>
      accounts.map((account) => ({
        ...account,
        metadata: { status: "restricted" as const, displayToken: "restricted" },
      })),
  });
  const capture = vi.spyOn(overviewService, "createAccountsOverview");
  const service = (await composition.productionPersonalAccounts())!;
  const qualified = await service.reviewProfiles("org");
  expect(qualified.some((profile) => ids.includes(profile.id))).toBe(false);
  const page = await (await service.overview("org")).list();
  if (page.status !== "ok") throw new Error(`overview ${page.status}`);
  expect(page.value.accounts.map((account) => account.profileId)).toEqual(ids);
  expect(page.value.accounts.map((account) => account.label)).toEqual([
    "Existing native account 0",
    "Existing native account 1",
  ]);
  expect(
    page.value.accounts.every((account) => account.readiness === "unknown"),
  ).toBe(true);
  for (const id of ids) {
    const identity = capture.mock.lastCall![0].profiles.find(
      (profile) => profile.id === id,
    )!;
    expect(identity).toMatchObject({
      availability: "deployment_configuration_required",
      canReconnect: false,
    });
    expect(connectionMethodAllowed(identity, "create", "api_key")).toBe(false);
    expect(connectionMethodAllowed(identity, "reconnect", "api_key")).toBe(
      false,
    );
  }
});

it("keeps management discovery configuration out of original-operation recovery construction", async () => {
  h.subscriptionProfileIds = [glmCapability.profileId];
  vi.stubEnv(
    "REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN",
    "invalid-origin",
  );
  await expect(
    composition.productionPersonalAccounts(),
  ).resolves.not.toBeNull();
  const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
  expect(h.capabilities).not.toHaveBeenCalled();
  await expect(input.catalogue!()).rejects.toThrow();
  expect(h.control.operation).not.toHaveBeenCalled();
});

it("revalidates the current actor after the awaited capability read", async () => {
  h.subscriptionProfileIds = [glmCapability.profileId];
  h.capabilities.mockImplementation(async () => {
    h.actor.mockResolvedValue({ userId: "foreign-u" });
    return nativeCapabilities(glmCapability);
  });
  await composition.productionPersonalAccounts();
  const input = vi.mocked(createPersonalCanonicalAccounts).mock.calls[0]![0];
  await expect(input.catalogue!()).rejects.toMatchObject(forbidden);
});

it("preserves legacy consumer-only composition when subscription activation and management credentials are absent", async () => {
  h.subscriptionProfileIds = [];
  vi.stubEnv("REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN", "");
  expect(await composition.productionPersonalAccounts()).not.toBeNull();
  expect(h.capabilities).not.toHaveBeenCalled();
  expect(h.control.profiles).not.toHaveBeenCalled();
});
