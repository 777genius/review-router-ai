import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import type {
  AccountProfileView,
  AccountView,
  AccountsPage,
  AccountsResult,
} from "./account-gateway-accounts";
import {
  loadDashboardGatewayAccounts,
  hydrateDashboardGatewayAccounts,
} from "./dashboard-gateway-accounts";
import { isGatewayProviderSetupReady } from "./dashboard-provider-setup-readiness";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  models: vi.fn(),
}));
vi.mock("./gateway-model-account-composition", () => ({
  productionGatewayModelAccounts: async () => ({
    reader: { list: mocks.list, get: mocks.get },
  }),
}));
vi.mock("./personal-account-composition", () => ({
  productionPersonalAccounts: async () => null,
}));

const profile: AccountProfileView = {
  id: "openrouter-openai-responses-apikey-v1",
  label: "OpenRouter",
  protocol: "openai-responses",
  authKind: "api_key",
  models: ["openai/gpt-5.4-nano"],
};
function account(id = "binding_1"): AccountView {
  return {
    connectionId: `connection_${id}`,
    label: id,
    profileId: profile.id,
    profileLabel: profile.label,
    state: "active",
    gatewayRevision: 2,
    mirrorRevision: 2,
    binding: { id, revision: 1, state: "active", fencePending: false },
  };
}
function config(
  binding = "binding_1",
  model = "openai/gpt-4.1",
  profileId = profile.id,
) {
  return parseReviewConfiguration({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        gatewayBindingId: binding,
        gatewayProfileRef: profileId,
        model,
        reasoningEffort: "medium",
        agenticContext: true,
        fastMode: false,
      },
    ],
  });
}
function snapshot(id = "binding_1", models = ["openai/gpt-4.1"]): AccountView {
  return {
    ...account(id),
    modelCatalog: {
      status: "snapshot",
      source: "openrouter",
      models,
      fetchedAt: new Date(Date.now() - 1_000).toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    },
  };
}
function listed(accounts = [account()]): AccountsResult<AccountsPage> {
  return {
    status: "ok",
    value: { accounts, profiles: [profile], nextCursor: null },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(listed());
  mocks.get.mockImplementation(async (id: string) => ({
    status: "ok",
    value: { account: snapshot(id), profile },
  }));
});

