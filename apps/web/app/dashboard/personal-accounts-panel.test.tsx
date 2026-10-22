// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type {
  AccountView,
  AccountsBootstrap,
} from "../../src/server/account-gateway-accounts";
import type {
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
} from "../../src/features/account-gateway/personal-accounts";
import { PersonalAccountsPanel } from "./personal-accounts-panel";
import type { AccountGatewayManagementApi } from "./account-gateway-account-controls";

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
afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

// A live management omission must never hide source-owner revocation; the
// canonical request must still carry its own two counters, never metadataRevision.
test("unions exact identities across independent pages and keeps sharing-only sources revocable", async () => {
  const source = (sourceId: string) => ({
    sourceId,
    label: sourceId,
    profileId: "mimo",
    state: "active" as const,
    metadataRevision: 77,
    sourceOperationPending: false,
  });
  const account = (connectionId: string): AccountView => ({
    connectionId,
    canManage: true,
    label: connectionId,
    profileId: "mimo",
    profileLabel: "MiMo",
    authKind: "api_key",
    state: "active",
    gatewayRevision: 12,
    mirrorRevision: 34,
    binding: null,
  });
  const profile = {
    id: "mimo",
    label: "MiMo",
    authKind: "api_key" as const,
    protocol: "openai-responses" as const,
    models: ["mimo"],
    canReconnect: true,
  };
  const bootstrap: PersonalAccountsBootstrap = {
    enabled: true,
    scope: "actor",
    page: {
      status: "ok",
      value: {
        sources: [source("available"), source("sharing-only")],
        nextCursor: "source-page-2",
      },
    },
  };
  const management: AccountsBootstrap = {
    context: "actor",
    page: {
      status: "ok",
      value: {
        accounts: [account("available")],
        profiles: [profile],
        nextCursor: "management-page-2",
      },
    },
  };
  const api: PersonalAccountsApi = {
    listAccessSummaries: vi
      .fn<PersonalAccountsApi["listAccessSummaries"]>()
      .mockResolvedValue({ status: "ok", value: { summaries: [] } }),
    listSources: vi.fn<PersonalAccountsApi["listSources"]>(async (request) =>
      request.afterSourceId
        ? {
            status: "ok",
            value: { sources: [source("source-page-2")], nextCursor: null },
          }
        : bootstrap.page,
    ),
    listOwnGrants: vi.fn<PersonalAccountsApi["listOwnGrants"]>(async () => ({
      status: "ok",
      value: {
        grants: [
          {
            bindingId: "former-binding",
            sourceId: "sharing-only",
            targetWorkspaceId: "hidden-org",
            organizationLabel: null,
            revision: 9,
            state: "active",
            remoteFenceDelivery: "not_required",
            canRevoke: true,
          },
        ],
        nextCursor: null,
      },
    })),
    listEligibleOrganizations: vi.fn<
      PersonalAccountsApi["listEligibleOrganizations"]
    >(async () => ({
      status: "ok",
      value: { organizations: [], nextCursor: null },
    })),
    attach: vi.fn<PersonalAccountsApi["attach"]>(async () => ({
      status: "unavailable",
    })),
    revoke: vi.fn<PersonalAccountsApi["revoke"]>(async () => ({
      status: "unavailable",
    })),
    readOperation: vi.fn<PersonalAccountsApi["readOperation"]>(async () => ({
      status: "unavailable",
    })),
  };
  const managementApi: AccountGatewayManagementApi = {
    listGatewayAccounts: vi.fn<
      AccountGatewayManagementApi["listGatewayAccounts"]
    >(async (_context, cursor) =>
      cursor
        ? {
            status: "ok",
            value: {
              accounts: [account("management-only")],
              profiles: [profile],
              nextCursor: null,
            },
          }
        : management.page,
    ),
    mutateGatewayAccount: vi.fn<
      AccountGatewayManagementApi["mutateGatewayAccount"]
    >(async (_context, intent) => ({
      status: "ok",
      value: { nonce: intent.nonce, state: "applied", cleanup: "unresolved" },
    })),
    submitGatewayApiKey: vi.fn<
      AccountGatewayManagementApi["submitGatewayApiKey"]
    >(async () => ({ status: "unavailable" })),
    readGatewayOperation: vi.fn<
      AccountGatewayManagementApi["readGatewayOperation"]
    >(async () => ({ status: "unavailable" })),
    beginGatewayOAuth: vi.fn<AccountGatewayManagementApi["beginGatewayOAuth"]>(
      async () => ({ status: "unavailable" }),
    ),
    completeGatewayOAuth: vi.fn<
      AccountGatewayManagementApi["completeGatewayOAuth"]
    >(async () => ({ status: "unavailable" })),
  };
  render(
    <PersonalAccountsPanel
      bootstrap={bootstrap}
      api={api}
      management={management}
      managementApi={managementApi}
    />,
  );
  expect(screen.getAllByRole("article", { name: "available" })).toHaveLength(1);
  expect(
    within(screen.getByRole("article", { name: "sharing-only" })).getByText(
      "Connection details unavailable",
    ),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "Load more connection details" }),
  );
  await screen.findByRole("article", { name: "management-only" });
  fireEvent.click(
    screen.getByRole("button", { name: "Load more personal accounts" }),
  );
  await screen.findByRole("article", { name: "source-page-2" });
  expect(screen.getAllByRole("article")).toHaveLength(4);
  expect(managementApi.listGatewayAccounts).toHaveBeenCalledWith(
    "actor",
    "management-page-2",
  );
  expect(api.listSources).toHaveBeenCalledWith({
    afterSourceId: "source-page-2",
    limit: 25,
  });
  fireEvent.keyDown(screen.getByLabelText("Actions for available"), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
  const rename = await screen.findByRole("dialog", {
    name: "Rename · available",
  });
  fireEvent.change(within(rename).getByLabelText("Connection name"), {
    target: { value: "Renamed" },
  });
  fireEvent.click(within(rename).getByRole("button", { name: "Confirm" }));
  await waitFor(() =>
    expect(managementApi.mutateGatewayAccount).toHaveBeenCalledWith("actor", {
      nonce: expect.any(String),
      kind: "rename",
      connectionId: "available",
      gatewayRevision: 12,
      mirrorRevision: 34,
      label: "Renamed",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Access: sharing-only" }));
  await screen.findByText("Workspace unavailable");
  fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
  await waitFor(() =>
    expect(api.revoke).toHaveBeenCalledWith({
      nonce: expect.any(String),
      sourceId: "sharing-only",
      targetWorkspaceId: "hidden-org",
      expectedSourceMetadataRevision: 77,
      bindingId: "former-binding",
      expectedBindingRevision: 9,
    }),
  );
});

vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));
