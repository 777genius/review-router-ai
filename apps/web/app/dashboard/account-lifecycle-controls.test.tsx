// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  act,
} from "@testing-library/react";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AccountView } from "../../src/server/account-gateway-accounts";
import type { AccountLifecycleView } from "../../src/server/account-lifecycle";
import {
  AccountLifecycleControls,
  type AccountLifecycleApi,
} from "./account-lifecycle-controls";
vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));
const clients: QueryClient[] = [];
const nonce = "33333333-3333-4333-8333-333333333333";
const source = (extra: Partial<AccountView> = {}): AccountView => ({
  connectionId: "source",
  label: "Team API",
  profileId: "mimo",
  profileLabel: "MiMo",
  authKind: "api_key",
  state: "active",
  canManage: true,
  isOwnedByViewer: true,
  mirrorRevision: 12,
  gatewayRevision: 34,
  authorizationEpoch: 5,
  lifecycle: { status: "available" },
  allowedActions: ["suspend", "delete"],
  binding: null,
  ...extra,
});
const receipt = (
  action: AccountLifecycleView["action"],
  phase: AccountLifecycleView["phase"],
  closureComplete = false,
): AccountLifecycleView => ({
  nonce,
  operationId: "original-operation",
  action,
  phase,
  closureComplete,
});
function fixture() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  clients.push(client);
  const api = {
    continue: vi.fn<AccountLifecycleApi["continue"]>(),
    mutate: vi.fn<AccountLifecycleApi["mutate"]>(),
    read: vi
      .fn<AccountLifecycleApi["read"]>()
      .mockResolvedValue({ status: "unavailable" }),
  };
  return { client, api };
}
function mount(
  f: ReturnType<typeof fixture>,
  account = source(),
  workspaceId = "workspace-A",
) {
  return render(
    <AccountLifecycleControls
      account={account}
      context="actor"
      workspaceId={workspaceId}
      client={f.client}
      api={f.api}
    />,
  );
}
async function confirm(action = "Выключить") {
  fireEvent.click(await screen.findByRole("button", { name: action }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("button", {
      name:
        action === "Удалить подключение…"
          ? "Удалить подключение навсегда"
          : "Подтвердить",
    }),
  );
  return dialog;
}
beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(nonce);
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});
test("open/cancel is inert, starts with Cancel focused, and exposes only server capabilities", async () => {
  const f = fixture();
  const view = mount(f);
  fireEvent.click(
    await screen.findByRole("button", { name: "Удалить подключение…" }),
  );
  const dialog = await screen.findByRole("dialog");
  const cancel = within(dialog).getByRole("button", { name: "Отмена" });
  await waitFor(() => expect(document.activeElement).toBe(cancel));
  expect(within(dialog).getByText(/Team API/)).toBeTruthy();
  expect(within(dialog).getByText(/во всех workspace/)).toBeTruthy();
  fireEvent.click(cancel);
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(f.api.mutate).not.toHaveBeenCalled();
  expect(f.api.read).not.toHaveBeenCalled();
  expect(sessionStorage.length).toBe(0);
  view.rerender(
    <AccountLifecycleControls
      account={source({
        state: "disabled",
        lifecycle: { status: "support_required" },
        allowedActions: [],
      })}
      context="actor"
      workspaceId="workspace-A"
      client={f.client}
      api={f.api}
    />,
  );
  expect(screen.queryByRole("button", { name: "Включить" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Выключить" })).toBeNull();
});
test("suspend and later server-proven resume keep original revision counters", async () => {
  const f = fixture();
  f.api.mutate
    .mockResolvedValueOnce({
      status: "ok",
      value: receipt("suspend", "applied"),
    })
    .mockResolvedValueOnce({
      status: "ok",
      value: receipt("resume", "applied"),
    });
  const view = mount(f);
  fireEvent.click(await screen.findByRole("button", { name: "Выключить" }));
  const dialog = await screen.findByRole("dialog");
  view.rerender(
    <AccountLifecycleControls
      account={source({
        mirrorRevision: 99,
        gatewayRevision: 99,
        authorizationEpoch: 99,
      })}
      context="actor"
      workspaceId="workspace-B"
      client={f.client}
      api={f.api}
    />,
  );
  fireEvent.click(within(dialog).getByRole("button", { name: "Подтвердить" }));
  await waitFor(() =>
    expect(
      within(dialog).getByText(/Учётные данные и разрешения сохранены/),
    ).toBeTruthy(),
  );
  expect(f.api.mutate).toHaveBeenCalledWith("actor", "workspace-A", {
    nonce,
    connectionId: "source",
    action: "suspend",
    mirrorRevision: 12,
    gatewayRevision: 34,
    authorizationEpoch: 5,
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Закрыть" }));
  view.rerender(
    <AccountLifecycleControls
      account={source({
        state: "suspended",
        mirrorRevision: 13,
        gatewayRevision: 35,
        authorizationEpoch: 6,
        allowedActions: ["resume", "delete"],
      })}
      context="actor"
      workspaceId="workspace-A"
      client={f.client}
      api={f.api}
    />,
  );
  await confirm("Включить");
  await waitFor(() => expect(f.api.mutate).toHaveBeenCalledTimes(2));
  expect(f.api.mutate.mock.calls[1]?.[2]).toEqual({
    nonce,
    connectionId: "source",
    action: "resume",
    mirrorRevision: 13,
    gatewayRevision: 35,
    authorizationEpoch: 6,
  });
});
test("delete applied alone stays visible; only original closure proof removes inventory across workspace caches", async () => {
  const f = fixture();
  f.api.mutate.mockResolvedValue({
    status: "ok",
    value: receipt("delete", "applied"),
  });
  for (const scope of [
    "actor:workspace:workspace-A",
    "actor:workspace:workspace-B",
  ]) {
    f.client.setQueryData(["accounts-overview", scope], {
      pages: [
        {
          status: "ok",
          value: { accounts: [source(), source({ connectionId: "other" })] },
        },
      ],
    });
  }
  f.client.setQueryData(["personal-accounts", "actor", "sources"], {
    sources: [{ sourceId: "source", label: "Team API" }],
  });
  f.client.setQueryData(["personal-accounts", "someone-else", "sources"], {
    sources: [{ sourceId: "source" }],
  });
  f.client.setQueryData(["unrelated", "actor"], { keep: true });
  f.client.setQueryData(
    ["account-option", "actor:workspace:workspace-B", "old-binding"],
    { status: "ok", value: { account: source(), profile: {} } },
  );
  mount(f);
  const dialog = await confirm("Удалить подключение…");
  await waitFor(() =>
    expect(
      within(dialog).getByText(
        /Завершение удаления и очистки пока не подтверждено/,
      ),
    ).toBeTruthy(),
  );
  expect(
    JSON.stringify(
      f.client.getQueryData([
        "accounts-overview",
        "actor:workspace:workspace-B",
      ]),
    ),
  ).toContain('"connectionId":"source"');
  f.api.read.mockResolvedValue({
    status: "ok",
    value: receipt("delete", "applied", true),
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Проверить исходную операцию" }),
  );
  await waitFor(() =>
    expect(f.api.read).toHaveBeenCalledWith("actor", "workspace-A", {
      operationId: "original-operation",
    }),
  );
  await waitFor(() =>
    expect(
      JSON.stringify(
        f.client.getQueryData([
          "accounts-overview",
          "actor:workspace:workspace-B",
        ]),
      ),
    ).not.toContain('"connectionId":"source"'),
  );
  expect(
    JSON.stringify(
      f.client.getQueryData([
        "accounts-overview",
        "actor:workspace:workspace-A",
      ]),
    ),
  ).toContain('"connectionId":"other"');
  expect(
    f.client.getQueryState(["accounts-overview", "actor:workspace:workspace-A"])
      ?.isInvalidated,
  ).toBe(true);
  expect(
    f.client.getQueryState(["accounts-overview", "actor:workspace:workspace-B"])
      ?.isInvalidated,
  ).toBe(true);
  expect(
    f.client.getQueryData(["personal-accounts", "someone-else", "sources"]),
  ).toEqual({ sources: [{ sourceId: "source" }] });
  expect(f.client.getQueryState(["unrelated", "actor"])?.isInvalidated).toBe(
    false,
  );
  expect(f.api.mutate).toHaveBeenCalledTimes(1);
  expect(
    f.client.getQueryData([
      "account-option",
      "actor:workspace:workspace-B",
      "old-binding",
    ]),
  ).toEqual({ status: "denied" });
});
test("lost ACK reload reads retained nonce in its original workspace; only pre-ingress Continue reuses exact intent", async () => {
  const f = fixture();
  f.api.mutate.mockRejectedValueOnce(new Error("lost response"));
  const view = mount(f);
  await confirm();
  await waitFor(() => expect(f.api.mutate).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(screen.getByRole("dialog").textContent).toContain(
      "Результат пока неизвестен",
    ),
  );
  view.unmount();
  await act(async () => {
    await f.client.cancelQueries();
  });
  f.api.read.mockClear();
  f.api.read.mockResolvedValue({
    status: "ok",
    value: receipt("suspend", "fencing"),
  });
  mount(
    f,
    source({ mirrorRevision: 99, authorizationEpoch: 99 }),
    "workspace-B",
  );
  await waitFor(() =>
    expect(f.api.read).toHaveBeenCalledWith("actor", "workspace-A", { nonce }),
  );
  expect(f.api.mutate).toHaveBeenCalledTimes(1);
  f.api.continue.mockResolvedValue({
    status: "ok",
    value: receipt("suspend", "unknown"),
  });
  fireEvent.click(
    await screen.findByRole("button", { name: "Продолжить исходное действие" }),
  );
  await waitFor(() =>
    expect(f.api.continue).toHaveBeenCalledWith(
      "actor",
      "workspace-A",
      "original-operation",
    ),
  );
  expect(f.api.mutate).toHaveBeenCalledTimes(1);
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Продолжить исходное действие" }),
    ).toBeNull(),
  );
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Проверить исходную операцию",
    }),
  );
  expect(f.api.mutate).toHaveBeenCalledTimes(1);
  expect(f.api.continue).toHaveBeenCalledTimes(1);
});
test("recipient cannot expose lifecycle mutations or operation recovery from another source", () => {
  const f = fixture();
  mount(
    f,
    source({
      canManage: false,
      isOwnedByViewer: false,
      lifecycle: { status: "pending", operationId: "foreign" },
      allowedActions: ["delete"],
    }),
  );
  expect(screen.queryByRole("button")).toBeNull();
  expect(f.api.mutate).not.toHaveBeenCalled();
  expect(f.api.read).not.toHaveBeenCalled();
});

test("authorized owner reopening without session intent can explicitly continue the durable original operation", async () => {
  const f = fixture();
  f.api.read.mockResolvedValue({
    status: "ok",
    value: receipt("delete", "ready"),
  });
  f.api.continue.mockResolvedValue({
    status: "ok",
    value: receipt("delete", "unknown"),
  });
  mount(
    f,
    source({
      canManage: false,
      isOwnedByViewer: true,
      lifecycle: { status: "pending", operationId: "original-operation" },
      allowedActions: [],
    }),
  );
  const button = await screen.findByRole("button", {
    name: "Продолжить исходное действие",
  });
  expect(f.api.mutate).not.toHaveBeenCalled();
  expect(f.api.continue).not.toHaveBeenCalled();
  fireEvent.click(button);
  await waitFor(() =>
    expect(f.api.continue).toHaveBeenCalledWith(
      "actor",
      "workspace-A",
      "original-operation",
    ),
  );
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", {
        name: "Продолжить исходное действие",
      }),
    ).toBeNull(),
  );
  expect(f.api.mutate).not.toHaveBeenCalled();
});

