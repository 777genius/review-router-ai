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
import { QueryClient, focusManager } from "@tanstack/react-query";
import type {
  PersonalAccountsApi,
  PersonalAccountsBootstrap,
  PersonalMutationReceipt,
  PersonalSource,
} from "../../src/features/account-gateway/personal-accounts";
import { PersonalAccountControls } from "./personal-account-controls";

const clients = new Set<QueryClient>();
afterEach(() => {
  cleanup();
  for (const client of clients) client.clear();
  clients.clear();
  sessionStorage.clear();
});
const source = (id: string): PersonalSource => ({
  sourceId: id,
  label: `Personal ${id}`,
  profileId: "mimo",
  state: "active",
  metadataRevision: 7,
  sourceOperationPending: false,
});
function fixture() {
  const sources = Array.from({ length: 25 }, (_, index) =>
    source(`source-${index}`),
  );
  const bootstrap: PersonalAccountsBootstrap = {
    enabled: true,
    scope: "user-personal",
    page: { status: "ok", value: { sources, nextCursor: "source-24" } },
  };
  const receipt = (nonce: string): PersonalMutationReceipt => ({
    operation: {
      operationId: nonce,
      phase: "applied",
      sourceId: "source-0",
      bindingId: "binding-new",
      available: true,
      state: "active",
    },
  });
  const api = {
    listAccessSummaries: vi
      .fn<PersonalAccountsApi["listAccessSummaries"]>()
      .mockResolvedValue({ status: "ok", value: { summaries: [] } }),
    listSources: vi.fn<PersonalAccountsApi["listSources"]>().mockResolvedValue({
      status: "ok",
      value: { sources: [source("offpage")], nextCursor: null },
    }),
    listOwnGrants: vi
      .fn<PersonalAccountsApi["listOwnGrants"]>()
      .mockResolvedValue({
        status: "ok",
        value: {
          grants: [
            {
              sourceId: "source-0",
              bindingId: "original-binding",
              targetWorkspaceId: "opaque-former-org",
              organizationLabel: null,
              revision: 9,
              state: "active",
              remoteFenceDelivery: "remote_applied",
              canRevoke: true,
            },
          ],
          nextCursor: null,
        },
      }),
    listEligibleOrganizations: vi
      .fn<PersonalAccountsApi["listEligibleOrganizations"]>()
      .mockResolvedValue({
        status: "ok",
        value: {
          organizations: [
            {
              workspaceId: "org-x",
              label: "Organization X",
              predecessors: [
                {
                  sourceId: "source-0",
                  bindingId: "retired-binding",
                  revision: 4,
                },
              ],
            },
            { workspaceId: "org-y", label: "Organization Y" },
          ],
          nextCursor: null,
        },
      }),
    attach: vi
      .fn<PersonalAccountsApi["attach"]>()
      .mockImplementation(async (request) => ({
        status: "ok",
        value: receipt(request.nonce),
      })),
    revoke: vi
      .fn<PersonalAccountsApi["revoke"]>()
      .mockImplementation(async (request) => ({
        status: "ok",
        value: {
          ...receipt(request.nonce),
          operation: {
            ...receipt(request.nonce).operation,
            bindingId: request.bindingId,
            available: false,
            state: "revoked",
          },
          remoteFenceDelivery: "remote_pending",
        },
      })),
    readOperation: vi
      .fn<PersonalAccountsApi["readOperation"]>()
      .mockImplementation(async (nonce) => ({
        status: "ok",
        value: receipt(nonce),
      })),
  };
  return { bootstrap, api };
}

async function openBulk() {
  fireEvent.click(screen.getByText("Share multiple connections"));
  await screen.findByRole("button", { name: "Share selected accounts" });
}

test("public personal controls are inert unless explicitly enabled with an adapter", () => {
  const { bootstrap, api } = fixture();
  render(
    <PersonalAccountControls
      bootstrap={{ ...bootstrap, enabled: false }}
      api={api}
    />,
  );
  expect(document.body.textContent).not.toContain("Share with organizations");
  expect(api.listSources).not.toHaveBeenCalled();
  expect(api.listEligibleOrganizations).not.toHaveBeenCalled();
});

