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
  useCurrentGatewayModelAccountsCache: () => null,
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
  connectionId: `masked-${bindingId}`,
  label: `Canonical ${bindingId}`,
  origin,
  profileId: "mimo",
  profileLabel: "MiMo",
  state: "active",
  readiness: "ready",
  allowedActions: ["detach"],
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
  const readDetach = vi
    .fn<
      NonNullable<Parameters<typeof WorkspacePersonalAccounts>[0]["readDetach"]>
    >()
    .mockResolvedValue({ status: "unavailable" });
  return { api, detach, readDetach };
}
async function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Access" }));
  expect(
    await screen.findByText(
      /Your personal account and other organizations stay unchanged/,
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
}
test("is inert without an explicit authorized API", () => {
  const f = fixture();
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      canDetach
      detach={f.detach}
      readDetach={f.readDetach}
    />,
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
        {
          ...account("old-BX"),
          isOwnedByViewer,
          owner: {
            kind: "personal",
            isViewer: isOwnedByViewer,
            handle: null,
            avatarUrl: null,
          },
        },
        account("org-owned", "organization"),
      ]),
    );
    render(
      <WorkspacePersonalAccounts
        scope="org-x"
        api={f.api}
        canDetach={false}
        detach={f.detach}
        readDetach={f.readDetach}
      />,
    );
    expect(await screen.findByText("Canonical old-BX")).toBeTruthy();
    expect(
      screen.getByText(isOwnedByViewer ? "You" : "Owner unavailable"),
    ).toBeTruthy();
    expect(screen.getByText("Canonical org-owned")).toBeTruthy();
    expect(screen.queryByText("90")).toBeNull();
    expect(
      [...document.querySelectorAll("a")].some(
        (link) =>
          link.href.includes("incoming-masked-binding-handle") ||
          link.href.includes("old-BX"),
      ),
    ).toBe(false);
    expect(f.detach).not.toHaveBeenCalled();
  },
);
test("an empty filtered page keeps the next page reachable", async () => {
  const f = fixture();
  f.api.list
    .mockResolvedValueOnce(page([], "cursor-first"))
    .mockResolvedValueOnce(page([account("offpage")]));
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach={false}
      detach={f.detach}
      readDetach={f.readDetach}
    />,
  );
  expect(
    await screen.findByText("No available connections on the loaded pages."),
  ).toBeTruthy();
  expect(screen.queryByText("No available connections.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
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
      readDetach={f.readDetach}
    />,
  );
  await screen.findByText("Canonical old-BX");
  fireEvent.click(screen.getByRole("button", { name: "Access" }));
  // A fresh lifetime arriving after opening confirmation cannot retarget the action.
  act(() =>
    context.client!.setQueryData(["accounts-overview", "org-x"], {
      pages: [page([account("new-BX")])],
      pageParams: [null],
    }),
  );
  f.api.list.mockResolvedValue(page([account("new-BX")]));
  fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
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
  f.readDetach.mockResolvedValueOnce({ status: "unavailable" });
  fireEvent.click(
    screen.getByRole("button", { name: "Check original request" }),
  );
  await waitFor(() => expect(f.readDetach).toHaveBeenCalledTimes(1));
  expect(f.detach).toHaveBeenCalledTimes(1);
  expect(
    screen.getByText(
      "Access revoked locally in this organization; gateway confirmation pending.",
    ),
  ).toBeTruthy();
  f.readDetach.mockResolvedValueOnce({
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
          name: "Check original request",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Check original request" }),
  );
  expect(
    await screen.findByText(
      "Access revoked in this organization; gateway confirmation received.",
    ),
  ).toBeTruthy();
  expect(
    [...f.detach.mock.calls, ...f.readDetach.mock.calls].every(
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
      readDetach={f.readDetach}
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
    queryKey: ["accounts-overview", "org-x"],
    exact: true,
  });
  expect(cancel).toHaveBeenCalledWith({
    queryKey: ["account-option", "org-x", "old-BX"],
    exact: true,
  });
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ["accounts-overview", "org-x"],
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
      readDetach={f.readDetach}
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

test("opening and cancelling Access never submits or reads a detachment operation", async () => {
  const f = fixture();
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach
      detach={f.detach}
      readDetach={f.readDetach}
    />,
  );
  await screen.findByText("Canonical old-BX");
  fireEvent.click(screen.getByRole("button", { name: "Access" }));
  await screen.findByRole("dialog");
  expect(f.detach).not.toHaveBeenCalled();
  expect(f.readDetach).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(f.detach).not.toHaveBeenCalled();
  expect(f.readDetach).not.toHaveBeenCalled();
});

vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));