test("lost Continue acknowledgement requires a fresh read before any further continuation", async () => {
  const f = fixture();
  f.api.read.mockResolvedValue({
    status: "ok",
    value: receipt("suspend", "ready"),
  });
  f.api.continue.mockRejectedValue(new Error("lost acknowledgement"));
  mount(
    f,
    source({
      lifecycle: { status: "pending", operationId: "original-operation" },
      allowedActions: [],
    }),
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Продолжить исходное действие" }),
  );
  const dialog = await screen.findByRole("dialog");
  await waitFor(() =>
    expect(within(dialog).getByText(/Результат пока неизвестен/)).toBeTruthy(),
  );
  expect(
    within(dialog).queryByRole("button", {
      name: "Продолжить исходное действие",
    }),
  ).toBeNull();
  f.api.read.mockResolvedValue({
    status: "ok",
    value: receipt("suspend", "submitted"),
  });
  const check = within(dialog).getByRole("button", {
    name: "Проверить исходную операцию",
  });
  await waitFor(() =>
    expect((check as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(check);
  await waitFor(() =>
    expect(f.api.read).toHaveBeenCalledWith("actor", "workspace-A", {
      operationId: "original-operation",
    }),
  );
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", {
        name: "Продолжить исходное действие",
      }),
    ).toBeNull(),
  );
  expect(f.api.continue).toHaveBeenCalledTimes(1);
  expect(f.api.mutate).not.toHaveBeenCalled();
});

test("owning organization admin keeps pending operation recovery while availability is fenced", async () => {
  const f = fixture();
  f.api.mutate.mockResolvedValue({
    status: "ok",
    value: receipt("delete", "applied"),
  });
  function OwnerInventory() {
    const { data } = useQuery(
      {
        queryKey: ["accounts-overview", "actor:workspace:workspace-A"],
        initialData: {
          accounts: [
            source({ origin: "organization", isOwnedByViewer: false }),
          ],
        },
        queryFn: async () => ({ accounts: [] as AccountView[] }),
        enabled: false,
      },
      f.client,
    );
    return (
      <AccountLifecycleControls
        account={data.accounts[0]!}
        context="actor"
        workspaceId="workspace-A"
        client={f.client}
        api={f.api}
      />
    );
  }
  render(<OwnerInventory />);
  const dialog = await confirm("Удалить подключение…");
  await waitFor(() =>
    expect(
      within(dialog).getByText(
        /Завершение удаления и очистки пока не подтверждено/,
      ),
    ).toBeTruthy(),
  );
  expect(
    within(dialog).getByRole("button", { name: "Проверить исходную операцию" }),
  ).toBeTruthy();
  expect(f.api.mutate).toHaveBeenCalledTimes(1);
});
