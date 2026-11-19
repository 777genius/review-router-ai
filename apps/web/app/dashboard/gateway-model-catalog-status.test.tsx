// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountView } from "../../src/server/account-gateway-accounts";
import { GatewayModelCatalogStatus } from "./gateway-model-catalog-status";

afterEach(cleanup);
const account: AccountView = {
  connectionId: "connection-1",
  label: "My custom name",
  profileId: "mimo-profile",
  profileLabel: "MiMo",
  state: "active",
  gatewayRevision: 1,
  mirrorRevision: 1,
  binding: {
    id: "binding-1",
    revision: 1,
    state: "active",
    fencePending: false,
  },
};

it("distinguishes configured profile choices from account discovery and offers no dummy refresh", () => {
  const refresh = vi.fn();
  render(
    <GatewayModelCatalogStatus
      profile={undefined}
      account={account}
      accounts={{ loading: false, canRefresh: true, refreshModels: refresh }}
      bindingId="binding-1"
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Models from the connected profile",
  );
  expect(screen.queryByRole("button", { name: "Refresh models" })).toBeNull();
  expect(screen.getByRole("status").textContent).not.toMatch(/Codex|legacy/i);
  expect(refresh).not.toHaveBeenCalled();
});

it("does not offer refresh after an explicit unsupported discovery response", () => {
  render(
    <GatewayModelCatalogStatus
      profile={undefined}
      account={{
        ...account,
        modelCatalog: {
          status: "unsupported",
          source: "legacy_profile",
          models: [],
        },
      }}
      accounts={{ loading: false, canRefresh: true, refreshModels: vi.fn() }}
      bindingId="binding-1"
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "not supported for this connection",
  );
  expect(screen.queryByRole("button")).toBeNull();
});

it("keeps an unavailable discovery retryable without calling a saved choice unsupported", async () => {
  const refresh = vi.fn(async () => {});
  render(
    <GatewayModelCatalogStatus
      profile={undefined}
      account={{
        ...account,
        modelCatalog: {
          status: "unavailable",
          source: "legacy_profile",
          models: ["saved-model"],
        },
      }}
      accounts={{ loading: false, canRefresh: true, refreshModels: refresh }}
      bindingId="binding-1"
    />,
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Showing configured profile choices",
  );
  expect(screen.getByRole("status").textContent).toContain(
    "Your saved selection is unchanged",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
});

it("a pending refresh on another binding does not disable or fail the new account status", async () => {
  let reject!: (error: Error) => void;
  const refresh = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      }),
  );
  const selected = {
    ...account,
    modelCatalog: {
      status: "snapshot" as const,
      source: "codex" as const,
      models: ["model"],
      fetchedAt: "2026-10-26T12:00:00.000Z",
    },
  };
  const { rerender } = render(
    <GatewayModelCatalogStatus
      profile={undefined}
      account={selected}
      accounts={{ loading: false, canRefresh: true, refreshModels: refresh }}
      bindingId="binding-1"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  rerender(
    <GatewayModelCatalogStatus
      profile={undefined}
      account={{
        ...selected,
        connectionId: "connection-2",
        binding: { ...selected.binding!, id: "binding-2" },
      }}
      accounts={{ loading: false, canRefresh: true, refreshModels: vi.fn(async () => {}) }}
      bindingId="binding-1"
    />,
  );
  expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
    false,
  );
  await act(async () => reject(new Error("refresh failed")));
  expect(screen.getByRole("status").textContent).toContain(
    "Model list updated",
  );
  expect(screen.getByRole("status").textContent).not.toContain("Could not");
});

it("refreshes public metadata from the same button and reports its failure on its own line", async () => {
  const refreshAccount = vi.fn(async () => {});
  const publicCatalog = {
    snapshot: {
      providerKind: "codex" as const,
      models: [],
      source: "local" as const,
      fetchedAt: Date.now(),
      lastAttemptAt: Date.now(),
      state: "fresh" as const,
      error: null,
      refresh: "cached" as const,
    },
    loading: false,
    failed: false,
    refresh: vi.fn(async () => {}),
  };
  const props = {
    account: {
      ...account,
      modelCatalog: {
        status: "snapshot" as const,
        source: "codex" as const,
        models: ["model"],
        fetchedAt: "2026-10-26T12:00:00.000Z",
      },
    },
    accounts: {
      loading: false,
      canRefresh: true,
      refreshModels: refreshAccount,
    },
    bindingId: "binding-1",
  };
  const { rerender } = render(
    <GatewayModelCatalogStatus
      {...props}
      profile={undefined}
      publicCatalog={publicCatalog}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
  await waitFor(() => expect(publicCatalog.refresh).toHaveBeenCalledTimes(1));
  expect(refreshAccount).toHaveBeenCalledTimes(1);
  expect(screen.getAllByRole("status")).toHaveLength(1);
  rerender(
    <GatewayModelCatalogStatus
      profile={undefined}
      {...props}
      publicCatalog={{ ...publicCatalog, failed: true }}
    />,
  );
  expect(
    screen.getByText(
      "Could not update public model metadata. Showing saved model choices.",
    ),
  ).toBeTruthy();
  expect(
    screen.getAllByRole("button", { name: "Refresh models" }),
  ).toHaveLength(1);
  expect(screen.getAllByRole("status")[0]!.textContent).toMatch(
    /^Model list updated/,
  );
  // A later cooldown answer keeps the earlier source error.
  rerender(
    <GatewayModelCatalogStatus
      profile={undefined}
      {...props}
      publicCatalog={{
        ...publicCatalog,
        snapshot: {
          ...publicCatalog.snapshot,
          error: "source_unavailable",
          refresh: "cooldown",
        },
      }}
    />,
  );
  expect(
    screen.getByText(
      "Could not update public model metadata. Showing saved model choices.",
    ),
  ).toBeTruthy();
});

it("keeps public metadata refreshable when the account cannot list models", async () => {
  const refreshAccount = vi.fn(async () => {});
  const refreshPublic = vi.fn(async () => {});
  render(
    <GatewayModelCatalogStatus
      profile={undefined}
      account={{
        ...account,
        modelCatalog: {
          status: "unsupported",
          source: "legacy_profile",
          models: [],
        },
      }}
      accounts={{ loading: false, canRefresh: true, refreshModels: refreshAccount }}
      bindingId="binding-1"
      publicCatalog={{
        snapshot: {
          providerKind: "codex",
          models: [],
          source: "local",
          fetchedAt: Date.now(),
          lastAttemptAt: Date.now(),
          state: "fresh",
          error: null,
          refresh: "cached",
        },
        loading: false,
        failed: false,
        refresh: refreshPublic,
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh models" }));
  await waitFor(() => expect(refreshPublic).toHaveBeenCalledTimes(1));
  expect(refreshAccount).not.toHaveBeenCalled();
});