test("selects accounts across pages and shares independently with exact predecessor tuples", async () => {
  const { bootstrap, api } = fixture();
  render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
  await openBulk();
  fireEvent.click(screen.getByLabelText("Select Personal source-0"));
  fireEvent.click(
    screen.getByRole("button", { name: "Load more personal accounts" }),
  );
  fireEvent.click(await screen.findByLabelText("Select Personal offpage"));
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  fireEvent.click(await screen.findByLabelText("Organization X"));
  fireEvent.click(screen.getByLabelText("Organization Y"));
  fireEvent.click(screen.getByRole("button", { name: "Share 4 connections" }));
  await waitFor(() => expect(api.attach).toHaveBeenCalledTimes(4));
  const requests = api.attach.mock.calls.map(([request]) => request);
  expect(new Set(requests.map((request) => request.nonce)).size).toBe(4);
  expect(requests[0]).toEqual({
    nonce: expect.any(String),
    sourceId: "source-0",
    targetWorkspaceId: "org-x",
    expectedSourceMetadataRevision: 7,
    predecessorBindingId: "retired-binding",
    expectedPredecessorRevision: 4,
  });
  expect(requests[1]).toMatchObject({
    sourceId: "source-0",
    targetWorkspaceId: "org-y",
    predecessorBindingId: null,
    expectedPredecessorRevision: null,
  });
  expect(api.listSources).toHaveBeenCalledWith({
    afterSourceId: "source-24",
    limit: 25,
  });
  for (const request of requests)
    expect(request).not.toHaveProperty("expectedGatewayRevision");
});

test.each([
  { organizationCount: 5, hasRestrictedAccess: false, expected: "Access" },
  { organizationCount: 4, hasRestrictedAccess: true, expected: "Access" },
  {
    organizationCount: 4,
    hasRestrictedAccess: false,
    expected: "Add to workspace",
  },
])(
  "workspace shortcut label requires a complete visible summary ($organizationCount/$hasRestrictedAccess)",
  async ({ organizationCount, hasRestrictedAccess, expected }) => {
    const { bootstrap, api } = fixture();
    api.listAccessSummaries.mockResolvedValue({
      status: "ok",
      value: {
        summaries: [
          {
            sourceId: "source-0",
            organizationCount,
            hasRestrictedAccess,
            organizations: Array.from({ length: 4 }, (_, i) => ({
              workspaceId: `visible-org-${i}`,
              label: `Visible organization ${i}`,
            })),
            personalWorkspaceId: "personal-owner",
            complete: true,
          },
        ],
      },
    });
    render(
      <PersonalAccountControls
        bootstrap={bootstrap}
        api={api}
        currentWorkspaceId="selected-not-in-preview"
      />,
    );
    await screen.findByText("Visible organization 0");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `${expected}: Personal source-0` }),
      ).toBeTruthy(),
    );
    expect(api.attach).not.toHaveBeenCalled();
  },
);

test.each([null, "Organization X"])(
  "revokes the exact own grant and labels its request only with the authorized organization name (%s)",
  async (organizationLabel) => {
    const { bootstrap, api } = fixture();
    api.listSources.mockResolvedValue(bootstrap.page);
    const originalGrants = await api.listOwnGrants({
      sourceId: "source-0",
      limit: 25,
    });
    if (originalGrants.status !== "ok") throw new Error("fixture unavailable");
    api.listOwnGrants.mockResolvedValue({
      status: "ok",
      value: {
        ...originalGrants.value,
        grants: originalGrants.value.grants.map((grant) => ({
          ...grant,
          organizationLabel,
        })),
      },
    });
    render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "Access: Personal source-0",
      }),
    );
    expect(
      await screen.findAllByText(organizationLabel ?? "Workspace unavailable"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("opaque-former-org");
    if (organizationLabel === null)
      expect(
        screen.getByText("Workspace unavailable").parentElement?.textContent,
      ).not.toContain("Organization X");
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    await waitFor(() => expect(api.revoke).toHaveBeenCalledTimes(1));
    expect(api.revoke.mock.calls[0]?.[0]).toEqual({
      nonce: expect.any(String),
      sourceId: "source-0",
      targetWorkspaceId: "opaque-former-org",
      expectedSourceMetadataRevision: 7,
      bindingId: "original-binding",
      expectedBindingRevision: 9,
    });
    expect(
      await screen.findAllByText(/gateway confirmation pending/),
    ).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      await screen.findByText(
        `Personal source-0 · ${organizationLabel ?? "Workspace unavailable"}`,
      ),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("opaque-former-org");
  },
);

