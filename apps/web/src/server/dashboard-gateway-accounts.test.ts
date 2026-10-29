import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import { workspacePolicyFixture } from "../../../../packages/features/review-config/src/tests/current-policy-fixture";
import type {
  AccountProfileView,
  AccountView,
  AccountsPage,
  AccountsResult,
} from "./account-gateway-accounts";
import { loadDashboardGatewayAccounts } from "./dashboard-gateway-accounts";
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
function config(binding = "binding_1", model = "openai/gpt-4.1") {
  return parseReviewConfiguration({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        gatewayBindingId: binding,
        gatewayProfileRef: profile.id,
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

  it("does not read models for unselected accounts or metadata-only screens", async () => {
    mocks.list.mockResolvedValue(listed([account(), account("binding_2")]));
    await loadDashboardGatewayAccounts("workspace_1", null);
    expect(mocks.get).not.toHaveBeenCalled();
    await loadDashboardGatewayAccounts("workspace_1", null, [config()]);
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith("binding_1");
  });

  it("never unions catalogs for different bindings of the same profile", async () => {
    mocks.list.mockResolvedValue(listed([account(), account("binding_2")]));
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
