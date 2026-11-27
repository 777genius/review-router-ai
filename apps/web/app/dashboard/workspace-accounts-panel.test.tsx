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
import { afterEach, expect, test, vi } from "vitest";
import type {
  AccountsPage,
  AccountsResult,
  AccountView,
} from "../../src/server/account-gateway-accounts";
import { listGatewayAccounts } from "./account-gateway-account-actions";
import {
  GatewayModelAccountsProvider,
  type GatewayModelAccountsApi,
} from "./gateway-model-account-options";
import { WorkspaceAccountsPanel } from "./workspace-accounts-panel";

// Only the server-action boundaries are mocked; the shared page QueryClient,
// the engine and the overview rows are the real components.
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./account-gateway-account-actions", () => ({
  beginGatewayNativeConnection: vi.fn(),
  continueGatewayNativeConnection: vi.fn(),
  beginGatewayOAuth: vi.fn(),
  completeGatewayOAuth: vi.fn(),
  pollGatewayOAuth: vi.fn(),
  bindGatewayAccount: vi.fn(),
  detachGatewayAccount: vi.fn(),
  listGatewayAccounts: vi.fn(),
  readGatewayOperation: vi.fn(),
  submitGatewayApiKey: vi.fn(),
  mutateGatewayAccount: vi.fn(),
}));
vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const bound = {
  id: "binding-org",
  revision: 4,
  state: "active" as const,
  fencePending: false,
};
const orgRow = (binding: AccountView["binding"]): AccountView => ({
  connectionId: "connection-org",
  label: "Org MiMo",
  origin: "organization",
  canManage: true,
  owner: { kind: "organization", label: "Acme", avatarUrl: null },
  profileId: "mimo",
  profileLabel: "MiMo",
  authKind: "api_key",
  state: "active",
  readiness: "ready",
  allowedActions: binding ? ["detach"] : [],
  gatewayRevision: 3,
  mirrorRevision: 2,
  binding,
});
const page = (row: AccountView): AccountsResult<AccountsPage> => ({
  status: "ok",
  value: {
    accounts: [row],
    profiles: [
      {
        id: "mimo",
        label: "MiMo",
        authKind: "api_key",
        canReconnect: true,
        protocol: "openai-responses",
        models: [],
      },
    ],
    nextCursor: null,
  },
});

test("an organization connection offers one confirmed removal and can be added back right after it", async () => {
  vi.mocked(listGatewayAccounts).mockResolvedValue(page(orgRow(null)));
  // The overview reread is slow: the row must stay in place meanwhile.
  let finishReread!: (result: AccountsResult<AccountsPage>) => void;
  const overview: GatewayModelAccountsApi = {
    list: vi.fn<GatewayModelAccountsApi["list"]>(
      () =>
        new Promise((resolve) => {
          finishReread = resolve;
        }),
    ),
    get: vi.fn<GatewayModelAccountsApi["get"]>(),
  };
  const detach = vi.fn().mockResolvedValue({
    status: "ok",
    value: {
      bindingId: bound.id,
      workspaceId: "workspace-x",
      revision: 5,
      state: "revoked",
      localAuthorization: "local_denied",
      remoteFenceDelivery: "remote_applied",
    },
  });
  render(
    <GatewayModelAccountsProvider
      scope="viewer:workspace:workspace-x"
      api={overview}
    >
      <WorkspaceAccountsPanel
        bootstrap={{
          context: "workspace-user.signature",
          page: page(orgRow(bound)),
        }}
        scope="viewer:workspace:workspace-x"
        personalScope="viewer"
        workspaceId="workspace-x"
        canDetach
        api={overview}
        initialPage={page(orgRow(bound))}
        detach={detach}
        readDetach={vi.fn()}
      />
    </GatewayModelAccountsProvider>,
  );
  const trigger = await screen.findByLabelText("Actions for Org MiMo");
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  expect(
    screen.getAllByRole("menuitem", { name: "Remove from this workspace" }),
  ).toHaveLength(1);
  expect(screen.queryByRole("button", { name: "Access" })).toBeNull();
  fireEvent.click(
    screen.getByRole("menuitem", { name: "Remove from this workspace" }),
  );
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/stays in this list/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(detach).toHaveBeenCalledTimes(1));
  expect(detach).toHaveBeenCalledWith({
    bindingId: bound.id,
    expectedBindingRevision: bound.revision,
  });
  // While the overview rereads, the row stays, says it is not added here, and
  // focus is back on its menu.
  await waitFor(() => expect(overview.list).toHaveBeenCalled());
  const row = screen.getByRole("article", { name: "Org MiMo" });
  expect(within(row).getByText("Not added to this workspace")).toBeTruthy();
  await waitFor(() =>
    expect(document.activeElement).toBe(
      screen.getByLabelText("Actions for Org MiMo"),
    ),
  );
  await act(async () => finishReread(page(orgRow(null))));
  // The removal rereads the engine's management page in the shared client, so
  // the row's own menu offers adding it back without a page reload.
  await waitFor(() => expect(listGatewayAccounts).toHaveBeenCalled());
  fireEvent.keyDown(screen.getByLabelText("Actions for Org MiMo"), {
    key: "ArrowDown",
  });
  const add = await screen.findByRole("menuitem", {
    name: "Add to this workspace",
  });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  expect(
    screen.queryByRole("menuitem", { name: "Remove from this workspace" }),
  ).toBeNull();
});
