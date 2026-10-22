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
  AccountOAuthBeginView,
  AccountOperationView,
  AccountView,
  AccountsPage,
  AccountsResult,
} from "../../src/server/account-gateway-accounts";
import {
  beginGatewayOAuth,
  completeGatewayOAuth,
  bindGatewayAccount,
  listGatewayAccounts,
  readGatewayOperation,
  submitGatewayApiKey,
  mutateGatewayAccount,
} from "./account-gateway-account-actions";
import { AccountsAddDialog } from "./accounts-add-dialog";
import {
  AccountGatewayControls,
  type AccountGatewayManagementApi,
} from "./account-gateway-account-controls";

// Mock only the server boundary. React Query, its caches, and shared dialog/select
// primitives are real; this suite starts no service and sends no OAuth request.
vi.mock("./account-gateway-account-actions", () => ({
  beginGatewayOAuth: vi.fn(),
  completeGatewayOAuth: vi.fn(),
  pollGatewayOAuth: vi.fn(),
  bindGatewayAccount: vi.fn(),
  listGatewayAccounts: vi.fn(),
  readGatewayOperation: vi.fn(),
  submitGatewayApiKey: vi.fn(),
  mutateGatewayAccount: vi.fn(),
}));
const oauthProfileId = "openai-codex-oauth-responses-v1";
const context = "workspace-user.signature";
const storageKey = "rr-c3-account-operations:workspace-user";
// Vitest aliases window to Node's global; use its actual DOM storage realm.
const browserLocalStorage = (
  globalThis as typeof globalThis & { jsdom: { window: Window } }
).jsdom.window.localStorage;
const capability =
  "https://auth.openai.com/oauth/authorize?synthetic-owner-capability";
const savedNonce = "9874b2bc-e987-4456-9212-7f94f58932da";
const callbackCode = "synthetic-callback-secret";
const callbackState = "b".repeat(64);
const callbackURL = `http://localhost:1455/auth/callback?code=${callbackCode}&state=${callbackState}`;
const clients = new Set<QueryClient>();
const cacheSnapshots: string[] = [];
let page: AccountsPage;
let storageWrites: MockInstance<Storage["setItem"]>;
let handoff: MockInstance<Window["open"]>;
let anchors: HTMLAnchorElement[];
let reserved: {
  opener: Window | null;
  document: Document;
  location: Pick<Location, "replace">;
  close: ReturnType<typeof vi.fn<() => void>>;
  closed: boolean;
};