describe("dashboard selected Gateway model readiness", () => {
  it("loads one account-scoped catalog for 419 effective repository selections", async () => {
    const selected = config();
    const result = await loadDashboardGatewayAccounts(
      "workspace_1",
      null,
      Array.from({ length: 419 }, () => selected),
    );
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ limit: 25 });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("binding_1");
    expect(isGatewayProviderSetupReady(selected, result)).toBe(true);
    expect(result.status === "ok" && result.value.profiles[0]?.models).toEqual([
      "openai/gpt-5.4-nano",
    ]);
  });

  it("loads a saved binding beyond the visible account page once for 419 repositories", async () => {
    const accounts = Array.from({ length: 25 }, (_, index) =>
      account(`binding_${index + 1}`),
    );
    const page = listed(accounts);
    if (page.status !== "ok") throw new Error("expected account page");
    page.value.nextCursor = "binding_25";
    mocks.list.mockResolvedValue(page);
    const selected = config("binding_26");
    const result = await loadDashboardGatewayAccounts(
      "workspace_1",
      null,
      Array.from({ length: 419 }, () => selected),
    );
    expect(mocks.list).toHaveBeenCalledExactlyOnceWith({ limit: 25 });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("binding_26");
    expect(isGatewayProviderSetupReady(selected, result)).toBe(true);
    expect(result.status === "ok" && result.value.accounts).toHaveLength(26);
    expect(result.status === "ok" && result.value.nextCursor).toBe(
      "binding_25",
    );
    expect(result.status === "ok" && result.value.profiles).toEqual([profile]);
  });

  it("bounds concurrent detail reads without dropping selected bindings", async () => {
    mocks.list.mockResolvedValue(listed([]));
    let active = 0;
    let maximum = 0;
    mocks.get.mockImplementation(async (id: string) => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      return { status: "ok", value: { account: snapshot(id), profile } };
    });
    const configurations = Array.from({ length: 26 }, (_, index) =>
      config(`binding_${index + 1}`),
    );
    const result = await loadDashboardGatewayAccounts(
      "workspace_1",
      null,
      configurations,
    );
    expect(mocks.get).toHaveBeenCalledTimes(26);
    expect(maximum).toBeLessThanOrEqual(5);
    expect(
      configurations.every((selected) =>
        isGatewayProviderSetupReady(selected, result),
      ),
    ).toBe(true);
  });

  it("keeps static-profile readiness for a selected binding beyond the page", async () => {
    const staticProfile = {
      ...profile,
      id: "mimo-openai-responses-apikey-v1",
      label: "MiMo",
    };
    const selected = config("binding_26", profile.models[0], staticProfile.id);
    mocks.list.mockResolvedValue({
      status: "ok",
      value: {
        accounts: [],
        profiles: [staticProfile],
        nextCursor: "binding_25",
      },
    });
    mocks.get.mockResolvedValue({
      status: "ok",
      value: {
        account: { ...account("binding_26"), profileId: staticProfile.id },
        profile: staticProfile,
      },
    });
    const result = await loadDashboardGatewayAccounts("workspace_1", null, [
      selected,
    ]);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("binding_26");
    expect(isGatewayProviderSetupReady(selected, result)).toBe(true);
  });

  it.each(["denied", "unavailable", "throw"] as const)(
    "fails closed for a %s selected binding beyond the page",
    async (status) => {
      mocks.get.mockImplementation(async (id: string) => {
        if (id === "binding_1")
          return { status: "ok", value: { account: snapshot(id), profile } };
        if (status === "throw") throw new Error("PRIVATE_ERROR");
        return { status };
      });
      const selected = config("binding_26", profile.models[0]);
      const result = await loadDashboardGatewayAccounts("workspace_1", null, [
        config(),
        selected,
      ]);
      expect(mocks.get).toHaveBeenCalledTimes(2);
      expect(mocks.get).toHaveBeenCalledWith("binding_26");
      expect(isGatewayProviderSetupReady(config(), result)).toBe(true);
      expect(isGatewayProviderSetupReady(selected, result)).toBe(false);
      expect(result.status === "ok" && result.value.accounts).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain("PRIVATE_ERROR");
    },
  );

  it.each(["binding", "profile"] as const)(
    "drops foreign %s metadata for a selected binding beyond the page",
    async (mismatch) => {
      mocks.get.mockResolvedValue({
        status: "ok",
        value: {
          account: {
            ...snapshot(
              mismatch === "binding" ? "foreign_binding" : "binding_26",
            ),
            label: "FOREIGN_PRIVATE",
          },
          profile:
            mismatch === "profile"
              ? { ...profile, id: "foreign_profile" }
              : profile,
        },
      });
      const selected = config("binding_26");
      const result = await loadDashboardGatewayAccounts("workspace_1", null, [
        selected,
      ]);
      expect(isGatewayProviderSetupReady(selected, result)).toBe(false);
      expect(result.status === "ok" && result.value.accounts).toEqual([
        account(),
      ]);
      expect(JSON.stringify(result)).not.toContain("FOREIGN_PRIVATE");
      expect(JSON.stringify(result)).not.toContain("foreign_profile");
    },
  );

  it("does not read models for unselected accounts or metadata-only screens", async () => {
    mocks.list.mockResolvedValue(listed([account(), account("binding_2")]));
    await loadDashboardGatewayAccounts("workspace_1", null);
    expect(mocks.get).not.toHaveBeenCalled();
    await loadDashboardGatewayAccounts("workspace_1", null, [config()]);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("binding_1");
  });

  it("never unions catalogs for visible and off-page bindings of the same profile", async () => {
    mocks.list.mockResolvedValue(listed([account()]));
    mocks.get.mockImplementation(async (id: string) => ({
      status: "ok",
      value: {
        account: snapshot(id, [
          id === "binding_1" ? "openai/gpt-4.1" : "vendor/other",
        ]),
        profile,
      },
    }));
    const result = await loadDashboardGatewayAccounts("workspace_1", null, [
      config(),
      config("binding_2"),
    ]);
    expect(isGatewayProviderSetupReady(config(), result)).toBe(true);
    expect(isGatewayProviderSetupReady(config("binding_2"), result)).toBe(
      false,
    );
  });

  it.each(["denied", "unavailable"] as const)(
    "does not infer anchor access from a %s catalog read",
    async (status) => {
      mocks.get.mockResolvedValue({ status });
      const selected = config("binding_1", "openai/gpt-5.4-nano");
      const result = await loadDashboardGatewayAccounts("workspace_1", null, [
        selected,
      ]);
      expect(isGatewayProviderSetupReady(selected, result)).toBe(false);
    },
  );

  it("drops a foreign binding result without exposing its metadata", async () => {
    mocks.get.mockResolvedValue({
      status: "ok",
      value: {
        account: { ...snapshot("foreign_binding"), label: "FOREIGN_PRIVATE" },
        profile,
      },
    });
    const result = await loadDashboardGatewayAccounts("workspace_1", null, [
      config(),
    ]);
    expect(isGatewayProviderSetupReady(config(), result)).toBe(false);
    expect(JSON.stringify(result)).not.toContain("FOREIGN_PRIVATE");
  });
});

