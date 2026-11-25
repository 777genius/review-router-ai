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