function safeOperation(
  nonce: string,
  state: AccountOperationView["state"] = "pending",
): AccountsResult<AccountOperationView> {
  return { status: "ok", value: { nonce, state, cleanup: "unresolved" } };
}
function row(state: AccountView["state"] = "staging"): AccountView {
  return {
    connectionId: "codex-connection",
    canManage: true,
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
    JSON.stringify({ ...sessionStorage, ...browserLocalStorage }),
    document.body.innerHTML,
    JSON.stringify(vi.mocked(readGatewayOperation).mock.calls),
  ].join("\n");
  expect(actual).not.toContain(capability);
  expect(actual).not.toContain("synthetic-owner-capability");
  expect(actual).not.toContain("authorizationURL");
}
function assertNoCallback() {
  const actual = [
    ...cacheSnapshots,
    ...[...clients].map(caches),
    JSON.stringify(storageWrites.mock.calls),
    JSON.stringify({ ...sessionStorage, ...browserLocalStorage }),
    document.body.innerHTML,
    JSON.stringify(vi.mocked(readGatewayOperation).mock.calls),
  ].join("\n");
  for (const secret of [callbackURL, callbackCode, callbackState])
    expect(actual).not.toContain(secret);
  const field = screen.queryByLabelText(
    "Authorization result address",
  ) as HTMLInputElement | null;
  if (field) expect(field.value).toBe("");
}
async function mount(
  props: {
    api?: AccountGatewayManagementApi;
    managementScope?: "workspace" | "personal";
  } = {},
) {
  const view = render(
    <AccountGatewayControls
      bootstrap={{ context, page: { status: "ok", value: page } }}
      {...props}
    />,
  );
  const add = await screen.findByRole("button", {
    name: /Add account|Connect account/,
  });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.keyDown(add, { key: "ArrowDown" });
  await screen.findByRole("menuitem", { name: "Connect Codex OAuth" });
  return view;
}
async function chooseBrowser(dialog: HTMLElement) {
  fireEvent.click(
    within(dialog).getByRole("combobox", { name: "Sign-in method" }),
  );
  const option = await screen.findByRole("option", {
    name: /Browser callback/,
  });
  fireEvent.mouseMove(option);
  fireEvent.click(option);
}
async function startEnrollment() {
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Connect Codex OAuth" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).queryByLabelText("API key")).toBeNull();
  await chooseBrowser(dialog);
  fireEvent.change(within(dialog).getByLabelText("Connection name"), {
    target: { value: "New Codex" },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Sign in to Codex" }),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  sessionStorage.clear();
  browserLocalStorage.clear();
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
        dedicatedBaseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
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
  storageWrites = vi.spyOn(
    Object.getPrototypeOf(sessionStorage) as Storage,
    "setItem",
  );
  reserved = {
    opener: window,
    document: document.implementation.createHTMLDocument(),
    location: { replace: vi.fn() },
    close: vi.fn(),
    closed: false,
  };
  anchors = [];
  const createElement = reserved.document.createElement.bind(reserved.document);
  vi.spyOn(reserved.document, "createElement").mockImplementation(
    (name, options) => {
      const element = createElement(name, options);
      if (name === "a") {
        const anchor = element as HTMLAnchorElement;
        anchors.push(anchor);
        vi.spyOn(anchor, "click").mockImplementation(() => {
          expect(anchor.target).toBe("_self");
          expect(anchor.rel).toBe("noreferrer");
          expect(anchor.referrerPolicy).toBe("no-referrer");
          reserved.location.replace(anchor.href);
        });
      }
      return element;
    },
  );
  handoff = vi.spyOn(window, "open").mockImplementation(() => {
    assertNoCapability();
    // A narrow WindowProxy double: no real browser or provider navigation.
    return reserved as unknown as Window;
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

function personalApi() {
  return {
    listGatewayAccounts: vi
      .fn<typeof listGatewayAccounts>()
      .mockImplementation(async () => ({ status: "ok", value: page })),
    mutateGatewayAccount: vi
      .fn<typeof mutateGatewayAccount>()
      .mockImplementation(async (_scope, intent) =>
        safeOperation(intent.nonce, "applied"),
      ),
    submitGatewayApiKey: vi
      .fn<typeof submitGatewayApiKey>()
      .mockImplementation(async (_scope, intent) =>
        safeOperation(intent.nonce, "applied"),
      ),
    readGatewayOperation: vi
      .fn<typeof readGatewayOperation>()
      .mockImplementation(async (_scope, nonce) =>
        safeOperation(nonce, "applied"),
      ),
    beginGatewayOAuth: vi
      .fn<typeof beginGatewayOAuth>()
      .mockImplementation(async (_scope, intent) => ({
        status: "ok",
        value: {
          operation: {
            nonce: intent.nonce,
            state: "pending",
            cleanup: "unresolved",
          },
          authorizationURL: capability,
        },
      })),
    completeGatewayOAuth: vi
      .fn<typeof completeGatewayOAuth>()
      .mockImplementation(async (_scope, intent) =>
        safeOperation(intent.nonce, "applied"),
      ),
  };
}

test("personal scope reuses canonical controls through injected actions and never offers workspace use management", async () => {
  page.accounts = [
    {
      ...row("active"),
      connectionId: "own-source",
      label: "Personal MiMo",
      profileId: "mimo",
      profileLabel: "MiMo",
      authKind: "api_key",
      binding: {
        id: "personal-use",
        revision: 2,
        state: "active",
        fencePending: false,
      },
    },
  ];
  page.canGrantOperatorUse = true;
  const api = personalApi();
  await mount({ api, managementScope: "personal" });
  for (const name of [
    "Select workspace binding",
    "Add to this workspace",
    "Remove from this workspace",
    "Disable",
  ])
    expect(screen.queryByRole("button", { name })).toBeNull();
  expect(screen.queryByLabelText("Workspace ID")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  let dialog = await screen.findByRole("dialog");
  fireEvent.change(within(dialog).getByLabelText("Connection name"), {
    target: { value: "Shared canonical name" },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(api.mutateGatewayAccount).toHaveBeenCalledWith(context, {
      kind: "rename",
      nonce: expect.any(String),
      connectionId: "own-source",
      gatewayRevision: 1,
      mirrorRevision: 1,
      label: "Shared canonical name",
    }),
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Update API key",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Update API key" }));
  dialog = await screen.findByRole("dialog");
  const key = "synthetic-personal-reconnect-key";
  fireEvent.change(within(dialog).getByLabelText("API key"), {
    target: { value: key },
  });
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(api.submitGatewayApiKey).toHaveBeenCalledWith(
      context,
      {
        kind: "reconnect",
        nonce: expect.any(String),
        connectionId: "own-source",
        gatewayRevision: 1,
        mirrorRevision: 1,
      },
      key,
    ),
  );
  expect(
    screen.queryByRole("button", { name: "Disable permanently…" }),
  ).toBeNull();
  expect(api.mutateGatewayAccount).not.toHaveBeenCalledWith(
    context,
    expect.objectContaining({ kind: "disable" }),
  );
  expect(mutateGatewayAccount).not.toHaveBeenCalled();
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  expect(bindGatewayAccount).not.toHaveBeenCalled();
  expect([...clients].map(caches).join("\n")).not.toContain(key);
  expect(JSON.stringify(storageWrites.mock.calls)).not.toContain(key);
});

test("personal OAuth injection preserves the existing one-off handoff and completion custody", async () => {
  const api = personalApi();
  api.readGatewayOperation.mockImplementation(async (_scope, nonce) =>
    safeOperation(nonce),
  );
  await mount({ api, managementScope: "personal" });
  await startEnrollment();
  await waitFor(() => expect(api.beginGatewayOAuth).toHaveBeenCalledTimes(1));
  const nonce = api.beginGatewayOAuth.mock.calls[0]![1].nonce;
  const dialog = await screen.findByRole("dialog", {
    name: "Complete Codex authorization",
  });
  fireEvent.change(
    within(dialog).getByLabelText("Authorization result address"),
    { target: { value: callbackURL } },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Complete authorization" }),
  );
  await waitFor(() =>
    expect(api.completeGatewayOAuth).toHaveBeenCalledWith(context, {
      nonce,
      callbackURL,
    }),
  );
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(completeGatewayOAuth).not.toHaveBeenCalled();
  expect(api.beginGatewayOAuth).toHaveBeenCalledTimes(1);
  assertNoCapability();
  assertNoCallback();
});
test.each(["applied", "lost_ack"] as const)(
  "personal key continuation keeps original nonce and discards deferred ready reads (%s)",
  async (outcome) => {
    const personalStorage = "rr-c3-account-operations:personal:workspace-user";
    sessionStorage.setItem(personalStorage, JSON.stringify([savedNonce]));
    const resume = {
      kind: "reconnect" as const,
      connectionId: "own-source",
      profileId: "mimo",
      gatewayRevision: 17,
      mirrorRevision: 4,
    };
    const ready: AccountsResult<AccountOperationView> = {
      status: "ok",
      value: {
        nonce: savedNonce,
        state: "pending",
        cleanup: "unresolved",
        resume,
      },
    };
    const api = personalApi();
    api.readGatewayOperation.mockResolvedValue(ready);
    await mount({ api, managementScope: "personal" });
    await screen.findByRole("button", { name: "Continue key update" });
    expect(
      screen.queryByRole("button", { name: "Resume Codex authorization" }),
    ).toBeNull();
    const client = [...clients][0]!;
    const queryKey = [
      "gateway-accounts",
      "personal:workspace-user",
      "operation",
      savedNonce,
    ] as const;
    let releaseOld!: (value: AccountsResult<AccountOperationView>) => void;
    const oldRead = new Promise<AccountsResult<AccountOperationView>>(
      (resolve) => {
        releaseOld = resolve;
      },
    );
    api.readGatewayOperation.mockImplementationOnce(() => oldRead);
    let oldFetch!: Promise<void>;
    act(() => {
      oldFetch = client.refetchQueries({ queryKey, exact: true });
    });
    await waitFor(() =>
      expect(api.readGatewayOperation).toHaveBeenCalledTimes(2),
    );

    let resolveEntry!: (value: AccountsResult<AccountOperationView>) => void;
    let rejectEntry!: (reason: Error) => void;
    const entry = new Promise<AccountsResult<AccountOperationView>>(
      (resolve, reject) => {
        resolveEntry = resolve;
        rejectEntry = reject;
      },
    );
    api.submitGatewayApiKey.mockImplementation(async () => {
      // The DOM must release the credential before either cancellation or API awaits.
      expect(field.value).toBe("");
      return entry;
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Continue key update" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Continue key update",
    });
    const field = within(dialog).getByLabelText("API key") as HTMLInputElement;
    const secret = "synthetic-original-nonce-continuation-key";
    fireEvent.change(field, { target: { value: secret } });
    const form = field.closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(field.value).toBe("");
    await waitFor(() =>
      expect(api.submitGatewayApiKey).toHaveBeenCalledTimes(1),
    );
    expect(api.submitGatewayApiKey).toHaveBeenCalledWith(
      context,
      { ...resume, nonce: savedNonce },
      secret,
    );
    expect(JSON.parse(sessionStorage.getItem(personalStorage)!)).toEqual([
      savedNonce,
    ]);

    let releaseDuring!: (value: AccountsResult<AccountOperationView>) => void;
    const duringRead = new Promise<AccountsResult<AccountOperationView>>(
      (resolve) => {
        releaseDuring = resolve;
      },
    );
    api.readGatewayOperation.mockImplementationOnce(() => duringRead);
    let duringFetch!: Promise<void>;
    act(() => {
      duringFetch = client.refetchQueries({ queryKey, exact: true });
    });
    await waitFor(() =>
      expect(api.readGatewayOperation).toHaveBeenCalledTimes(3),
    );
    await act(async () => {
      if (outcome === "applied")
        resolveEntry(safeOperation(savedNonce, "applied"));
      else rejectEntry(new Error("synthetic_lost_ack"));
    });
    const expectedState = outcome === "applied" ? "applied" : "unknown";
    await waitFor(() =>
      expect(client.getQueryData(queryKey)).toMatchObject({
        status: "ok",
        value: { nonce: savedNonce, state: expectedState },
      }),
    );
    await act(async () => {
      releaseOld(ready);
      releaseDuring(ready);
      await Promise.all([oldFetch, duringFetch]);
    });
    expect(client.getQueryData(queryKey)).toMatchObject({
      status: "ok",
      value: { state: expectedState },
    });
    expect(
      screen.queryByRole("button", { name: "Continue key update" }),
    ).toBeNull();
    // Even a later stale ready response cannot re-enter this nonce in the same owner component.
    await act(async () => {
      await client.refetchQueries({ queryKey, exact: true });
    });
    expect(
      screen.queryByRole("button", { name: "Continue key update" }),
    ).toBeNull();
    expect(api.submitGatewayApiKey).toHaveBeenCalledTimes(1);
    expect(submitGatewayApiKey).not.toHaveBeenCalled();
    const retained = [
      ...cacheSnapshots,
      ...[...clients].map(caches),
      JSON.stringify(storageWrites.mock.calls),
      JSON.stringify({ ...sessionStorage, ...browserLocalStorage }),
      document.body.innerHTML,
    ].join("\n");
    expect(retained).not.toContain(secret);
  },
);

test("late fence permits key reentry only after an explicit fresh ready check on the original nonce", async () => {
  const personalStorage = "rr-c3-account-operations:personal:workspace-user";
  sessionStorage.setItem(personalStorage, JSON.stringify([savedNonce]));
  const resume = {
    kind: "reconnect" as const,
    connectionId: "own-source",
    profileId: "mimo",
    gatewayRevision: 17,
    mirrorRevision: 4,
  };
  const ready: AccountsResult<AccountOperationView> = {
    status: "ok",
    value: {
      nonce: savedNonce,
      state: "pending",
      cleanup: "unresolved",
      resume,
    },
  };
  const api = personalApi();
  let lateFence = false;
  api.readGatewayOperation.mockImplementation(async () =>
    lateFence ? safeOperation(savedNonce) : ready,
  );
  api.submitGatewayApiKey.mockImplementation(async () =>
    lateFence
      ? safeOperation(savedNonce)
      : safeOperation(savedNonce, "applied"),
  );
  await mount({ api, managementScope: "personal" });
  await screen.findByRole("button", { name: "Continue key update" });
  lateFence = true; // Role-loss fence appears after the original ready response.
  async function enter(key: string) {
    fireEvent.click(
      screen.getByRole("button", { name: "Continue key update" }),
    );
    const dialog = await screen.findByRole("dialog", {
      name: "Continue key update",
    });
    fireEvent.change(within(dialog).getByLabelText("API key"), {
      target: { value: key },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Continue update" }),
    );
  }
  await enter("synthetic-before-late-fence-key");
  await waitFor(() => expect(api.submitGatewayApiKey).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Check status",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(api.readGatewayOperation).toHaveBeenCalledTimes(2),
  );
  expect(
    screen.queryByRole("button", { name: "Continue key update" }),
  ).toBeNull();
  lateFence = false; // Exact fence ACK has now made the original operation ready again.
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Check status",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await screen.findByRole("button", { name: "Continue key update" });
  await enter("synthetic-after-ack-key");
  await waitFor(() => expect(api.submitGatewayApiKey).toHaveBeenCalledTimes(2));
  expect(api.submitGatewayApiKey.mock.calls.map((call) => call[1])).toEqual([
    { ...resume, nonce: savedNonce },
    { ...resume, nonce: savedNonce },
  ]);
  expect(JSON.parse(sessionStorage.getItem(personalStorage)!)).toEqual([
    savedNonce,
  ]);
  const retained = [
    ...cacheSnapshots,
    ...[...clients].map(caches),
    JSON.stringify(storageWrites.mock.calls),
  ].join("\n");
  expect(retained).not.toContain("synthetic-before-late-fence-key");
  expect(retained).not.toContain("synthetic-after-ack-key");
});

test("key continuation reports an unconfirmed submission instead of silently dropping the entered key", async () => {
  const personalStorage = "rr-c3-account-operations:personal:workspace-user";
  sessionStorage.setItem(personalStorage, JSON.stringify([savedNonce]));
  const resume = {
    kind: "reconnect" as const,
    connectionId: "own-source",
    profileId: "mimo",
    gatewayRevision: 17,
    mirrorRevision: 4,
  };
  const api = personalApi();
  api.readGatewayOperation.mockResolvedValue({
    status: "ok",
    value: {
      nonce: savedNonce,
      state: "pending",
      cleanup: "unresolved",
      resume,
    },
  });
  api.submitGatewayApiKey.mockRejectedValue(new Error("synthetic_lost_ack"));
  await mount({ api, managementScope: "personal" });
  fireEvent.click(screen.getByRole("button", { name: "Continue key update" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Continue key update",
  });
  const secret = "synthetic-unconfirmed-continuation-key";
  fireEvent.change(within(dialog).getByLabelText("API key"), {
    target: { value: secret },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Continue update" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toMatch(/not confirmed as saved/i);
  expect(alert.textContent).not.toContain(secret);
  expect(alert.textContent).not.toContain("synthetic_lost_ack");
  const client = [...clients][0]!;
  await waitFor(() =>
    expect(
      client.getQueryData([
        "gateway-accounts",
        "personal:workspace-user",
        "operation",
        savedNonce,
      ]),
    ).toMatchObject({
      status: "ok",
      value: { nonce: savedNonce, state: "unknown" },
    }),
  );
});
test("key continuation reports the server rejection reason for an unsaved key", async () => {
  const personalStorage = "rr-c3-account-operations:personal:workspace-user";
  sessionStorage.setItem(personalStorage, JSON.stringify([savedNonce]));
  const resume = {
    kind: "reconnect" as const,
    connectionId: "own-source",
    profileId: "mimo",
    gatewayRevision: 17,
    mirrorRevision: 4,
  };
  const api = personalApi();
  api.readGatewayOperation.mockResolvedValue({
    status: "ok",
    value: {
      nonce: savedNonce,
      state: "pending",
      cleanup: "unresolved",
      resume,
    },
  });
  api.submitGatewayApiKey.mockResolvedValue({ status: "conflict" });
  await mount({ api, managementScope: "personal" });
  fireEvent.click(screen.getByRole("button", { name: "Continue key update" }));
  const dialog = await screen.findByRole("dialog", {
    name: "Continue key update",
  });
  const secret = "synthetic-conflict-continuation-key";
  fireEvent.change(within(dialog).getByLabelText("API key"), {
    target: { value: secret },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Continue update" }),
  );
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toContain("The key was not saved.");
  expect(alert.textContent).toContain(
    "The account changed. Refresh Accounts before trying again.",
  );
  expect(document.body.innerHTML).not.toContain(secret);
});
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  vi.restoreAllMocks();
});

test("MiMo uses its enabled URL and optional default label once, keeping the key out of caches", async () => {
  page.accounts.push({
    ...row("active"),
    connectionId: "mimo-existing",
    label: "MiMo Account 1",
    profileId: "mimo",
    profileLabel: "MiMo",
    authKind: "api_key",
  });
  vi.mocked(submitGatewayApiKey).mockImplementation(async (_context, intent) =>
    safeOperation(intent.nonce),
  );
  await mount();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Connect with API key" }),
  );
  const dialog = await screen.findByRole("dialog");
  const label = within(dialog).getByLabelText(
    "Connection name (optional)",
  ) as HTMLInputElement;
  expect(label.value).toBe("MiMo Account 2");
  expect(label.required).toBe(false);
  fireEvent.change(label, { target: { value: "" } });
  const key = "synthetic-write-only-MiMo-key";
  fireEvent.change(within(dialog).getByLabelText("API key"), {
    target: { value: key },
  });
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Connect account" }),
  );
  await waitFor(() => expect(submitGatewayApiKey).toHaveBeenCalledTimes(1));
  const intent = vi.mocked(submitGatewayApiKey).mock.calls[0]![1];
  expect(intent).toEqual({
    kind: "connect",
    nonce: expect.any(String),
    profileId: "mimo",
    label: "MiMo Account 2",
    baseURL: "https://token-plan-sgp.xiaomimimo.com/v1",
  });
  fireEvent.click(await screen.findByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledWith(context, intent.nonce),
  );
  expect(submitGatewayApiKey).toHaveBeenCalledTimes(1);
  expect([...clients].map(caches).join("\n")).not.toContain(key);
  expect(JSON.stringify(storageWrites.mock.calls)).not.toContain(key);
});

test("manual MiMo URL rejects unenabled regions and provider changes preserve an explicit label", async () => {
  page.profiles.push({
    id: "openrouter",
    label: "OpenRouter",
    protocol: "openai-responses",
    authKind: "api_key",
    models: ["fixture"],
  });
  await mount();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Connect with API key" }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(
    within(dialog).getByLabelText("Connection name (optional)"),
    {
      target: { value: "My account" },
    },
  );
  fireEvent.click(
    within(dialog).getByRole("combobox", { name: /Dedicated Base URL/ }),
  );
  expect(
    (await screen.findByRole("option", { name: /China/ })).getAttribute(
      "aria-disabled",
    ),
  ).toBe("true");
  const manualOption = screen.getByRole("option", {
    name: "Enter URL manually",
  });
  fireEvent.mouseMove(manualOption);
  fireEvent.click(manualOption);
  fireEvent.change(
    await within(dialog).findByLabelText("Base URL from your Token Plan"),
    { target: { value: "https://token-plan-cn.xiaomimimo.com/v1" } },
  );
  expect(
    (
      within(dialog).getByRole("button", {
        name: "Connect account",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  fireEvent.click(
    within(dialog).getByRole("combobox", { name: /Provider profile/ }),
  );
  const routerOption = await screen.findByRole("option", {
    name: /OpenRouter/,
  });
  fireEvent.mouseMove(routerOption);
  fireEvent.click(routerOption);
  expect(
    (
      within(dialog).getByLabelText(
        "Connection name (optional)",
      ) as HTMLInputElement
    ).value,
  ).toBe("My account");
  expect(
    within(dialog).queryByLabelText("Base URL from your Token Plan"),
  ).toBeNull();
});

// Reserve and protect a usable tab during submit, before the awaited server
// boundary; only the fresh response can navigate it, never cache or readback.
test("fresh OAuth handoff bypasses caches/storage and pending readback never reopens it", async () => {
  let releaseBegin!: (response: AccountsResult<AccountOAuthBeginView>) => void;
  let protectionAtBegin: unknown;
  vi.mocked(beginGatewayOAuth).mockImplementationOnce(() => {
    protectionAtBegin = {
      reservations: [...handoff.mock.calls],
      opener: reserved.opener,
      referrer: reserved.document.querySelector<HTMLMetaElement>(
        'meta[name="referrer"]',
      )?.content,
    };
    return new Promise((resolve) => {
      releaseBegin = resolve;
    });
  });
  const view = await mount();
  await startEnrollment();
  await waitFor(() => expect(beginGatewayOAuth).toHaveBeenCalledTimes(1));
  expect(protectionAtBegin).toEqual({
    reservations: [["about:blank", "_blank"]],
    opener: null,
    referrer: "no-referrer",
  });
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(reserved.close).not.toHaveBeenCalled();
  const request = vi.mocked(beginGatewayOAuth).mock.calls[0]!;
  expect(request[0]).toBe(context);
  expect(request[1]).toEqual({
    nonce: expect.any(String),
    profileId: oauthProfileId,
    label: "New Codex",
    method: "browser",
  });
  const nonce = request[1].nonce;
  await act(async () =>
    releaseBegin({
      status: "ok",
      value: {
        operation: { nonce, state: "pending", cleanup: "unresolved" },
        authorizationURL: capability,
      },
    }),
  );
  await waitFor(() =>
    expect(reserved.location.replace).toHaveBeenCalledTimes(1),
  );
  expect(reserved.location.replace).toHaveBeenCalledWith(capability);
  expect(anchors).toHaveLength(1);
  expect(anchors[0]!.getAttribute("href")).toBeNull();
  expect(reserved.close).not.toHaveBeenCalled();
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
  await screen.findByText("Waiting for completion");
  const completionDialog = await screen.findByRole("dialog", {
    name: "Complete Codex authorization",
  });
  expect(within(completionDialog).getByText(/cannot return here/)).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.keyDown(completionDialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledWith(context, nonce),
  );
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).toHaveBeenCalledTimes(1);
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  assertNoCapability();
  view.rerender(
    <AccountGatewayControls
      bootstrap={{ context, page: { status: "ok", value: page } }}
    />,
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  const readsBeforeReplayCheck =
    vi.mocked(readGatewayOperation).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledTimes(
      readsBeforeReplayCheck + 1,
    ),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
  view.unmount();
  await mount(); // UUID survives a reload; the capability does not.
  await screen.findByText("Waiting for completion");
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
  assertNoCapability();
});

test("fresh pending completion survives an unavailable Accounts refresh after its handoff is consumed", async () => {
  let releasePage!: (result: AccountsResult<AccountsPage>) => void;
  vi.mocked(listGatewayAccounts).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releasePage = resolve;
      }),
  );
  await mount();
  await startEnrollment();
  const dialog = await screen.findByRole("dialog", {
    name: "Complete Codex authorization",
  });
  await waitFor(() => expect(listGatewayAccounts).toHaveBeenCalledTimes(1));
  await act(async () => releasePage({ status: "unavailable" }));
  await waitFor(() =>
    expect(
      screen.queryByRole("button", { name: "Connect Codex OAuth" }),
    ).toBeNull(),
  );
  expect(
    screen.getByRole("dialog", { name: "Complete Codex authorization" }),
  ).toBe(dialog);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.keyDown(dialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  const resume = screen.getByRole("button", {
    name: "Resume Codex authorization",
  }) as HTMLButtonElement;
  expect(resume.disabled).toBe(false);
  fireEvent.click(resume);
  await screen.findByRole("dialog", { name: "Complete Codex authorization" });
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).toHaveBeenCalledExactlyOnceWith(capability);
  expect(completeGatewayOAuth).not.toHaveBeenCalled();
  assertNoCapability();
  assertNoCallback();
});

// RED if callback ingress retains the DOM secret while awaiting, caches it,
// navigates to localhost, reflects a thrown diagnostic or automatically retries.
test("pending OAuth callback is cleared before ingress and lost ACK retains only safe readback", async () => {
  let rejectComplete!: (error: Error) => void;
  vi.mocked(completeGatewayOAuth).mockImplementationOnce(() => {
    assertNoCallback();
    return new Promise((_resolve, reject) => {
      rejectComplete = reject;
    });
  });
  await mount();
  await startEnrollment();
  await screen.findByText("Waiting for completion");
  const nonce = vi.mocked(beginGatewayOAuth).mock.calls[0]![1].nonce;
  const autoDialog = await screen.findByRole("dialog", {
    name: "Complete Codex authorization",
  });
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.keyDown(autoDialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", { name: "Resume Codex authorization" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Complete Codex authorization",
  });
  expect(within(dialog).getByText(/cannot return here/)).toBeTruthy();
  fireEvent.change(
    within(dialog).getByLabelText("Authorization result address"),
    {
      target: { value: callbackURL },
    },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Complete authorization" }),
  );
  await waitFor(() => expect(completeGatewayOAuth).toHaveBeenCalledTimes(1));
  expect(completeGatewayOAuth).toHaveBeenCalledWith(context, {
    nonce,
    callbackURL,
  });
  assertNoCallback();
  await act(async () => rejectComplete(new Error(callbackURL)));
  await screen.findByText("Status unavailable");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Resume Codex authorization" }),
  ).toBeNull();
  vi.mocked(readGatewayOperation).mockImplementation(
    async (_context, currentNonce) => safeOperation(currentNonce, "unknown"),
  );
  const readsBeforeStatus = vi.mocked(readGatewayOperation).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledTimes(readsBeforeStatus + 1),
  );
  expect(readGatewayOperation).toHaveBeenLastCalledWith(context, nonce);
  expect(
    screen.queryByRole("button", { name: "Resume Codex authorization" }),
  ).toBeNull();
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([nonce]);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).toHaveBeenCalledExactlyOnceWith(capability);
  expect(completeGatewayOAuth).toHaveBeenCalledTimes(1);
  assertNoCapability();
  assertNoCallback();
});

test("stale pending readback cannot rearm completion after a lost ACK", async () => {
  let releaseStatus!: (result: AccountsResult<AccountOperationView>) => void;
  let rejectComplete!: (error: Error) => void;
  vi.mocked(completeGatewayOAuth).mockImplementationOnce(() => {
    assertNoCallback();
    return new Promise((_resolve, reject) => {
      rejectComplete = reject;
    });
  });
  await mount();
  await startEnrollment();
  await screen.findByText("Waiting for completion");
  const nonce = vi.mocked(beginGatewayOAuth).mock.calls[0]![1].nonce;
  const autoDialog = await screen.findByRole("dialog");
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  fireEvent.keyDown(autoDialog, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  vi.mocked(readGatewayOperation).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        releaseStatus = resolve;
      }),
  );
  const readsBeforeStatus = vi.mocked(readGatewayOperation).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledTimes(readsBeforeStatus + 1),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Resume Codex authorization" }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(
    within(dialog).getByLabelText("Authorization result address"),
    {
      target: { value: callbackURL },
    },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Complete authorization" }),
  );
  await waitFor(() => expect(completeGatewayOAuth).toHaveBeenCalledTimes(1));
  expect(
    (
      within(dialog).getByRole("button", {
        name: "Complete authorization",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  assertNoCallback();
  await act(async () => rejectComplete(new Error(callbackURL)));
  await screen.findByText("Status unavailable");
  expect(screen.queryByRole("dialog")).toBeNull();
  await act(async () => releaseStatus(safeOperation(nonce, "pending")));
  // Completion cancels the older status request before publishing its unknown
  // acknowledgment. A late pending response cannot rearm or even replace it.
  expect(screen.getByText("Status unavailable")).toBeTruthy();
  expect(screen.queryByText("Waiting for completion")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "Resume Codex authorization" }),
  ).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(completeGatewayOAuth).toHaveBeenCalledTimes(1);
  assertNoCallback();
  assertNoCapability();
});

