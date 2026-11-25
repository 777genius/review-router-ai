// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import { OwnConnectionIdsContext } from "./account-workspace-use";

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
  vi.unstubAllGlobals();
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
async function openRemove(label = "Canonical old-BX") {
  fireEvent.keyDown(screen.getByLabelText(`Actions for ${label}`), {
    key: "ArrowDown",
  });
  fireEvent.click(
    await screen.findByRole("menuitem", { name: "Remove from this workspace" }),
  );
  return screen.findByRole("dialog");
}
async function confirm() {
  const dialog = await openRemove();
  // The fixture row is another member's personal connection without an owner fact.
  expect(
    within(dialog).getByText(/Only its owner can add it back/),
  ).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
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
test.each([
  { listedAbove: ["source-mine"], ownRowShown: false },
  // The viewer's own list failed to show it: keep it here rather than lose it.
  { listedAbove: [], ownRowShown: true },
])(
  "in the combined list, hides only own rows already listed above ($listedAbove)",
  async ({ listedAbove, ownRowShown }) => {
    const f = fixture();
    f.api.list.mockResolvedValue(
      page([
        { ...account("mine"), sourceId: "source-mine", isOwnedByViewer: true },
        account("theirs"),
        {
          ...account("org-unbound", "organization"),
          canManage: true,
          binding: null,
        },
      ]),
    );
    render(
      <OwnConnectionIdsContext.Provider value={new Set(listedAbove)}>
        <WorkspacePersonalAccounts
          scope="org-x"
          api={f.api}
          canDetach={false}
          detach={f.detach}
          readDetach={f.readDetach}
        />
      </OwnConnectionIdsContext.Provider>,
    );
    const theirs = await screen.findByRole("article", {
      name: "Canonical theirs",
    });
    expect(within(theirs).getByText("Used in this workspace")).toBeTruthy();
    expect(
      within(
        screen.getByRole("article", { name: "Canonical org-unbound" }),
      ).getByText("Not added to this workspace"),
    ).toBeTruthy();
    expect(
      screen.queryAllByRole("article", { name: "Canonical mine" }),
    ).toHaveLength(ownRowShown ? 1 : 0);
    // One header for the whole list is drawn above the viewer's own rows.
    expect(screen.queryByText("Owner")).toBeNull();
  },
);

test.each([
  { listedAbove: ["source-mine"], empty: false },
  { listedAbove: [], empty: true },
])(
  "shows the empty state only when the whole list is empty ($listedAbove)",
  async ({ listedAbove, empty }) => {
    const f = fixture();
    f.api.list.mockResolvedValue(
      page([
        { ...account("mine"), sourceId: "source-mine", isOwnedByViewer: true },
      ]),
    );
    render(
      <OwnConnectionIdsContext.Provider
        value={new Set(empty ? [] : listedAbove)}
      >
        <WorkspacePersonalAccounts
          scope="org-x"
          api={
            empty
              ? { ...f.api, list: vi.fn().mockResolvedValue(page([])) }
              : f.api
          }
          canDetach={false}
          detach={f.detach}
          readDetach={f.readDetach}
        />
      </OwnConnectionIdsContext.Provider>,
    );
    await waitFor(() =>
      expect(screen.queryByText("Loading connections...")).toBeNull(),
    );
    expect(Boolean(screen.queryByText(/^No connections yet/))).toBe(empty);
    expect(screen.queryByRole("article")).toBeNull();
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
    await screen.findByText("No connections on the loaded pages."),
  ).toBeTruthy();
  expect(screen.queryByText(/^No connections yet/)).toBeNull();
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
  const dialog = await openRemove();
  // A fresh lifetime arriving after opening confirmation cannot retarget the action.
  act(() =>
    context.client!.setQueryData(["accounts-overview", "org-x"], {
      pages: [page([account("new-BX")])],
      pageParams: [null],
    }),
  );
  f.api.list.mockResolvedValue(page([account("new-BX")]));
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  expect(
    await screen.findByText(
      "Removed from this workspace. Waiting for the gateway to confirm.",
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
      "Removed from this workspace. Waiting for the gateway to confirm.",
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
  expect(await screen.findByText("Removed from this workspace.")).toBeTruthy();
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
    "Removed from this workspace. Waiting for the gateway to confirm.",
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
      "Removal could not be confirmed. Check the original request.",
    ),
  ).toBeTruthy();
  expect(f.detach).toHaveBeenCalledTimes(1);
  expect(screen.queryByText(/Removed from this workspace/)).toBeNull();
  expect(screen.queryByText("private diagnostic")).toBeNull();
});

