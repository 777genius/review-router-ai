import { expect, test, vi } from "vitest";
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

test.each([
  "binding_revoked",
  "role_changed",
  "source_changed",
  "session_changed",
] as const)(
  "does not release stale inventory when %s occurs during optional metadata",
  async (change) => {
    const row = source("shared", {
      ownerUserId: "user-member",
      ownerWorkspaceId: null,
    });
    let changed = false;
    const query = vi.fn(async () => {
      if (!changed) return [row];
      if (change === "binding_revoked") return [];
      if (change === "role_changed") return [{ ...row, role: "member" }];
      if (change === "source_changed") return [{ ...row, metadataRevision: 2 }];
      return [row];
    });
    const overview = createAccountsOverview({
      prisma: {
        $queryRaw: query,
        user: { findMany: async () => [] },
      } as unknown as PrismaClient,
      cursorSecret: "test-cursor-secret",
      gateway: {
        get: async () => {
          throw new Error("unavailable");
        },
      },
      profiles: [{ id: "mimo", label: "MiMo", authKind: "api_key" }],
      authorize: async () => ({
        workspaceId: workspace,
        userId: changed && change === "session_changed" ? "other-user" : viewer,
      }),
      visibleRepositoryIds: async () => null,
      ownerRef: (owner) =>
        owner.kind === "user"
          ? `user:${owner.userId}`
          : `ws:${owner.workspaceId}`,
      metadata: {
        async page(accounts) {
          changed = true;
          // Metadata redaction alone does not remove an account's inventory fields.
          return accounts.map((account) => ({
            ...account,
            metadata: {
              status: "restricted" as const,
              displayToken: "restricted",
            },
          }));
        },
      },
    });
    const result = await overview.list();
    expect(changed).toBe(true);
    expect(result).toMatchObject(
      change === "session_changed"
        ? { status: "denied" }
        : { status: "ok", value: { accounts: [] } },
    );
  },
);

test("counts catalogue discovery in the page budget while keeping final authorization outside it", async () => {
  vi.useFakeTimers();
  const rows = Array.from({ length: 100 }, (_, index) =>
    source(`source-${String(index).padStart(3, "0")}`, {
      ownerUserId: null,
      ownerWorkspaceId: workspace,
    }),
  );
  let catalogSignal: AbortSignal | undefined;
  const remotes: AbortSignal[] = [];
  const get = vi.fn(
    async (_ref: string, options?: { signal?: AbortSignal }) => {
      remotes.push(options!.signal!);
      return await new Promise<never>(() => {});
    },
  );
  const authorize = vi.fn(async () => ({
    workspaceId: workspace,
    userId: viewer,
  }));
  const overview = createAccountsOverview({
    prisma: {
      $queryRaw: async () => rows,
      user: { findMany: async () => [] },
    } as unknown as PrismaClient,
    cursorSecret: "test-cursor-secret",
    gateway: { get },
    profiles: [],
    authorize,
    loadProfiles: (read) =>
      read(async (signal) => {
        catalogSignal = signal;
        await new Promise((resolve) => setTimeout(resolve, 2500));
        return [
          {
            id: "mimo",
            label: "MiMo",
            authKind: "api_key" as const,
            protocol: "openai-responses" as const,
            models: [],
          },
        ];
      }),
    visibleRepositoryIds: async () => null,
    ownerRef: (owner) =>
      owner.kind === "user"
        ? `user:${owner.userId}`
        : `ws:${owner.workspaceId}`,
  });
  try {
    const pending = overview.list({ limit: 100 });
    await vi.advanceTimersByTimeAsync(2500);
    expect(get).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(500);
    const page = await pending;
    expect(page.status).toBe("ok");
    if (page.status !== "ok") throw new Error("inventory_expected");
    expect(page.value.accounts).toHaveLength(100);
    expect(page.value.accounts.map((row) => row.label)).toEqual(
      rows.map((row) => row.displayName),
    );
    expect(
      page.value.accounts.every((row) => row.readiness === "unknown"),
    ).toBe(true);
    expect(catalogSignal?.aborted).toBe(true);
    expect(remotes.every((signal) => signal.aborted)).toBe(true);
    expect(get).toHaveBeenCalledTimes(4);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

test("does not let the optional remote deadline bypass a held mandatory session check", async () => {
  vi.useFakeTimers();
  let release!: () => void;
  const checked = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  const get = vi.fn(async () => {
    throw new Error("offline");
  });
  const row = source("own", { ownerUserId: viewer, ownerWorkspaceId: null });
  const overview = createAccountsOverview({
    prisma: {
      $queryRaw: async () => [row],
      user: { findMany: async () => [] },
    } as unknown as PrismaClient,
    cursorSecret: "test-cursor-secret",
    gateway: { get },
    profiles: [],
    authorize: async () => {
      if (++calls === 1) await checked;
      return { workspaceId: workspace, userId: viewer };
    },
    visibleRepositoryIds: async () => null,
    ownerRef: () => `user:${viewer}`,
  });
  try {
    let completed = false;
    const page = overview.list().then((value) => {
      completed = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(completed).toBe(false);
    expect(get).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    release();
    expect((await page).status).toBe("ok");
    expect(calls).toBe(2);
  } finally {
    release();
    vi.useRealTimers();
  }
});
