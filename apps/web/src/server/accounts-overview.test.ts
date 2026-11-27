import { expect, test } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createAccountsOverview } from "./accounts-overview";

const viewer = "user-viewer";
const workspace = "workspace-x";
const source = (
  id: string,
  owner: { ownerUserId: string | null; ownerWorkspaceId: string | null },
) => ({
  id,
  ...owner,
  gatewayAccountRef: `account-${id}`,
  profileRef: "mimo",
  displayName: id,
  state: "active",
  metadataRevision: 1,
  authorizationEpochMirror: null,
  pendingSourceOperationId: null,
  bindingId: `binding-${id}`,
  bindingRevision: 1,
  bindingState: "active" as const,
  fencePending: false,
  role: "admin",
  workspaceName: "Workspace X",
});

// The source id lets one Connections list show the viewer's own connection
// once. It must never identify someone else's connection.
test("only the viewer's own personal rows carry their source id", async () => {
  const rows = [
    source("own", { ownerUserId: viewer, ownerWorkspaceId: null }),
    source("member", { ownerUserId: "user-member", ownerWorkspaceId: null }),
    source("organization", { ownerUserId: null, ownerWorkspaceId: workspace }),
  ];
  const prisma = {
    $queryRaw: async () => rows,
    user: { findMany: async () => [] },
  } as unknown as PrismaClient;
  const overview = createAccountsOverview({
    prisma,
    cursorSecret: "test-cursor-secret",
    gateway: {
      get: async () => {
        throw new Error("gateway unavailable in this test");
      },
    },
    profiles: [{ id: "mimo", label: "MiMo", authKind: "api_key" }],
    authorize: async () => ({ workspaceId: workspace, userId: viewer }),
    visibleRepositoryIds: async () => null,
    ownerRef: (owner) =>
      owner.kind === "user"
        ? `user:${owner.userId}`
        : `ws:${owner.workspaceId}`,
  });
  const page = await overview.list();
  if (page.status !== "ok") throw new Error(`overview ${page.status}`);
  expect(
    page.value.accounts.map((account) => [account.label, account.sourceId]),
  ).toEqual([
    ["own", "own"],
    ["member", undefined],
    ["organization", undefined],
  ]);
  expect(
    page.value.accounts.find((account) => account.label === "member")
      ?.connectionId,
  ).toBe("binding-member");
});

test.each(["oauth", "unknown", "native"] as const)(
  "workspace inventory preserves the account's %s kind over a profile hint",
  async (authKind) => {
    const rows = [
      source("own", { ownerUserId: viewer, ownerWorkspaceId: null }),
    ];
    const overview = createAccountsOverview({
      prisma: {
        $queryRaw: async () => rows,
        user: { findMany: async () => [] },
      } as unknown as PrismaClient,
      cursorSecret: "test-cursor-secret",
      gateway: {
        get: async () => ({
          accountRef: "account-own",
          ownerRef: `user:${viewer}`,
          profileId: "mimo",
          displayName: "Own account",
          state: "active",
          metadataRevision: 1,
          authorizationEpoch: 1,
          authKind,
          ...(authKind === "native"
            ? {
                credential: {
                  credentialKind: "native" as const,
                  credentialPolicy: "cloud_identity" as const,
                  refreshPolicy: "native" as const,
                },
              }
            : {}),
        }),
      },
      profiles: [{ id: "mimo", label: "MiMo", authKind: "api_key" }],
      authorize: async () => ({ workspaceId: workspace, userId: viewer }),
      visibleRepositoryIds: async () => null,
      ownerRef: (owner) =>
        owner.kind === "user"
          ? `user:${owner.userId}`
          : `ws:${owner.workspaceId}`,
    });
    const page = await overview.list();
    expect(page.status).toBe("ok");
    if (page.status !== "ok") throw new Error("expected workspace inventory");
    expect(page.value.accounts).toHaveLength(1);
    expect(page.value.accounts[0]?.authKind).toBe(
      authKind === "oauth" ? "oauth" : undefined,
    );
    if (authKind === "native")
      expect(page.value.accounts[0]?.nativeCredential).toEqual({
        credentialKind: "native",
        credentialPolicy: "cloud_identity",
        refreshPolicy: "native",
      });
  },
);
