// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, type InfiniteData } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type {
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import type { GatewayModelAccountsApi } from "./gateway-model-account-options";
import { WorkspacePersonalAccounts } from "./workspace-personal-accounts";

const context = vi.hoisted(() => ({ client: null as QueryClient | null }));
vi.mock("./gateway-model-account-options", () => ({
  useGatewayModelAccountsQueryClient: () => context.client,
}));
beforeEach(() => {
  context.client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});
afterEach(() => {
  cleanup();
  context.client?.clear();
  context.client = null;
});
const account = (
  bindingId: string,
  origin: "personal" | "organization" = "personal",
): AccountView & { origin: typeof origin } => ({
  connectionId: "incoming-masked-binding-handle",
  label: `Canonical ${bindingId}`,
  origin,
  profileId: "mimo",
  profileLabel: "MiMo",
  state: "active",
  gatewayRevision: 90,
  mirrorRevision: 12,
  binding: { id: bindingId, revision: 7, state: "active", fencePending: false },
});
const page = (
  accounts: AccountView[],
  nextCursor: string | null = null,
): AccountsResult<AccountsPage> => ({
  status: "ok",
  value: { accounts, profiles: [], nextCursor },
});
function fixture() {
  const api = {
    list: vi
      .fn<GatewayModelAccountsApi["list"]>()
      .mockResolvedValue(page([account("old-BX")])),
    get: vi.fn<GatewayModelAccountsApi["get"]>(),
  };
  const detach = vi
    .fn<Parameters<typeof WorkspacePersonalAccounts>[0]["detach"]>()
    .mockResolvedValue({
      status: "ok",
      value: {
        bindingId: "old-BX",
        workspaceId: "org-x",
        revision: 8,
        state: "revoked",
        localAuthorization: "local_denied",
        remoteFenceDelivery: "remote_pending",
      },
    });
  return { api, detach };
}
async function confirm() {
  fireEvent.click(
    screen.getByRole("button", { name: "Detach from this organization" }),
  );
  expect(
    await screen.findByText(
      /personal account and its use in other organizations are unaffected/,
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm detachment" }));
}
test("is inert without an explicit authorized API", () => {
  const f = fixture();
  render(
    <WorkspacePersonalAccounts scope="org-x" canDetach detach={f.detach} />,
  );
  expect(screen.queryByRole("region")).toBeNull();
  expect(f.api.list).not.toHaveBeenCalled();
  expect(f.detach).not.toHaveBeenCalled();
});
test.each([false, true])(
  "shows only the authorized personal ownership fact without granting management (%s)",
  async (isOwnedByViewer) => {
    const f = fixture();
    f.api.list.mockResolvedValue(
      page([
        { ...account("old-BX"), isOwnedByViewer },
        account("org-owned", "organization"),
      ]),
    );
    render(
      <WorkspacePersonalAccounts
        scope="org-x"
        api={f.api}
        canDetach={false}
        detach={f.detach}
      />,
    );
    expect(await screen.findByText("Canonical old-BX")).toBeTruthy();
    expect(
      screen.getByText(
        isOwnedByViewer
          ? "Your personal account · shared here"
          : "Shared personal account",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Canonical org-owned")).toBeNull();
    expect(screen.queryByRole("button", { name: /Detach/ })).toBeNull();
    expect(screen.queryByText("incoming-masked-binding-handle")).toBeNull();
    expect(screen.queryByText("90")).toBeNull();
    expect(f.detach).not.toHaveBeenCalled();
  },
);
test("an empty filtered page keeps the next page reachable", async () => {
  const f = fixture();
  f.api.list
    .mockResolvedValueOnce(
      page([account("org-owned", "organization")], "cursor-first"),
    )
    .mockResolvedValueOnce(page([account("offpage")]));
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach={false}
      detach={f.detach}
    />,
  );
  expect(
    await screen.findByText("No shared personal accounts on the loaded pages."),
  ).toBeTruthy();
  expect(
    screen.queryByText("No shared personal accounts available."),
  ).toBeNull();
  fireEvent.click(
    screen.getByRole("button", { name: "Load more shared accounts" }),
  );
  expect(await screen.findByText("Canonical offpage")).toBeTruthy();
  expect(f.api.list).toHaveBeenNthCalledWith(2, {
    limit: 25,
    afterBindingId: "cursor-first",
  });
});
test("captures the exact old binding and preserves local deny while checking its same request", async () => {
  const f = fixture();
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach
      detach={f.detach}
    />,
  );
  await screen.findByText("Canonical old-BX");
  fireEvent.click(
    screen.getByRole("button", { name: "Detach from this organization" }),
  );
  // A fresh lifetime arriving after opening confirmation cannot retarget the action.
  act(() =>
    context.client!.setQueryData(["account-options", "org-x"], {
      pages: [page([account("new-BX")])],
      pageParams: [null],
    }),
  );
  f.api.list.mockResolvedValue(page([account("new-BX")]));
  fireEvent.click(screen.getByRole("button", { name: "Confirm detachment" }));
  expect(
    await screen.findByText(
      "Access revoked locally in this organization; gateway confirmation pending.",
    ),
  ).toBeTruthy();
  expect(f.detach).toHaveBeenCalledWith({
    bindingId: "old-BX",
    expectedBindingRevision: 7,
  });
  expect(await screen.findByText("Canonical new-BX")).toBeTruthy();
  f.detach.mockResolvedValueOnce({ status: "unavailable" });
  fireEvent.click(screen.getByRole("button", { name: "Check confirmation" }));
  await waitFor(() => expect(f.detach).toHaveBeenCalledTimes(2));
  expect(
    screen.getByText(
      "Access revoked locally in this organization; gateway confirmation pending.",
    ),
  ).toBeTruthy();
  f.detach.mockResolvedValueOnce({
    status: "ok",
    value: {
      bindingId: "old-BX",
      workspaceId: "org-x",
      revision: 8,
      state: "revoked",
      localAuthorization: "local_denied",
      remoteFenceDelivery: "remote_applied",
    },
  });
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Check confirmation",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check confirmation" }));
  expect(
    await screen.findByText(
      "Access revoked in this organization; gateway confirmation received.",
    ),
  ).toBeTruthy();
  expect(
    f.detach.mock.calls.every(
      ([request]) =>
        request.bindingId === "old-BX" && request.expectedBindingRevision === 7,
    ),
  ).toBe(true);
});
test("cancels exact shared option caches before removing the retired binding, without changing other scopes", async () => {
  const f = fixture();
  const client = context.client!;
  client.setQueryData(["account-options", "other-org"], {
    pages: [page([account("other")])],
    pageParams: [null],
  });
  client.setQueryData(["account-option", "org-x", "old-BX"], {
    status: "ok",
    value: { account: account("old-BX") },
  });
  const cancel = vi.spyOn(client, "cancelQueries"),
    set = vi.spyOn(client, "setQueryData"),
    invalidate = vi.spyOn(client, "invalidateQueries");
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach
      detach={f.detach}
    />,
  );
  await screen.findByText("Canonical old-BX");
  f.api.list.mockResolvedValue(page([]));
  await confirm();
  await screen.findByText(
    "Access revoked locally in this organization; gateway confirmation pending.",
  );
  await waitFor(() =>
    expect(client.getQueryData(["account-option", "org-x", "old-BX"])).toEqual({
      status: "denied",
    }),
  );
  expect(cancel).toHaveBeenCalledWith({
    queryKey: ["account-options", "org-x"],
    exact: true,
  });
  expect(cancel).toHaveBeenCalledWith({
    queryKey: ["account-option", "org-x", "old-BX"],
    exact: true,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["account-options", "org-x"],
    exact: true,
  });
  expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(
    set.mock.invocationCallOrder[0]!,
  );
  expect(
    client.getQueryData<InfiniteData<AccountsResult<AccountsPage>>>([
      "account-options",
      "other-org",
    ])!.pages,
  ).toEqual([page([account("other")])]);
});
test("does not automatically retry or claim a local deny without a matching safe receipt", async () => {
  const f = fixture();
  f.detach.mockRejectedValueOnce(new Error("private diagnostic"));
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach
      detach={f.detach}
    />,
  );
  await screen.findByText("Canonical old-BX");
  await confirm();
  expect(
    await screen.findByText(
      "Detachment could not be confirmed. Check the original request.",
    ),
  ).toBeTruthy();
  expect(f.detach).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Access revoked locally/)).toBeNull();
  expect(screen.queryByText("private diagnostic")).toBeNull();
});
