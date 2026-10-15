// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
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
        name: "Manage sharing for Personal source-0",
      }),
    );
    expect(
      await screen.findByText(organizationLabel ?? "Organization unavailable"),
    ).toBeTruthy();
    expect(document.body.textContent).not.toContain("opaque-former-org");
    if (organizationLabel === null)
      expect(document.body.textContent).not.toContain("Organization X");
    fireEvent.click(screen.getByRole("button", { name: "Revoke access" }));
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
    expect(
      await screen.findByText(
        `Personal source-0 · ${organizationLabel ?? "Organization unavailable"}`,
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
  api.listEligibleOrganizations.mockImplementation(async () => ({
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
  }));
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
  fireEvent.click(screen.getByLabelText("Select Personal source-0"));
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  await screen.findByLabelText("Organization X");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(
    screen.getByRole("button", {
      name: "Manage sharing for Personal source-0",
    }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Revoke access" }));
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
    expect(api.listEligibleOrganizations).toHaveBeenCalledTimes(2),
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
  api.attach.mockRejectedValue(new Error("private transport diagnostic"));
  api.readOperation.mockResolvedValue({ status: "unavailable" });
  render(<PersonalAccountControls bootstrap={bootstrap} api={api} />);
  fireEvent.click(screen.getByLabelText("Select Personal source-0"));
  fireEvent.click(
    screen.getByRole("button", { name: "Share selected accounts" }),
  );
  fireEvent.click(await screen.findByLabelText("Organization Y"));
  fireEvent.click(screen.getByRole("button", { name: "Share 1 connection" }));
  await waitFor(() => expect(api.attach).toHaveBeenCalledTimes(1));
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