// Regression boundary: a temporary read failure must not empty the account list,
// while a denied read must remove names and all authority from stale rows.
test("retains stale rows without actions on unavailable, then clears them on denied", async () => {
  const f = fixture();
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach
      detach={f.detach}
      initialPage={page([account("old-BX")])}
    />,
  );
  expect(
    await screen.findByRole("article", { name: "Canonical old-BX" }),
  ).toBeTruthy();
  f.api.list.mockResolvedValue({ status: "unavailable" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
  await screen.findByText("Connections could not be refreshed. Try again.");
  expect(
    screen.getByRole("article", { name: "Canonical old-BX" }),
  ).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Access" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  expect(screen.queryByRole("link", { name: "Choose in Models" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Canonical old-BX" })).toBeNull();
  f.api.list.mockResolvedValue({ status: "denied" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: "Canonical old-BX" }),
    ).toBeNull(),
  );
});

test("a refreshed same-scope bootstrap removes old limit figures and discarded inventory pages", async () => {
  const f = fixture();
  const row = {
    ...account("quota-row"),
    limits: {
      status: "snapshot" as const,
      scope: "account" as const,
      fetchedAt: "2026-10-22T10:00:00.000Z",
      displayToken: "old-generation",
      refreshAvailable: false as const,
      windows: [
        {
          label: "5h",
          durationSeconds: 18000,
          usedPercent: 37.5,
          remainingPercent: 62.5,
          progressPercent: 37.5,
          observedAt: "2026-10-22T10:00:00.000Z",
          resetAt: null,
          stale: false,
          reason: null,
        },
      ],
    },
  };
  f.api.list.mockResolvedValue(page([row]));
  const props = {
    scope: "quota-viewer",
    personalScope: "personal-quota.signature",
    workspaceId: "org-x",
    api: f.api,
    canDetach: true,
    detach: f.detach,
  };
  const { rerender } = render(
    <WorkspacePersonalAccounts {...props} initialPage={page([row])} />,
  );
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "62.5",
  );
  rerender(<WorkspacePersonalAccounts {...props} initialPage={page([])} />);
  expect(screen.queryByRole("progressbar")).toBeNull();
  await waitFor(() =>
    expect(screen.queryByRole("article", { name: row.label })).toBeNull(),
  );
  await waitFor(() => {
    const cached = context.client?.getQueryData<
      InfiniteData<AccountsResult<AccountsPage>, string | null>
    >(["accounts-overview", props.scope]);
    expect(cached?.pages).toHaveLength(1);
    expect(cached?.pages[0]).toEqual(page([]));
  });
});

test("a canceled old inventory read cannot overwrite a refreshed bootstrap limit projection", async () => {
  const f = fixture();
  let resolveOld!: (value: AccountsResult<AccountsPage>) => void;
  f.api.list.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      }),
  );
  const oldRow: AccountView = {
    ...account("quota-race"),
    limits: {
      status: "unknown",
      reason: "missing_snapshot",
      fetchedAt: "2026-10-22T10:00:00.000Z",
      displayToken: "generation-a",
      refreshAvailable: false,
    },
  };
  const newRow: AccountView = {
    ...oldRow,
    limits: {
      status: "unknown",
      reason: "missing_snapshot",
      fetchedAt: "2026-10-22T10:01:00.000Z",
      displayToken: "generation-b",
      refreshAvailable: false,
    },
  };
  const props = {
    scope: "quota-race-viewer",
    personalScope: "personal-race.signature",
    workspaceId: "org-x",
    api: f.api,
    canDetach: true,
    detach: f.detach,
  };
  const { rerender } = render(
    <WorkspacePersonalAccounts {...props} initialPage={page([oldRow])} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
  await waitFor(() => expect(f.api.list).toHaveBeenCalledTimes(1));
  rerender(
    <WorkspacePersonalAccounts {...props} initialPage={page([newRow])} />,
  );
  const key = [
    "account-limits",
    "workspace:org-x:personal-race",
    oldRow.connectionId,
  ] as const;
  await waitFor(() =>
    expect(context.client?.getQueryData(key)).toEqual({
      status: "ok",
      value: newRow.limits,
    }),
  );
  await act(async () => {
    resolveOld(page([oldRow]));
    await Promise.resolve();
  });
  expect(context.client?.getQueryData(key)).toEqual({
    status: "ok",
    value: newRow.limits,
  });
});