describe("selected Gateway account hydration", () => {
  const account = (id: string) => ({
    connectionId: `connection-${id}`,
    label: id,
    profileId: "shared-profile",
    profileLabel: "Shared profile",
    state: "active" as const,
    gatewayRevision: 1,
    mirrorRevision: 1,
    binding: { id, revision: 1, state: "active" as const, fencePending: false },
  });
  const profile = {
    id: "shared-profile",
    label: "Shared profile",
    protocol: "openai-responses" as const,
    models: ["seed-model"],
  };
  const initial: AccountsResult<AccountsPage> = {
    status: "ok",
    value: {
      accounts: [account("first-page")],
      profiles: [profile],
      nextCursor: "next",
    },
  };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads selected bindings outside the first page and preserves their independent catalogs", async () => {
    mocks.get.mockImplementation(async (id: string) => ({
      status: "ok",
      value: {
        account: {
          ...account(id),
          modelCatalog: {
            status: "snapshot",
            source: "codex",
            models: [`model-${id}`],
          },
        },
        profile: { ...profile, models: [`model-${id}`] },
      },
    }));
    const result = await hydrateDashboardGatewayAccounts("w", null, initial, [
      "first-page",
      "later-page",
      "later-page",
    ]);
    expect(mocks.get.mock.calls.map((call) => call[0])).toEqual([
      "first-page",
      "later-page",
    ]);
    expect(result?.status).toBe("ok");
    if (result?.status !== "ok") throw new Error("missing hydrated result");
    expect(
      result.value.accounts.map((row) => row.modelCatalog?.models),
    ).toEqual([["model-first-page"], ["model-later-page"]]);
    expect(result.value.nextCursor).toBe("next");
    expect(result.value.profiles).toEqual([profile]);
  });
  it("removes a selected row when its exact current read is denied", async () => {
    mocks.get.mockResolvedValue({ status: "denied" });
    const result = await hydrateDashboardGatewayAccounts("w", null, initial, [
      "first-page",
    ]);
    expect(result?.status === "ok" ? result.value.accounts : null).toEqual([]);
  });
  it("does not read account details for configurations without Gateway bindings", async () => {
    expect(await hydrateDashboardGatewayAccounts("w", null, initial, [])).toBe(
      initial,
    );
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