test("callback completion uses the saved nonce and stores only the safe acknowledgment", async () => {
  sessionStorage.setItem(storageKey, JSON.stringify([savedNonce]));
  vi.mocked(completeGatewayOAuth).mockImplementationOnce(
    async (_context, intent) => {
      assertNoCallback();
      return safeOperation(intent.nonce, "applied");
    },
  );
  await mount();
  await screen.findByText("Waiting for completion");
  fireEvent.click(
    screen.getByRole("button", { name: "Resume Codex authorization" }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.change(
    within(dialog).getByLabelText("Authorization result address"),
    {
      target: { value: callbackURL },
    },
  );
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Complete authorization" }),
  );
  await screen.findByText("Completed");
  expect(completeGatewayOAuth).toHaveBeenCalledExactlyOnceWith(context, {
    nonce: savedNonce,
    callbackURL,
  });
  expect(
    screen.queryByRole("button", { name: "Resume Codex authorization" }),
  ).toBeNull();
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(handoff).not.toHaveBeenCalled();
  expect(reserved.location.replace).not.toHaveBeenCalled();
  assertNoCallback();
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
  await screen.findByText("Status unavailable");
  expect(screen.queryByRole("dialog")).toBeNull();
  const nonce = vi.mocked(beginGatewayOAuth).mock.calls[0]![1].nonce;
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([nonce]);
  expect(handoff).toHaveBeenCalledWith("about:blank", "_blank");
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  vi.mocked(readGatewayOperation).mockImplementation(async (_context, nonce) =>
    safeOperation(nonce),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await screen.findByText("Waiting for completion");
  expect(readGatewayOperation).toHaveBeenCalledWith(context, nonce);
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  assertNoCapability();
});

test("blocked tab skips Begin and leaves no phantom operation nonce", async () => {
  handoff.mockReturnValueOnce(null);
  await mount();
  await startEnrollment();
  await screen.findByText(/Allow popups.*Nothing was submitted/);
  expect(handoff).toHaveBeenCalledWith("about:blank", "_blank");
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(storageWrites).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(screen.queryByText("Connection status")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(readGatewayOperation).not.toHaveBeenCalled();
  expect(reserved.location.replace).not.toHaveBeenCalled();
  assertNoCapability();
});

test("blank protection failure closes the tab before Begin or nonce reservation", async () => {
  vi.spyOn(reserved.document.head, "append").mockImplementationOnce(() => {
    throw new Error("synthetic document failure");
  });
  await mount();
  await startEnrollment();
  await screen.findByText(/Nothing was submitted/);
  expect(reserved.opener).toBeNull();
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(storageWrites).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(screen.queryByText("Connection status")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  assertNoCapability();
});

test("failed nonce persistence closes the reserved tab without Begin", async () => {
  await mount();
  storageWrites.mockImplementationOnce(() => {
    throw new Error("storage denied");
  });
  await startEnrollment();
  await screen.findByText(
    "Could not preserve connection status. Nothing was submitted.",
  );
  expect(handoff).toHaveBeenCalledWith("about:blank", "_blank");
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(storageKey)).toBeNull();
  expect(screen.queryByText("Connection status")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  assertNoCapability();
});

test("denied Begin closes the blank and dismisses its safe operation nonce", async () => {
  vi.mocked(beginGatewayOAuth).mockResolvedValueOnce({ status: "denied" });
  await mount();
  await startEnrollment();
  await screen.findByText(/workspace owner or admin/);
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([]);
  expect(screen.queryByText("Connection status")).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  assertNoCapability();
});

test("missing fresh URL closes the blank and retains pending readback without replay", async () => {
  vi.mocked(beginGatewayOAuth).mockImplementationOnce(
    async (_context, intent) => ({
      status: "ok",
      value: {
        operation: {
          nonce: intent.nonce,
          state: "pending",
          cleanup: "unresolved",
        },
      },
    }),
  );
  await mount();
  await startEnrollment();
  await screen.findByText("Waiting for completion");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  const nonce = vi.mocked(beginGatewayOAuth).mock.calls[0]![1].nonce;
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([nonce]);
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledWith(context, nonce),
  );
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).toBeNull();
  assertNoCapability();
});

test("failed fresh navigation closes the tab and retains unknown readback without retry", async () => {
  vi.mocked(reserved.location.replace).mockImplementationOnce(() => {
    throw new Error("synthetic navigation failure");
  });
  vi.mocked(readGatewayOperation).mockImplementation(async (_context, nonce) =>
    safeOperation(nonce, "unknown"),
  );
  await mount();
  await startEnrollment();
  await screen.findByText("Status unavailable");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(reserved.close).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).toHaveBeenCalledExactlyOnceWith(capability);
  const nonce = vi.mocked(beginGatewayOAuth).mock.calls[0]![1].nonce;
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual([nonce]);
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(readGatewayOperation).toHaveBeenCalledWith(context, nonce),
  );
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(handoff).toHaveBeenCalledTimes(1);
  expect(reserved.location.replace).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("dialog")).toBeNull();
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
  await screen.findByText("Waiting for completion");
  const oauthRow = screen
    .getByText("Workspace Codex")
    .closest("div.flex")! as HTMLElement;
  expect(
    within(oauthRow).queryByRole("button", { name: "Update API key" }),
  ).toBeNull();
  expect(
    screen.getAllByRole("button", { name: "Update API key" }),
  ).toHaveLength(1);
  const pendingBinding = within(oauthRow).getByRole("button", {
    name: "Add to this workspace",
  }) as HTMLButtonElement;
  expect(pendingBinding.disabled).toBe(true);
  fireEvent.click(pendingBinding);
  expect(bindGatewayAccount).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Connect with API key" }),
  );
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(
    within(dialog).getByRole("combobox", { name: /Provider profile/ }),
  );
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
          name: "Add to this workspace",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Add to this workspace" }),
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

