// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import {
  afterEach,
  beforeEach,
  expect,
  test,
  vi,
  type MockInstance,
} from "vitest";
import type {
  AccountOperationView,
  AccountView,
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  beginGatewayOAuth,
  bindGatewayAccount,
  listGatewayAccounts,
  readGatewayOperation,
  submitGatewayApiKey,
} from "./account-gateway-account-actions";
import { AccountGatewayControls } from "./account-gateway-account-controls";

// Mock only the server boundary. React Query, its caches, and shared dialog/select
// primitives are real; this suite starts no service and sends no OAuth request.
vi.mock("./account-gateway-account-actions", () => ({
  beginGatewayOAuth: vi.fn(),
  bindGatewayAccount: vi.fn(),
  listGatewayAccounts: vi.fn(),
  readGatewayOperation: vi.fn(),
  submitGatewayApiKey: vi.fn(),
  mutateGatewayAccount: vi.fn(),
}));
const oauthProfileId = "openai-codex-oauth-responses-v1";
const context = "workspace-user.signature";
const storageKey = "rr-c3-account-operations:workspace-user";
const capability =
  "https://auth.openai.com/oauth/authorize?synthetic-owner-capability";
const savedNonce = "9874b2bc-e987-4456-9212-7f94f58932da";
const clients = new Set<QueryClient>();
const cacheSnapshots: string[] = [];
let page: AccountsPage;
let storageWrites: MockInstance<Storage["setItem"]>;
let handoff: MockInstance<Window["open"]>;

