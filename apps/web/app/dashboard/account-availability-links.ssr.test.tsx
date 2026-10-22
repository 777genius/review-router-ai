// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import type {
  AccountView,
  AccountsResult,
  AccountsPage,
} from "../../src/server/account-gateway-accounts";
import { AccountGatewayControls } from "./account-gateway-account-controls";
import { WorkspacePersonalAccounts } from "./workspace-personal-accounts";

vi.mock("./account-gateway-account-actions", () => ({
  listGatewayAccounts: vi.fn(),
  mutateGatewayAccount: vi.fn(),
  submitGatewayApiKey: vi.fn(),
  readGatewayOperation: vi.fn(),
  beginGatewayOAuth: vi.fn(),
  completeGatewayOAuth: vi.fn(),
  pollGatewayOAuth: vi.fn(),
  bindGatewayAccount: vi.fn(),
  detachGatewayAccount: vi.fn(),
  changeGatewayOperatorGrant: vi.fn(),
}));
const context = vi.hoisted(() => ({ client: null as QueryClient | null }));
vi.mock("./gateway-model-account-options", () => ({
  useGatewayModelAccountsQueryClient: () => context.client,
  useCurrentGatewayModelAccountsCache: () => null,
}));
afterEach(() => {
  context.client?.clear();
  context.client = null;
});

// A server render has no browser URL to correct an omitted workspace. React
// hydration must receive the same target instead of keeping a default href.
test("workspace-owned and recipient Models links retain the selected nondefault workspace during SSR", () => {
  expect(typeof window).toBe("undefined");
  const workspaceId = "nondefault-workspace";
  const row: AccountView = {
    connectionId: "binding-handle",
    label: "Available account",
    profileId: "mimo",
    profileLabel: "MiMo",
    state: "active",
    readiness: "ready",
    gatewayRevision: 1,
    mirrorRevision: 2,
    binding: {
      id: "binding-handle",
      revision: 3,
      state: "active",
      fencePending: false,
    },
  };
  const page: AccountsResult<AccountsPage> = {
    status: "ok",
    value: { accounts: [row], profiles: [], nextCursor: null },
  };
  const owned = renderToStaticMarkup(
    <AccountGatewayControls
      bootstrap={{ context: "authorized-context", page }}
      workspaceId={workspaceId}
    />,
  );
  const expected =
    'href="/dashboard?section=policy&amp;workspace=nondefault-workspace#dashboard-section-content"';
  expect(owned).toContain(expected);
  expect(owned).toContain("Choose for reviews");
  const client = new QueryClient();
  context.client = client;
  client.setQueryData(["accounts-overview", "authorized-recipient"], {
    pages: [
      {
        status: "ok",
        value: {
          accounts: [{ ...row, origin: "personal" }],
          profiles: [],
          nextCursor: null,
        },
      },
    ],
    pageParams: [null],
  });
  const recipient = renderToStaticMarkup(
    <WorkspacePersonalAccounts
      scope="authorized-recipient"
      workspaceId={workspaceId}
      canDetach={false}
      api={{ list: vi.fn(), get: vi.fn() }}
      detach={vi.fn()}
    />,
  );
  expect(recipient).toContain(expected);
  expect(recipient).toContain("Choose in Models");
});

vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));