test("revocation invalidates cached eligible selections in its scope before reusing the acknowledged predecessor", async () => {
  const { bootstrap, api } = fixture();
  const client = new QueryClient();
  clients.add(client);
  const otherScope = [
    "personal-accounts",
    "other-user",
    "organizations",
    "source-0",
  ] as const;
  const operationKey = [
    "personal-accounts",
    bootstrap.scope,
    "operation",
    "unrelated-operation",
  ] as const;
  client.setQueryData(otherScope, { retained: true });
  client.setQueryData(operationKey, { retained: true });
  api.listSources.mockResolvedValue(bootstrap.page);
  let revoked = false;
  let releaseRefetch!: () => void;
  const refetch = new Promise<void>((resolve) => {
    releaseRefetch = resolve;
  });
  api.listEligibleOrganizations.mockImplementation(async () => {
    if (revoked) await refetch;
    return {
      status: "ok",
      value: {
        organizations: [
          {
            workspaceId: "org-x",
            label: "Organization X",
            predecessors: [
              {
                sourceId: "source-0",
                bindingId: revoked ? "original-binding" : "retired-binding",
                revision: revoked ? 10 : 4,
              },
            ],
          },
        ],
        nextCursor: null,
      },
    };
  });
  api.revoke.mockImplementation(async (request) => {
    revoked = true;
    return {
      status: "ok",
      value: {
        operation: {
          operationId: request.nonce,
          phase: "applied",
          sourceId: request.sourceId,
          bindingId: request.bindingId,
          available: false,
          state: "revoked",
        },
        remoteFenceDelivery: "remote_applied",
      },
    };
  });
  render(
    <PersonalAccountControls
      bootstrap={bootstrap}
      api={api}
      queryClient={client}
    />,
  );
  await openBulk();
  fireEvent.click(screen.getByLabelText("Select Personal source-0"));
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  await screen.findByLabelText("Organization X");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", {
      name: "Access: Personal source-0",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Remove access" }));
  await waitFor(() => expect(api.revoke).toHaveBeenCalledTimes(1));
  const eligibleKey = [
    "personal-accounts",
    bootstrap.scope,
    "organizations",
    "source-0",
  ] as const;
  await waitFor(() =>
    expect(client.getQueryState(eligibleKey)?.isInvalidated).toBe(true),
  );
  expect(client.getQueryState(otherScope)?.isInvalidated).toBe(false);
  expect(client.getQueryState(operationKey)?.isInvalidated).toBe(false);
  await act(async () => releaseRefetch());
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Share selected accounts",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  await waitFor(() =>
    expect(
      api.listEligibleOrganizations.mock.calls.length,
    ).toBeGreaterThanOrEqual(2),
  );
  await waitFor(() =>
    expect(client.getQueryState(eligibleKey)?.isInvalidated).toBe(false),
  );
  fireEvent.click(await screen.findByLabelText("Organization X"));
  fireEvent.click(screen.getByRole("button", { name: "Share 1 connection" }));
  await waitFor(() => expect(api.attach).toHaveBeenCalledTimes(1));
  expect(api.attach.mock.calls[0]?.[0]).toMatchObject({
    sourceId: "source-0",
    targetWorkspaceId: "org-x",
    predecessorBindingId: "original-binding",
    expectedPredecessorRevision: 10,
  });
});

test("an uncertain attach preserves one nonce and checks status without repeating the mutation", async () => {
  const { bootstrap, api } = fixture();
  api.listSources.mockResolvedValue(bootstrap.page);
  api.attach.mockRejectedValue(new Error("private transport diagnostic"));
  api.readOperation.mockResolvedValue({ status: "unavailable" });
  const view = render(
    <PersonalAccountControls bootstrap={bootstrap} api={api} />,
  );
  await openBulk();
  fireEvent.click(screen.getByLabelText("Select Personal source-0"));
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  fireEvent.click(await screen.findByLabelText("Organization Y"));
  fireEvent.click(screen.getByRole("button", { name: "Share 1 connection" }));
  await waitFor(() => expect(api.attach).toHaveBeenCalledTimes(1));
  expect(
    await screen.findByText("Personal source-0 · Organization Y"),
  ).toBeTruthy();
  const nonce = api.attach.mock.calls[0]![0].nonce;
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Check status" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() => expect(api.readOperation).toHaveBeenCalledWith(nonce));
  expect(api.attach).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(
      sessionStorage.getItem("rr-personal-account-operations:user-personal")!,
    ),
  ).toEqual([nonce]);
  expect(document.body.textContent).not.toContain(
    "private transport diagnostic",
  );
  expect(
    sessionStorage.getItem("rr-personal-account-operations:user-personal"),
  ).not.toContain("Organization Y");
  const originalURL = window.location.href;
  try {
    window.history.replaceState(null, "", "?workspace=another-workspace");
    view.rerender(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
    await waitFor(() =>
      expect(
        screen.queryByText("Personal source-0 · Organization Y"),
      ).toBeNull(),
    );
    expect(api.attach).toHaveBeenCalledTimes(1);
  } finally {
    window.history.replaceState(null, "", originalURL);
  }
});