function safeOperation(
  nonce: string,
  state: AccountOperationView["state"] = "pending",
): AccountsResult<AccountOperationView> {
  return { status: "ok", value: { nonce, state, cleanup: "unresolved" } };
}
function row(state: AccountView["state"] = "staging"): AccountView {
  return {
    connectionId: "codex-connection",
    label: "Workspace Codex",
    profileId: oauthProfileId,
    profileLabel: "Codex",
    authKind: "oauth",
    state,
    gatewayRevision: 1,
    mirrorRevision: 1,
    binding: null,
  };
}
function caches(client: QueryClient): string {
  return JSON.stringify({
    queries: client
      .getQueryCache()
      .getAll()
      .map((q) => ({ key: q.queryKey, state: q.state })),
    mutations: client
      .getMutationCache()
      .getAll()
      .map((m) => ({ key: m.options.mutationKey, state: m.state })),
  });
}
function assertNoCapability() {
  const actual = [
    ...cacheSnapshots,
    ...[...clients].map(caches),
    JSON.stringify(storageWrites.mock.calls),
    JSON.stringify({ ...sessionStorage, ...localStorage }),
    document.body.innerHTML,
    JSON.stringify(vi.mocked(readGatewayOperation).mock.calls),
  ].join("\n");
  expect(actual).not.toContain(capability);
  expect(actual).not.toContain("synthetic-owner-capability");
  expect(actual).not.toContain("authorizationURL");
}
async function mount() {
  const view = render(
    <AccountGatewayControls
      bootstrap={{ context, page: { status: "ok", value: page } }}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Connect Codex OAuth",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  return view;
}
async function startEnrollment() {
  fireEvent.click(screen.getByRole("button", { name: "Connect Codex OAuth" }));
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText("API key")).toBeNull();
  fireEvent.change(within(dialog).getByLabelText("Account label"), {
    target: { value: "New Codex" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Authorize Codex" }),
  );
  await waitFor(() => expect(beginGatewayOAuth).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  localStorage.clear();
  clients.clear();
  cacheSnapshots.length = 0;
  page = {
    profiles: [
      {
        id: "mimo",
        label: "MiMo",
        authKind: "api_key",
        canReconnect: true,
        protocol: "openai-responses",
        models: ["mimo"],
      },
      {
        id: oauthProfileId,
        label: "Codex",
        authKind: "oauth",
        canReconnect: false,
        protocol: "openai-responses",
        models: ["codex"],
      },
    ],
    accounts: [row()],
    nextCursor: null,
  };
  // Observe the REAL client created by the public component; preserve its lifecycle.
  const mountClient = QueryClient.prototype.mount;
  vi.spyOn(QueryClient.prototype, "mount").mockImplementation(function (
    this: QueryClient,
  ) {
    clients.add(this);
    this.getQueryCache().subscribe(() => cacheSnapshots.push(caches(this)));
    this.getMutationCache().subscribe(() => cacheSnapshots.push(caches(this)));
    mountClient.call(this);
  });
  storageWrites = vi.spyOn(Storage.prototype, "setItem");
  handoff = vi.spyOn(window, "open").mockImplementation(() => {
    assertNoCapability();
    return null;
  });
  vi.mocked(listGatewayAccounts).mockImplementation(async () => ({
    status: "ok",
    value: page,
  }));
  vi.mocked(readGatewayOperation).mockImplementation(async (_context, nonce) =>
    safeOperation(nonce),
  );
  vi.mocked(beginGatewayOAuth).mockImplementation(async (_context, intent) => ({
    status: "ok",
    value: {
      operation: {
        nonce: intent.nonce,
        state: "pending",
        cleanup: "unresolved",
      },
      authorizationURL: capability,
    },
  }));
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  vi.restoreAllMocks();
});

// RED regression: caching the entire fresh Begin result (or mutation variables),
// persisting its URL, or auto-replaying enrollment on a manual status read.
test("fresh OAuth handoff bypasses caches/storage and pending readback never reopens it", async () => {
  const view = await mount();
  await startEnrollment();
  await waitFor(() => expect(handoff).toHaveBeenCalledTimes(1));
  expect(handoff).toHaveBeenCalledWith(
    capability,
    "_blank",
    "noopener,noreferrer",
  );
  const request = vi.mocked(beginGatewayOAuth).mock.calls[0]!;
  expect(request[0]).toBe(context);
  expect(request[1]).toEqual({
    nonce: expect.any(String),
    profileId: oauthProfileId,
    label: "New Codex",
  });
  const nonce = request[1].nonce;
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([nonce]);
  expect(
    storageWrites.mock.calls.every(([, value]) => {
      const nonces: unknown = JSON.parse(String(value));
      return (
        Array.isArray(nonces) &&
        nonces.every((n) => typeof n === "string" && /^[0-9a-f-]{36}$/.test(n))
      );
    }),
  ).toBe(true);
  await screen.findByText("Operation 1: pending");
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledWith(context, nonce),
  );
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  assertNoCapability();
  view.unmount();
  await mount(); // UUID survives a reload; the capability does not.
  await screen.findByText("Operation 1: pending");
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  assertNoCapability();
});

// RED regression: treating lost Begin ACK as no effect, dropping its nonce, or
// retrying Begin rather than reading the same saved operation identity.
test("lost Begin ACK retains unknown nonce and reconciles only through safe readback", async () => {
  vi.mocked(beginGatewayOAuth).mockRejectedValueOnce(
    new Error("synthetic lost ACK"),
  );
  vi.mocked(readGatewayOperation).mockImplementation(async (_context, nonce) =>
    safeOperation(nonce, "unknown"),
  );
  await mount();
  await startEnrollment();
  await screen.findByText("Operation 1: unknown");
  const nonce = vi.mocked(beginGatewayOAuth).mock.calls[0]![1].nonce;
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([nonce]);
  expect(handoff).not.toHaveBeenCalled();
  vi.mocked(readGatewayOperation).mockImplementation(async (_context, nonce) =>
    safeOperation(nonce),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await screen.findByText("Operation 1: pending");
  expect(readGatewayOperation).toHaveBeenCalledWith(context, nonce);
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  assertNoCapability();
});

// RED regression: OAuth rows get API-key reconnect, staging rows grant a binding,
// or a pending read is promoted without the gateway's active account descriptor.
test("OAuth rows hide API-key reconnect and become selectable only after an active descriptor", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify([savedNonce]));
  page.accounts.push({
    ...row("active"),
    connectionId: "mimo-connection",
    label: "Workspace MiMo",
    profileId: "mimo",
    profileLabel: "MiMo",
    authKind: "api_key",
  });
  await mount();
  await screen.findByText("Operation 1: pending");
  const oauthRow = screen
    .getByText("Workspace Codex")
    .closest("div.flex")! as HTMLElement;
  expect(
    within(oauthRow).queryByRole("button", { name: "Reconnect API key" }),
  ).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "Reconnect API key" }),
  ).toHaveLength(1);
  const pendingBinding = within(oauthRow).getByRole("button", {
    name: "Create workspace binding",
  }) as HTMLButtonElement;
  expect(pendingBinding.disabled).toBe(true);
  fireEvent.click(pendingBinding);
  expect(bindGatewayAccount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Connect API key" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("combobox"));
  expect(await screen.findByRole("option", { name: /MiMo/ })).toBeTruthy();
  expect(screen.queryByRole("option", { name: /Codex/ })).toBeNull();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() => expect(readGatewayOperation).toHaveBeenCalledTimes(2));
  expect(pendingBinding.disabled).toBe(true);
  page = { ...page, accounts: [row("active")] };
  vi.mocked(readGatewayOperation).mockResolvedValueOnce({
    status: "ok",
    value: {
      nonce: savedNonce,
      state: "applied",
      cleanup: "unresolved",
      account: row("active"),
    },
  });
  vi.mocked(bindGatewayAccount).mockResolvedValue({
    status: "ok",
    value: { label: "Workspace Codex" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Create workspace binding",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Create workspace binding" }),
  );
  await waitFor(() => expect(bindGatewayAccount).toHaveBeenCalledTimes(1));
  expect(bindGatewayAccount).toHaveBeenCalledWith(context, {
    connectionId: "codex-connection",
    gatewayRevision: 1,
    mirrorRevision: 1,
    bindingRevision: 0,
  });
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  expect(handoff).not.toHaveBeenCalled();
  assertNoCapability();
});
