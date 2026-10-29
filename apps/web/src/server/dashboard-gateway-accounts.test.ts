import { beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateDashboardGatewayAccounts } from "./dashboard-gateway-accounts";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";
const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn() }));
vi.mock("./gateway-model-account-composition", () => ({
  productionGatewayModelAccounts: async () => ({ reader: mocks }),
}));
vi.mock("./personal-account-composition", () => ({
  productionPersonalAccounts: async () => null,
}));
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
describe("selected Gateway account hydration", () => {
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