test("a delayed pre-mutation readback cannot overwrite a newer applied receipt", async () => {
  const { bootstrap, api } = fixture();
  let finishRead!: (
    value: Awaited<ReturnType<PersonalAccountsApi["readOperation"]>>,
  ) => void;
  let finishAttach!: (
    value: Awaited<ReturnType<PersonalAccountsApi["attach"]>>,
  ) => void;
  api.readOperation.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRead = resolve;
      }),
  );
  api.attach.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishAttach = resolve;
      }),
  );
  render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
  await openBulk();
  fireEvent.click(screen.getByLabelText("Select Personal source-0"));
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  fireEvent.click(await screen.findByLabelText("Organization Y"));
  fireEvent.click(screen.getByRole("button", { name: "Share 1 connection" }));
  await waitFor(() => expect(api.readOperation).toHaveBeenCalledTimes(1));
  const nonce = api.attach.mock.calls[0]![0].nonce;
  const operation = {
    operationId: nonce,
    phase: "applied",
    sourceId: "source-0",
    bindingId: "binding-new",
    available: true,
    state: "active",
  };
  await act(async () => {
    finishAttach({ status: "ok", value: { operation } });
  });
  expect(
    await screen.findByRole("button", { name: "Hide result" }),
  ).toBeTruthy();
  await act(async () => {
    finishRead({
      status: "ok",
      value: {
        operation: {
          ...operation,
          phase: "submitted",
          available: false,
          bindingId: null,
          state: "pending",
        },
      },
    });
  });
  expect(screen.getByRole("button", { name: "Hide result" })).toBeTruthy();
  expect(document.body.textContent).not.toContain(
    "Request recorded; completion is not confirmed",
  );
  expect(api.attach).toHaveBeenCalledTimes(1);
});

test("direct access keeps historical lifetimes separate and never substitutes an eligible name for a hidden grant", async () => {
  const { bootstrap, api } = fixture();
  api.listSources.mockResolvedValue(bootstrap.page);
  api.listOwnGrants.mockResolvedValue({
    status: "ok",
    value: {
      grants: [
        {
          sourceId: "source-0",
          bindingId: "previous",
          targetWorkspaceId: "org-x",
          organizationLabel: null,
          revision: 10,
          state: "revoked",
          remoteFenceDelivery: "remote_applied",
          canRevoke: false,
        },
        {
          sourceId: "source-0",
          bindingId: "replacement",
          targetWorkspaceId: "org-x",
          organizationLabel: null,
          revision: 2,
          state: "active",
          remoteFenceDelivery: "not_required",
          canRevoke: true,
        },
      ],
      nextCursor: null,
    },
  });
  render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Access: Personal source-0",
    }),
  );
  const dialog = await screen.findByRole("dialog", {
    name: "Access · Personal source-0",
  });
  await screen.findByText("Previous access revoked");
  expect(within(dialog).getAllByText("Workspace unavailable")).toHaveLength(2);
  expect(within(dialog).queryByText("Organization X")).toBeNull();
  expect(
    within(dialog).getAllByRole("button", { name: "Remove access" }),
  ).toHaveLength(1);
  fireEvent.click(
    within(dialog).getByRole("button", { name: "Remove access" }),
  );
  await waitFor(() =>
    expect(api.revoke).toHaveBeenCalledWith(
      expect.objectContaining({
        bindingId: "replacement",
        expectedBindingRevision: 2,
      }),
    ),
  );
});

