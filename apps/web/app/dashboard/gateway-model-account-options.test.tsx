// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
  AccountsPage,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import {
  GatewayModelAccountsProvider,
  useGatewayModelAccounts,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";
import { GatewayModelCatalogStatus } from "./gateway-model-catalog-status";
import { getReadyGatewayAccounts } from "../../src/server/dashboard-provider-setup-readiness";

afterEach(cleanup);
const profile = {
  id: "mimo",
  label: "MiMo",
  protocol: "openai-responses" as const,
  models: ["mimo-v2.6-pro"],
};
const account = (id: string): AccountView => ({
  connectionId: "canonical-source",
  label: id,
  profileId: profile.id,
  profileLabel: profile.label,
  state: "active",
  gatewayRevision: 3,
  mirrorRevision: 7,
  binding: { id, revision: 1, state: "active", fencePending: false },
});
const page: AccountsPage = {
  accounts: [account("page-one")],
  profiles: [profile],
  nextCursor: "page-one",
};
function Harness({ initial = page }: { initial?: AccountsPage }) {
  const options = useGatewayModelAccounts({ status: "ok", value: initial }, [
    "saved-binding",
  ]);
  const ready = getReadyGatewayAccounts(options.accounts);
  return (
    <>
      <input aria-label="Saved binding" value="saved-binding" readOnly />
      <span>
        {ready.some((row) => row.binding?.id === "saved-binding")
          ? "Saved selection available"
          : "Saved selection unavailable"}
      </span>
      {ready.map((row) => (
        <span key={row.binding!.id}>{row.label}</span>
      ))}
      <button onClick={options.loadMore}>Load more</button>
      <button onClick={options.refresh}>Refresh</button>
    </>
  );
}
test.each(["denied", "error"] as const)(
  "retains the exact first-paint selection while detail is pending, then removes it on %s",
  async (outcome) => {
    type Detail = Awaited<ReturnType<GatewayModelAccountsApi["get"]>>;
    let resolveDetail!: (value: Detail) => void;
    let rejectDetail!: (reason: Error) => void;
    const detail = new Promise<Detail>((resolve, reject) => {
      resolveDetail = resolve;
      rejectDetail = reject;
    });
    const api = {
      list: vi.fn<GatewayModelAccountsApi["list"]>(),
      get: vi.fn<GatewayModelAccountsApi["get"]>().mockReturnValue(detail),
    };
    render(
      <GatewayModelAccountsProvider scope="org-x" api={api}>
        <Harness
          initial={{
            ...page,
            accounts: [account("saved-binding"), account("fresh-binding")],
            nextCursor: null,
          }}
        />
      </GatewayModelAccountsProvider>,
    );
    expect(screen.getByText("Saved selection available")).toBeTruthy();
    await waitFor(() => expect(api.get).toHaveBeenCalledWith("saved-binding"));
    expect(screen.getByText("Saved selection available")).toBeTruthy();
    await act(async () => {
      if (outcome === "denied") resolveDetail({ status: "denied" });
      else rejectDetail(new Error("detail transport unavailable"));
    });
    await waitFor(() =>
      expect(screen.getByText("Saved selection unavailable")).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText("Saved binding") as HTMLInputElement).value,
    ).toBe("saved-binding");
    expect(screen.getByText("fresh-binding")).toBeTruthy();
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.list).not.toHaveBeenCalled();
  },
);
test("exact saved offpage binding stays selected, while a retired binding never follows a fresh lifetime", async () => {
  const api = {
    list: vi.fn<GatewayModelAccountsApi["list"]>().mockResolvedValue({
      status: "ok",
      value: {
        accounts: [account("fresh-binding")],
        profiles: [profile],
        nextCursor: null,
      },
    }),
    get: vi.fn<GatewayModelAccountsApi["get"]>().mockResolvedValue({
      status: "ok",
      value: { account: account("saved-binding"), profile },
    }),
  };
  render(
    <GatewayModelAccountsProvider scope="org-x" api={api}>
      <Harness />
    </GatewayModelAccountsProvider>,
  );
  expect(await screen.findByText("Saved selection available")).toBeTruthy();
  fireEvent.click(screen.getByText("Load more"));
  expect(await screen.findByText("fresh-binding")).toBeTruthy();
  expect(api.list).toHaveBeenCalledWith({
    afterBindingId: "page-one",
    limit: 25,
  });
  api.get.mockResolvedValue({ status: "denied" });
  fireEvent.click(screen.getByText("Refresh"));
  await waitFor(() =>
    expect(screen.getByText("Saved selection unavailable")).toBeTruthy(),
  );
  expect(
    (screen.getByLabelText("Saved binding") as HTMLInputElement).value,
  ).toBe("saved-binding");
  expect(screen.getByText("fresh-binding")).toBeTruthy();
  expect(
    api.get.mock.calls.every(([bindingId]) => bindingId === "saved-binding"),
  ).toBe(true);
});