test("opening and cancelling removal never submits or reads a detachment operation", async () => {
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
  // One entry per row: the menu item, no separate Access button.
  expect(screen.queryByRole("button", { name: "Access" })).toBeNull();
  const dialog = await openRemove();
  expect(f.detach).not.toHaveBeenCalled();
  expect(f.readDetach).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  // Focus returns to the row menu it came from.
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByLabelText("Actions for Canonical old-BX"),
    ),
  );
  expect(f.detach).not.toHaveBeenCalled();
  expect(f.readDetach).not.toHaveBeenCalled();
});

test("members see other connections without Access or removal entries", async () => {
  const f = fixture();
  render(
    <WorkspacePersonalAccounts
      scope="org-x"
      api={f.api}
      canDetach={false}
      detach={f.detach}
      readDetach={f.readDetach}
    />,
  );
  await screen.findByText("Canonical old-BX");
  expect(screen.queryByRole("button", { name: "Access" })).toBeNull();
  expect(screen.queryByLabelText("Actions for Canonical old-BX")).toBeNull();
});

test.each([
  ["organization", { origin: "organization" as const }, /stays in this list/],
  [
    "viewer",
    {
      owner: {
        kind: "personal" as const,
        isViewer: true,
        handle: null,
        avatarUrl: null,
      },
    },
    /add it back from your connections/,
  ],
  [
    "operator",
    { origin: "operator" as const },
    /Only ReviewRouter can add it back/,
  ],
])("removal copy names who can undo it (%s)", async (_kind, fact, text) => {
  const f = fixture();
  f.api.list.mockResolvedValue(page([{ ...account("old-BX"), ...fact }]));
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
  const dialog = await openRemove();
  expect(within(dialog).getByText(text)).toBeTruthy();
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
  expect(screen.queryByLabelText("Actions for Canonical old-BX")).toBeNull();
  expect(screen.queryByRole("link", { name: "Choose for reviews" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Canonical old-BX" })).toBeNull();
  f.api.list.mockResolvedValue({ status: "denied" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: "Canonical old-BX" }),
    ).toBeNull(),
  );
});

test("restores saved limits when returning to a workspace tab with retained inventory", async () => {
  const f = fixture();
  const limits = {
    status: "snapshot" as const,
    scope: "account" as const,
    fetchedAt: "2026-10-22T10:00:00.000Z",
    displayToken: "current-generation",
    refreshAvailable: false as const,
    windows: [
      {
        label: "7d",
        durationSeconds: 604800,
        usedPercent: 25,
        remainingPercent: 75,
        progressPercent: 25,
        observedAt: "2026-10-22T10:00:00.000Z",
        resetAt: null,
        stale: true,
        reason: "observation_expired" as const,
      },
    ],
  };
  const initialPage = page([{ ...account("quota-remount"), limits }]);
  f.api.list.mockResolvedValue(initialPage);
  const fetch = vi.fn(async (url: RequestInfo | URL) => {
    void url;
    return {
      ok: true,
      json: async () => ({ status: "ok", value: limits }),
    };
  });
  vi.stubGlobal("fetch", fetch);
  const props = {
    scope: "quota-remount-viewer",
    personalScope: "personal-remount.signature",
    workspaceId: "org-x",
    api: f.api,
    canDetach: true,
    detach: f.detach,
    initialPage,
  };
  const first = render(<WorkspacePersonalAccounts {...props} />);
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
    "75",
  );
  expect(fetch).not.toHaveBeenCalled();
  first.unmount();
  await act(async () => {
    await Promise.resolve();
  });
  render(<WorkspacePersonalAccounts {...props} />);
  await waitFor(() =>
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe(
      "75",
    ),
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0]?.[0])).toContain(
    "/api/dashboard/accounts/limits?",
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