test("closing, remounting and reopening direct workspace access preserves uncertain original readback without a second attach", async () => {
  const { bootstrap, api } = fixture();
  api.listSources.mockResolvedValue(bootstrap.page);
  api.attach.mockRejectedValue(new Error("uncertain transport"));
  api.readOperation.mockResolvedValue({ status: "unavailable" });
  const view = render(
    <PersonalAccountControls bootstrap={bootstrap} api={api} />,
  );
  let trigger = screen.getByRole("button", {
    name: "Access: Personal source-0",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const add = await screen.findByRole("button", {
    name: "Add access to Organization Y",
  });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(add);
  await waitFor(() => expect(api.attach).toHaveBeenCalledTimes(1));
  const original = api.attach.mock.calls[0]![0];
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(trigger));
  view.unmount();
  // Reauthorization can fail after the original request entered. This denied
  // read must not release its identity, even when eligible targets return.
  api.readOperation.mockResolvedValue({ status: "denied" });
  render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
  trigger = screen.getByRole("button", {
    name: "Access: Personal source-0",
  });
  await waitFor(() =>
    expect(api.readOperation).toHaveBeenCalledWith(original.nonce),
  );
  fireEvent.click(trigger);
  const reopened = await screen.findByRole("dialog", {
    name: "Access · Personal source-0",
  });
  fireEvent.click(
    within(reopened).getByRole("button", { name: "Refresh access" }),
  );
  await waitFor(() =>
    expect(api.listEligibleOrganizations.mock.calls.length).toBeGreaterThan(1),
  );
  expect(
    (
      within(reopened).getByRole("button", {
        name: "Add access to Organization Y",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fireEvent.keyDown(reopened, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "Check status" }));
  await waitFor(() =>
    expect(api.readOperation).toHaveBeenCalledWith(original.nonce),
  );
  expect(api.attach).toHaveBeenCalledTimes(1);
  expect(
    JSON.parse(
      sessionStorage.getItem("rr-personal-account-operations:user-personal")!,
    ),
  ).toEqual([original.nonce]);
});

// Re-reading a terminal operation must not repeatedly cancel and refetch the
// other account views. The first pending -> applied read must still refresh.
test("refreshes related views once when a saved nonce becomes terminal, across repeated reads and focus", async () => {
  const { bootstrap, api } = fixture();
  const nonce = "9874b2bc-e987-4456-9212-7f94f58932da";
  sessionStorage.setItem(
    "rr-personal-account-operations:user-personal",
    JSON.stringify([nonce]),
  );
  api.listSources.mockResolvedValue(bootstrap.page);
  const terminal: PersonalMutationReceipt = {
    operation: {
      operationId: nonce,
      phase: "applied",
      sourceId: "source-0",
      bindingId: "binding-new",
      available: true,
      state: "active",
    },
  };
  api.readOperation.mockResolvedValue({
    status: "ok",
    value: {
      operation: {
        ...terminal.operation,
        phase: "submitted",
        bindingId: null,
        available: false,
        state: "pending",
      },
    },
  });
  const client = new QueryClient();
  clients.add(client);
  const invalidation = vi.spyOn(client, "invalidateQueries");
  render(
    <PersonalAccountControls
      bootstrap={bootstrap}
      api={api}
      queryClient={client}
    />,
  );
  await waitFor(() => expect(api.readOperation).toHaveBeenCalledTimes(1));
  expect(api.listSources).not.toHaveBeenCalled();
  const check = () =>
    screen.getByRole("button", { name: "Check status" }) as HTMLButtonElement;
  await waitFor(() => expect(check().disabled).toBe(false));
  api.readOperation.mockResolvedValue({ status: "ok", value: terminal });
  fireEvent.click(check());
  await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(check().disabled).toBe(false));
  fireEvent.click(check());
  await waitFor(() => expect(api.readOperation).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(check().disabled).toBe(false));
  try {
    await act(async () => {
      focusManager.setFocused(false);
      await client.invalidateQueries({
        queryKey: ["personal-accounts", bootstrap.scope, "operation", nonce],
        exact: true,
        refetchType: "none",
      });
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(api.readOperation).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(check().disabled).toBe(false));
    expect(api.listSources).toHaveBeenCalledTimes(1);
    expect(
      invalidation.mock.calls.filter(
        ([filters]) => filters?.queryKey?.[2] === "sources",
      ),
    ).toHaveLength(1);
    expect(api.attach).not.toHaveBeenCalled();
    expect(api.revoke).not.toHaveBeenCalled();
  } finally {
    focusManager.setFocused(undefined);
  }
});

test("serializes saved terminal nonce refreshes and refreshes again for a receipt arriving during reads", async () => {
  const { bootstrap, api } = fixture();
  const nonces = [
    "9874b2bc-e987-4456-9212-7f94f58932da",
    "198a9f4b-70a8-4e31-9637-5a0e5d420728",
  ];
  sessionStorage.setItem(
    "rr-personal-account-operations:user-personal",
    JSON.stringify(nonces),
  );
  type OperationResult = Awaited<
    ReturnType<PersonalAccountsApi["readOperation"]>
  >;
  type SourcesResult = Awaited<ReturnType<PersonalAccountsApi["listSources"]>>;
  let finishSecondRead!: (result: OperationResult) => void;
  let finishFirstRefresh!: (result: SourcesResult) => void;
  const secondRead = new Promise<OperationResult>((resolve) => {
    finishSecondRead = resolve;
  });
  const firstRefresh = new Promise<SourcesResult>((resolve) => {
    finishFirstRefresh = resolve;
  });
  const receipt = (nonce: string): OperationResult => ({
    status: "ok",
    value: {
      operation: {
        operationId: nonce,
        phase: "applied",
        sourceId: "source-0",
        bindingId: "binding-new",
        available: true,
        state: "active",
      },
    },
  });
  api.readOperation.mockImplementation((nonce) =>
    nonce === nonces[0] ? Promise.resolve(receipt(nonce)) : secondRead,
  );
  api.listSources.mockImplementationOnce(() => firstRefresh);
  api.listSources.mockResolvedValue({
    status: "ok",
    value: {
      sources: [{ ...source("source-0"), label: "After second receipt" }],
      nextCursor: null,
    },
  });
  const client = new QueryClient();
  clients.add(client);
  const cancellation = vi.spyOn(client, "cancelQueries");
  render(
    <PersonalAccountControls
      bootstrap={bootstrap}
      api={api}
      queryClient={client}
    />,
  );
  await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(1));
  await act(async () => finishSecondRead(receipt(nonces[1]!)));
  await waitFor(() =>
    expect(screen.getAllByRole("button", { name: "Hide result" })).toHaveLength(
      2,
    ),
  );
  expect(api.listSources).toHaveBeenCalledTimes(1);
  expect(
    cancellation.mock.calls.filter(
      ([filters]) => filters?.queryKey?.[2] === "sources",
    ),
  ).toHaveLength(1);
  await act(async () =>
    finishFirstRefresh({
      status: "ok",
      value: {
        sources: [{ ...source("source-0"), label: "Before second receipt" }],
        nextCursor: null,
      },
    }),
  );
  await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(2));
  await screen.findByRole("button", {
    name: "Access: After second receipt",
  });
  expect(api.attach).not.toHaveBeenCalled();
  expect(api.revoke).not.toHaveBeenCalled();
});

test("drains a saved terminal receipt arriving during mutation refresh before releasing the mutation latch", async () => {
  const { bootstrap, api } = fixture();
  const nonce = "9874b2bc-e987-4456-9212-7f94f58932da";
  const storageKey = "rr-personal-account-operations:user-personal";
  sessionStorage.setItem(storageKey, JSON.stringify([nonce]));
  sessionStorage.setItem(
    `${storageKey}:pairs`,
    JSON.stringify({
      [nonce]: {
        kind: "attach",
        sourceId: "source-0",
        workspaceId: "org-x",
      },
    }),
  );
  const receipt = (
    operationId: string,
    sourceId: string,
    available: boolean,
  ): PersonalMutationReceipt => ({
    operation: {
      operationId,
      sourceId,
      phase: available ? "applied" : "submitted",
      bindingId: available ? `binding-${sourceId}` : null,
      available,
      state: available ? "active" : "pending",
    },
  });
  api.readOperation.mockResolvedValue({
    status: "ok",
    value: receipt(nonce, "source-0", false),
  });
  api.attach.mockImplementation(async (request) => ({
    status: "ok",
    value: receipt(request.nonce, request.sourceId, true),
  }));
  type SourcesResult = Awaited<ReturnType<PersonalAccountsApi["listSources"]>>;
  let finishMutationRefresh!: (result: SourcesResult) => void;
  let finishTail!: (result: SourcesResult) => void;
  api.listSources
    .mockImplementationOnce(
      () =>
        new Promise<SourcesResult>((resolve) => {
          finishMutationRefresh = resolve;
        }),
    )
    .mockImplementationOnce(
      () =>
        new Promise<SourcesResult>((resolve) => {
          finishTail = resolve;
        }),
    );
  const client = new QueryClient();
  clients.add(client);
  render(
    <PersonalAccountControls
      bootstrap={bootstrap}
      api={api}
      queryClient={client}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("button", {
          name: "Check status",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false),
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: "Access: Personal source-1",
    }),
  );
  const add = await screen.findByRole("button", {
    name: "Add access to Organization Y",
  });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(add);
  await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(1));
  api.readOperation.mockResolvedValue({
    status: "ok",
    value: receipt(nonce, "source-0", true),
  });
  await act(async () => {
    await client.refetchQueries({
      queryKey: ["personal-accounts", bootstrap.scope, "operation", nonce],
      exact: true,
    });
  });
  await waitFor(() =>
    expect(screen.getAllByText("Hide result")).toHaveLength(2),
  );
  expect(api.readOperation).toHaveBeenCalledWith(nonce);
  expect(api.listSources).toHaveBeenCalledTimes(1);
  expect((add as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finishMutationRefresh(bootstrap.page));
  await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(2));
  expect((add as HTMLButtonElement).disabled).toBe(true);
  await act(async () =>
    finishTail({
      status: "ok",
      value: {
        sources: [
          { ...source("source-0"), label: "Old receipt visible" },
          source("source-1"),
        ],
        nextCursor: null,
      },
    }),
  );
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(
    screen.getByRole("article", { name: "Old receipt visible" }),
  ).toBeTruthy();
  expect(api.attach).toHaveBeenCalledTimes(1);
  expect(api.revoke).not.toHaveBeenCalled();
  expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toContain(nonce);
});

