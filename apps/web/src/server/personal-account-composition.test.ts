import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import * as composition from "./personal-account-composition";
import { detachRecipientPersonalAccount } from "../../app/dashboard/personal-account-actions";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  db: vi.fn(),
  workspace: vi.fn(),
  detach: vi.fn(),
  reconcile: vi.fn(),
  models: vi.fn(),
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
      responseBytes: 65536,
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