// Existing OAuth handoff also reconnects the exact displayed account, without
// API-key ingress or retaining the fresh capability in metadata/cache/storage.
test("OAuth reconnect reuses the ordinary handoff and original account revisions", async () => {
  page.accounts = [row("active")];
  page.profiles.find((p) => p.id === oauthProfileId)!.canReconnect = true;
  await mount();
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh Codex sign-in" }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Refresh Codex sign-in · Workspace Codex",
  });
  expect(within(dialog).queryByLabelText("Connection name")).toBeNull();
  await chooseBrowser(dialog);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Sign in to Codex" }),
  );
  await waitFor(() => expect(beginGatewayOAuth).toHaveBeenCalledTimes(1));
  expect(vi.mocked(beginGatewayOAuth).mock.calls[0]).toEqual([
    context,
    {
      nonce: expect.any(String),
      connectionId: "codex-connection",
      gatewayRevision: 1,
      mirrorRevision: 1,
      method: "browser",
    },
  ]);
  await waitFor(() =>
    expect(reserved.location.replace).toHaveBeenCalledTimes(1),
  );
  await screen.findByRole("dialog", {
    name: "Complete Codex authorization",
  });
  expect(submitGatewayApiKey).not.toHaveBeenCalled();
  assertNoCapability();
});

vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));

// Regression boundary: Begin may run once only, the fresh code survives hiding
// the modal, and a successful operation must be able to retry a failed list read.
test("an expired device code stops being offered without starting another sign-in", async () => {
  const api = personalApi();
  api.beginGatewayOAuth.mockImplementation(async (_scope, intent) => ({
    status: "ok",
    value: {
      operation: {
        nonce: intent.nonce,
        state: "pending",
        oauthMethod: "device_code",
        cleanup: "unresolved",
      },
      deviceAuthorization: {
        userCode: "EXPI-RING",
        verificationURL: "https://auth.openai.com/codex/device",
        expiresAt: new Date(Date.now() + 500).toISOString(),
        intervalSeconds: 3,
      },
    },
  }));
  render(
    <AccountGatewayControls
      bootstrap={{ context, page: { status: "ok", value: page } }}
      api={api}
      connectOnly
    />,
  );
  fireEvent.click(
    await screen.findByRole("button", { name: "Sign in to Codex" }),
  );
  await screen.findByText("EXPI-RING");
  await screen.findByText(/This code has expired/, {}, { timeout: 3000 });
  expect(screen.queryByText("EXPI-RING")).toBeNull();
  expect(screen.queryByRole("link", { name: "Open OpenAI" })).toBeNull();
  expect(api.beginGatewayOAuth).toHaveBeenCalledTimes(1);
});