test("a terminal receipt from the mutation itself is covered by its availability refresh", async () => {
  const { bootstrap, api } = fixture();
  type SourcesResult = Awaited<ReturnType<PersonalAccountsApi["listSources"]>>;
  let finishRefresh!: (result: SourcesResult) => void;
  api.listSources.mockImplementationOnce(
    () =>
      new Promise<SourcesResult>((resolve) => {
        finishRefresh = resolve;
      }),
  );
  api.listSources.mockResolvedValue(bootstrap.page);
  render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "Access: Personal source-0",
    }),
  );
  const add = await screen.findByRole("button", {
    name: "Add access to Organization Y",
  });
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(add);
  await waitFor(() => expect(api.listSources).toHaveBeenCalledTimes(1));
  // Ensure the status observer has received the applied cache publication
  // while the mutation's own availability snapshot is still in flight.
  await screen.findByText("Hide result");
  expect((add as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finishRefresh(bootstrap.page));
  await waitFor(() => expect((add as HTMLButtonElement).disabled).toBe(false));
  expect(api.listSources).toHaveBeenCalledTimes(1);
  expect(api.attach).toHaveBeenCalledTimes(1);
  expect(api.revoke).not.toHaveBeenCalled();
});

vi.mock("./account-lifecycle-actions", () => ({
  continueAccountLifecycleOperation: vi.fn(),
  mutateAccountLifecycle: vi.fn(),
  readAccountLifecycleOperation: vi.fn(),
}));

// A temporary source read must retain its safe name but disable sharing; denied
// reads remove the source instead of treating the retained page as authority.
test("retains personal sources without sharing authority on outage and clears denied sources", async () => {
  const { bootstrap, api } = fixture();
  render(
    <PersonalAccountControls
      bootstrap={{
        ...bootstrap,
        page: {
          status: "ok",
          value: { sources: [source("source-0")], nextCursor: null },
        },
      }}
      api={api}
    />,
  );
  expect(
    await screen.findByRole("article", { name: "Personal source-0" }),
  ).toBeTruthy();
  api.listSources.mockResolvedValue({ status: "unavailable" });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh personal accounts" }),
  );
  await screen.findByText("Details could not be refreshed");
  expect(
    screen.getByRole("article", { name: "Personal source-0" }),
  ).toBeTruthy();
  expect(
    (
      screen.getByRole("button", {
        name: "Access: Personal source-0",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  api.listSources.mockResolvedValue({ status: "denied" });
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh personal accounts" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("article", { name: "Personal source-0" }),
    ).toBeNull(),
  );
});
