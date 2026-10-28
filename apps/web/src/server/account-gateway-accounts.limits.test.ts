import { expect, it, vi } from "vitest";
import {
  createAccountsAdapter,
  accountGatewayWorkspaceOwnerRef,
  type AccountView,
} from "./account-gateway-accounts";
import type {
  ProviderAccountConnection,
  WorkspaceAccountBinding,
} from "@reviewrouter/features-provider-accounts";

type Input = Parameters<typeof createAccountsAdapter>[0];
function fixture() {
  let session = {
    workspaceId: "workspace",
    actor: { userId: "admin", githubUserId: "", githubLogin: "fixture" },
  };
  let admin = true;
  const owned: ProviderAccountConnection = {
    id: "owned",
    owner: { kind: "workspace", workspaceId: "workspace" },
    gatewayAccountRef: "native-owned",
    gatewayOperationRef: null,
    profileRef: "profile",
    displayName: "Owned",
    state: "active",
    metadataRevision: 1,
  };
  const operator: ProviderAccountConnection = {
    ...owned,
    id: "shared",
    owner: { kind: "workspace", workspaceId: "operator" },
    gatewayAccountRef: "native-shared",
    displayName: "Private operator label",
  };
  let binding: WorkspaceAccountBinding = {
    id: "grant",
    workspaceId: "workspace",
    connectionId: operator.id,
    state: "active",
    revision: 1,
    policyRevision: 1,
    pendingFence: null,
    fenceAck: null,
  };
  const accounts = {
    findOwnedConnectionByGatewayRef: vi.fn(async () => owned),
    findConnectionBinding: vi.fn(async (scope: { connectionId: string }) =>
      scope.connectionId === operator.id ? binding : null,
    ),
    listOperatorGrantedBindings: vi.fn(async () => [
      { connection: operator, binding },
    ]),
    findBinding: vi.fn(async () => ({ connection: operator, binding })),
  };
  const remote = (connection: ProviderAccountConnection) => ({
    accountRef: connection.gatewayAccountRef,
    ownerRef: accountGatewayWorkspaceOwnerRef(
      connection.owner.kind === "workspace"
        ? connection.owner.workspaceId
        : "unused",
    ),
    profileId: "profile",
    displayName: connection.displayName,
    state: "active",
    metadataRevision: 1,
    authorizationEpoch: 1,
  });
  const gateway = {
    profiles: vi.fn(async () => ({
      profiles: [
        {
          profileId: "profile",
          protocol: "openai-responses",
          authKinds: ["api_key"],
          modelIds: ["fixture"],
        },
      ],
    })),
    list: vi.fn(async () => ({ accounts: [remote(owned)], nextCursor: null })),
    get: vi.fn(async (ref: string) =>
      remote(ref === owned.gatewayAccountRef ? owned : operator),
    ),
  };
  const page = vi.fn(async (rows: readonly AccountView[]): Promise<void> => {
    void rows;
  });
  const adapter = createAccountsAdapter({
    gateway: gateway as unknown as Input["gateway"],
    accounts: accounts as unknown as Input["accounts"],
    synchronization: {} as Input["synchronization"],
    bindingDependencies: {
      accounts: accounts as unknown as Input["bindingDependencies"]["accounts"],
      operatorWorkspaceId: "operator",
      workspaceAccess: {
        findWorkspaceRoleByUserId: vi.fn(async () =>
          admin ? "admin" : "member",
        ),
      } as unknown as Input["bindingDependencies"]["workspaceAccess"],
    },
    apiKeyProfiles: new Map([["profile", "MiMo"]]),
    limits: async () => ({
      read: vi.fn(),
      async page<T extends AccountView>(rows: readonly T[]): Promise<T[]> {
        await page(rows);
        return [...rows];
      },
    }),
    authorize: async () => {
      if (!admin) throw new Error("admin_lost");
      return session;
    },
  });
  return {
    adapter,
    gateway,
    page,
    revoke: () => {
      binding = {
        ...binding,
        state: "revoked",
        revision: 2,
        policyRevision: 2,
      };
    },
    downgrade: () => {
      admin = false;
    },
    switchSession: () => {
      session = {
        ...session,
        actor: { ...session.actor, userId: "other-user" },
      };
    },
  };
}
it("drops operator metadata when its grant is revoked while another account's limits are awaited", async () => {
  const h = fixture();
  h.page.mockImplementationOnce(async () => {
    h.revoke();
  });
  const result = await h.adapter.list("context");
  expect(result).toMatchObject({
    status: "ok",
    value: { accounts: [{ connectionId: "owned" }] },
  });
  if (result.status !== "ok") throw new Error("fixture_expected_accounts");
  expect(result.value.accounts).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("Private operator label");
  expect(h.gateway.get).toHaveBeenCalledTimes(2);
});
it.each(["downgrade", "switchSession"] as const)(
  "denies the legacy page after %s during quota enrichment",
  async (change) => {
    const h = fixture();
    h.page.mockImplementationOnce(async () => {
      h[change]();
    });
    expect(await h.adapter.list("context")).toEqual({ status: "denied" });
    expect(h.gateway.get).toHaveBeenCalledTimes(2);
  },
);