test("device sign-in stays in one dialog, polls through promotion and recovers unavailable account details without replay", async () => {
  const code = "ABCD-EFGH";
  const poll = vi
    .fn<NonNullable<AccountGatewayManagementApi["pollGatewayOAuth"]>>()
    .mockImplementation(async (_context, nonce) => {
      const account = { ...row("active"), label: "Device Codex" };
      vi.mocked(readGatewayOperation).mockResolvedValue({
        status: "ok",
        value: {
          nonce,
          state: "applied",
          oauthMethod: "device_code",
          account,
          cleanup: "unresolved",
        },
      });
      return {
        status: "ok",
        value: {
          nonce,
          state: "applied",
          oauthMethod: "device_code",
          account,
          cleanup: "unresolved",
        },
      };
    });
  vi.mocked(beginGatewayOAuth).mockImplementation(async (_context, intent) => {
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toContain(
      intent.nonce,
    );
    vi.mocked(listGatewayAccounts).mockResolvedValue({ status: "unavailable" });
    return {
      status: "ok",
      value: {
        operation: {
          nonce: intent.nonce,
          state: "pending",
          oauthMethod: "device_code",
          cleanup: "unresolved",
        },
        deviceAuthorization: {
          userCode: code,
          verificationURL: "https://auth.openai.com/codex/device",
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          intervalSeconds: 1,
        },
      },
    };
  });
  const api = {
    listGatewayAccounts,
    mutateGatewayAccount,
    submitGatewayApiKey,
    readGatewayOperation,
    beginGatewayOAuth,
    completeGatewayOAuth,
    pollGatewayOAuth: poll,
  };
  render(
    <AccountsAddDialog
      workspaceName="Test workspace"
      own={<p>My existing connections</p>}
      personalConnect={
        <AccountGatewayControls
          bootstrap={{ context, page: { status: "ok", value: page } }}
          api={api}
          connectOnly
        />
      }
      organizationConnect={<p>Organization account</p>}
    />,
  );
  expect(beginGatewayOAuth).not.toHaveBeenCalled();
  expect(poll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  let dialog = await screen.findByRole("dialog", { name: "Add account" });
  const start = within(dialog).getByRole("button", {
    name: "Sign in to Codex",
  });
  await waitFor(() =>
    expect((start as HTMLButtonElement).disabled).toBe(false),
  );
  expect(
    within(dialog).getByRole("combobox", { name: "Sign-in method" })
      .textContent,
  ).toContain("Device code");
  expect(
    within(dialog)
      .getByRole("link", { name: "ChatGPT Settings → Security" })
      .getAttribute("href"),
  ).toBe("https://chatgpt.com/settings/security");
  fireEvent.click(start);
  await within(dialog).findByText(code);
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(handoff).not.toHaveBeenCalled();
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(vi.mocked(beginGatewayOAuth).mock.calls[0]![1]).toMatchObject({
    method: "device_code",
  });
  expect(
    within(dialog).queryByText(/could not confirm this connection/),
  ).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Add account" }));
  dialog = await screen.findByRole("dialog", { name: "Add account" });
  expect(within(dialog).getByText(code)).toBeTruthy();
  await waitFor(() => expect(poll).toHaveBeenCalledTimes(1), { timeout: 5000 });
  await within(dialog).findByText("Completed");
  expect(within(dialog).queryByText(code)).toBeNull();
  expect(
    within(dialog).queryByRole("button", { name: "Check status" }),
  ).toBeNull();
  expect(within(dialog).getByText("Device Codex")).toBeTruthy();
  const retry = await within(dialog).findByRole("button", {
    name: "Refresh account details",
  });
  vi.mocked(listGatewayAccounts).mockResolvedValue({
    status: "ok",
    value: { ...page, accounts: [{ ...row("active"), label: "Device Codex" }] },
  });
  fireEvent.click(retry);
  await waitFor(() =>
    expect(
      within(dialog).queryByRole("button", { name: "Refresh account details" }),
    ).toBeNull(),
  );
  expect(beginGatewayOAuth).toHaveBeenCalledTimes(1);
  expect(completeGatewayOAuth).not.toHaveBeenCalled();
  const cache = [...clients].map(caches).join("\n");
  expect(cache).not.toContain(code);
  expect(cache).not.toContain("deviceAuthorization");
  expect(JSON.stringify(storageWrites.mock.calls)).not.toContain(code);
});

test("unavailable management refresh retains safe rows with disabled actions while denied clears them", async () => {
  page.accounts = [row("active")];
  await mount();
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  vi.mocked(listGatewayAccounts).mockResolvedValue({ status: "unavailable" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
  await screen.findByText(/Connection details could not be refreshed/);
  expect(screen.getByText("Workspace Codex")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Rename" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  vi.mocked(listGatewayAccounts).mockResolvedValue({ status: "denied" });
  fireEvent.click(screen.getByRole("button", { name: "Refresh connections" }));
  await waitFor(() => expect(screen.queryByText("Workspace Codex")).toBeNull());
});