function ScopedCatalogHarness() {
  const selected = ["account-a", "account-b"];
  const options = useGatewayModelAccounts(
    {
      status: "ok",
      value: {
        accounts: selected.map(account),
        profiles: [profile],
        nextCursor: null,
      },
    },
    selected,
  );
  const rows =
    options.accounts?.status === "ok" ? options.accounts.value.accounts : [];
  return (
    <>
      {rows.map((row) => (
        <span key={row.binding!.id}>
          {row.binding!.id}:{options.profileFor(row)?.models.join(",")}
        </span>
      ))}
      <button onClick={() => void options.refreshModels("account-a")}>
        Refresh A models
      </button>
    </>
  );
}

// RED if detail results are indexed by profileId, or force refresh invalidates
// another account's snapshot/settings instead of the exact scoped binding.
test("same-profile account catalogs remain separate, including empty snapshots and exact refresh", async () => {
  const get = vi
    .fn<GatewayModelAccountsApi["get"]>()
    .mockImplementation(async (bindingId, options) => ({
      status: "ok",
      value: {
        account: account(bindingId),
        profile: {
          ...profile,
          models:
            bindingId === "account-b"
              ? []
              : [options?.forceRefresh ? "a-refreshed" : "a-only"],
        },
      },
    }));
  const api = { list: vi.fn<GatewayModelAccountsApi["list"]>(), get };
  render(
    <GatewayModelAccountsProvider scope="viewer:workspace:org-x" api={api}>
      <ScopedCatalogHarness />
    </GatewayModelAccountsProvider>,
  );
  expect(await screen.findByText("account-a:a-only")).toBeTruthy();
  expect(await screen.findByText("account-b:")).toBeTruthy();
  fireEvent.click(screen.getByText("Refresh A models"));
  expect(await screen.findByText("account-a:a-refreshed")).toBeTruthy();
  expect(screen.getByText("account-b:")).toBeTruthy();
  expect(get).toHaveBeenCalledWith("account-a", { forceRefresh: true });
  expect(get.mock.calls.filter(([id]) => id === "account-b")).toHaveLength(1);
});

function RefreshCatalogHarness() {
  const options = useGatewayModelAccounts(
    {
      status: "ok",
      value: {
        accounts: [account("saved-binding")],
        profiles: [profile],
        nextCursor: null,
      },
    },
    ["saved-binding"],
  );
  const selected = getReadyGatewayAccounts(options.accounts).find(
    (row) => row.binding?.id === "saved-binding",
  );
  return (
    <>
      <input aria-label="Saved model" value="historical-model" readOnly />
      <span>Models:{options.profileFor(selected)?.models.join(",")}</span>
      <GatewayModelCatalogStatus
        account={selected}
        loading={options.loading}
        canRefresh={options.canRefresh}
        onRefresh={() => options.refreshModels("saved-binding")}
      />
    </>
  );
}

// RED if a temporary refresh failure removes the retry action, retains a
// falsely fresh catalog, or a real denial preserves the old authorized row.
test.each(["unavailable", "transport"] as const)(
  "manual model refresh remains retryable after %s while catalog admission fails closed",
  async (failure) => {
    const detail = (
      model: string,
    ): Awaited<ReturnType<GatewayModelAccountsApi["get"]>> => ({
      status: "ok",
      value: {
        account: {
          ...account("saved-binding"),
          modelCatalog: {
            status: "snapshot",
            source: "codex",
            models: [model],
            fetchedAt: "2026-10-25T10:00:00.000Z",
          },
        },
        profile: { ...profile, models: [model] },
      },
    });
    const get = vi
      .fn<GatewayModelAccountsApi["get"]>()
      .mockResolvedValueOnce(detail("first-model"));
    if (failure === "transport")
      get.mockRejectedValueOnce(new Error("temporary transport failure"));
    else get.mockResolvedValueOnce({ status: "unavailable" });
    get.mockResolvedValueOnce(detail("recovered-model"));
    const api = { list: vi.fn<GatewayModelAccountsApi["list"]>(), get };
    render(
      <GatewayModelAccountsProvider scope="viewer:workspace:org-x" api={api}>
        <RefreshCatalogHarness />
      </GatewayModelAccountsProvider>,
    );
    expect(await screen.findByText("Models:first-model")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Refresh models$/ }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain(
        "Could not load account models. Try refreshing the model list. Your saved selection is unchanged.",
      ),
    );
    expect(screen.getByText("Models:")).toBeTruthy();
    expect(
      (screen.getByLabelText("Saved model") as HTMLInputElement).value,
    ).toBe("historical-model");
    const retry = screen.getByRole("button", {
      name: /^Refresh models$/,
    }) as HTMLButtonElement;
    expect(retry.disabled).toBe(false);
    fireEvent.click(retry);
    expect(await screen.findByText("Models:recovered-model")).toBeTruthy();
    expect(get.mock.calls.slice(1)).toEqual([
      ["saved-binding", { forceRefresh: true }],
      ["saved-binding", { forceRefresh: true }],
    ]);
    get.mockResolvedValueOnce({ status: "denied" });
    fireEvent.click(screen.getByRole("button", { name: /^Refresh models$/ }));
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^Refresh models$/ }),
      ).toBeNull(),
    );
    expect(screen.getByText("Models:")).toBeTruthy();
  },
);
