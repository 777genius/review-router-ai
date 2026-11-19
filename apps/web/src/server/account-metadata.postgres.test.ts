import {
  PrismaProviderAccountSynchronization,
  PrismaPersonalAccountOperations,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import type {
  AccountMetadataFields,
  AccountMetadataObservation,
  AccountMetadataReader,
} from "@reviewrouter/features-provider-accounts/account-metadata";
import { createAccountMetadataService } from "./account-metadata-service";

function disposableDatabase() {
  const url = new URL(process.env.RR_C2C_PG_TEST_URL ?? "");
  if (
    process.env.RR_C2C_MIGRATED_DISPOSABLE_DATABASE !== "1" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^rr_gateway_test_c2c_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("account_metadata_disposable_loopback_required");
  return url.toString();
}

const fields: AccountMetadataFields = {
  email: {
    status: "known",
    value: "private-owner@example.invalid",
    source: "provider_api",
    observedAt: "2026-11-19T10:00:00Z",
    freshness: "current",
  },
  accountLabel: { status: "unknown" },
  subscription: { status: "unknown" },
  credentialExpiresAt: { status: "unknown" },
  privacyMode: { status: "unknown" },
};
const observations = (refs: readonly string[]): AccountMetadataObservation[] =>
  refs.map((accountRef) => ({
    accountRef,
    authorizationEpoch: 1,
    metadataRevision: 1,
    info: { status: "available", fields },
  }));

async function fixture(poolMax = 4, readMembership = false) {
  const db = createPrismaClient({
    databaseUrl: disposableDatabase(),
    poolMax,
  });
  const prefix = `metadata-${randomUUID()}`;
  const owner = `${prefix}-owner`,
    admin = `${prefix}-admin`,
    member = `${prefix}-member`;
  const org = `${prefix}-org`,
    operator = `${prefix}-operator`;
  await db.user.createMany({
    data: [owner, admin, member].map((id) => ({ id })),
  });
  await db.workspace.create({
    data: {
      id: org,
      slug: org,
      name: "TEST metadata",
      members: {
        create: [
          { userId: owner, role: "owner" },
          { userId: admin, role: "admin" },
          { userId: member, role: "member" },
        ],
      },
    },
  });
  await db.workspace.create({
    data: { id: operator, slug: operator, name: "TEST operator" },
  });
  await db.workspace.create({
    data: {
      id: `${prefix}-personal-workspace`,
      slug: `${prefix}-personal-workspace`,
      name: "TEST personal metadata",
      personalOwnerUserId: owner,
    },
  });
  const personal = await db.providerAccountConnection.create({
    data: {
      id: `${prefix}-personal`,
      ownerUserId: owner,
      gatewayAccountRef: `${prefix}-native-personal`,
      profileRef: "codex",
      displayName: "TEST personal",
      state: "active",
      authorizationEpochMirror: 1n,
    },
  });
  const owned = await db.providerAccountConnection.create({
    data: {
      id: `${prefix}-owned`,
      ownerWorkspaceId: org,
      gatewayAccountRef: `${prefix}-native-owned`,
      profileRef: "codex",
      displayName: "TEST owned",
      state: "active",
      authorizationEpochMirror: 1n,
    },
  });
  const operated = await db.providerAccountConnection.create({
    data: {
      id: `${prefix}-operated`,
      ownerWorkspaceId: operator,
      gatewayAccountRef: `${prefix}-native-operated`,
      profileRef: "codex",
      displayName: "TEST operated",
      state: "active",
      authorizationEpochMirror: 1n,
    },
  });
  const bindings = await Promise.all(
    [personal, owned, operated].map((source) =>
      db.workspaceAccountBinding.create({
        data: {
          id: `${source.id}-binding`,
          workspaceId: org,
          connectionId: source.id,
          state: "active",
        },
      }),
    ),
  );
  let scope: { userId: string; workspaceId?: string } = { userId: owner };
  const read = vi.fn<AccountMetadataReader["read"]>(async (_ownerRef, refs) =>
    observations(refs),
  );
  const authorize = vi.fn<
    Parameters<typeof createAccountMetadataService>[0]["authorize"]
  >(async (authorizationDb) => {
    if (readMembership && scope.workspaceId)
      await authorizationDb.workspaceMember.findFirst({
        where: { workspaceId: scope.workspaceId, userId: scope.userId },
        select: { role: true },
      });
    return scope;
  });
  const service = createAccountMetadataService({
    prisma: db,
    reader: { read },
    secret: "TEST-only-metadata-secret",
    operatorWorkspaceId: operator,
    authorize,
    ownerRef: (owner) =>
      owner.kind === "user" ? `u-${owner.userId}` : `w-${owner.workspaceId}`,
  });
  const page = (...connectionIds: string[]) =>
    service.page(
      connectionIds.map((connectionId) => ({
        connectionId,
        label: "Inventory survives",
      })),
    );
  return {
    db,
    owner,
    admin,
    member,
    org,
    personal,
    owned,
    operated,
    bindings,
    read,
    authorize,
    page,
    setScope: (value: typeof scope) => {
      scope = value;
    },
  };
}

describe.skipIf(process.env.RR_H_PERSONAL_SHARING_QUERIES_PG_TEST !== "1")(
  "native account metadata database authorization",
  () => {
    it.each(["source", "membership"] as const)(
      "cancels a locked %s query and releases the sole pool connection before the lock is released",
      async (lockedTable) => {
        const f = await fixture(1, true);
        const blocker = createPrismaClient({
          databaseUrl: disposableDatabase(),
          poolMax: 2,
        });
        let release = () => {};
        let acquired = () => {};
        const unlock = new Promise<void>((resolve) => {
          release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          acquired = resolve;
        });
        const [baseline] = await f.db.$queryRaw<
          Array<{
            pid: number;
            statement_timeout: string;
            lock_timeout: string;
          }>
        >`SELECT pg_backend_pid() AS pid, current_setting('statement_timeout') AS statement_timeout,
          current_setting('lock_timeout') AS lock_timeout`;
        const held = blocker.$transaction(
          async (tx) => {
            if (lockedTable === "source")
              await tx.$executeRaw`LOCK TABLE "ProviderAccountConnection" IN ACCESS EXCLUSIVE MODE`;
            else
              await tx.$executeRaw`LOCK TABLE "WorkspaceMember" IN ACCESS EXCLUSIVE MODE`;
            acquired();
            await unlock;
          },
          { timeout: 15000, maxWait: 1000 },
        );
        try {
          await Promise.race([ready, held]);
          f.setScope({ userId: f.owner, workspaceId: f.org });
          const pending = f.page(f.personal.id);
          await vi.waitFor(
            async () => {
              const [waiting] = await blocker.$queryRaw<
                Array<{ wait: string | null; query: string }>
              >`
              SELECT wait_event_type AS wait, query FROM pg_stat_activity WHERE pid = ${baseline!.pid}`;
              expect(waiting?.wait).toBe("Lock");
              expect(waiting?.query).toContain(
                lockedTable === "source"
                  ? "ProviderAccountConnection"
                  : "WorkspaceMember",
              );
            },
            { timeout: 1500, interval: 10 },
          );
          const rows = await pending;
          expect(rows[0]?.metadata?.status).toBe("restricted");
          expect(rows[0]?.label).toBe("Inventory survives");
          expect(JSON.stringify(rows)).not.toContain("private-owner");
          expect(f.read).not.toHaveBeenCalled();
          // The peer still holds its lock. Success on this one-connection pool
          // proves actual cancellation/release, not just a raced page response.
          await vi.waitFor(
            async () => {
              const [probe] = await f.db.$queryRaw<
                Array<{
                  ready: number;
                  statement_timeout: string;
                  lock_timeout: string;
                }>
              >`SELECT 1 AS ready, current_setting('statement_timeout') AS statement_timeout,
              current_setting('lock_timeout') AS lock_timeout`;
              expect(probe).toEqual({
                ready: 1,
                statement_timeout: baseline!.statement_timeout,
                lock_timeout: baseline!.lock_timeout,
              });
            },
            { timeout: 1000 },
          );
        } finally {
          release();
          await held;
          await blocker.$disconnect();
          await f.db.$disconnect();
        }
      },
    );

    it("bounds pool admission and never starts expired authorization after a connection becomes free", async () => {
      const f = await fixture(1, true);
      let release = () => {};
      let acquired = () => {};
      const unlock = new Promise<void>((resolve) => {
        release = resolve;
      });
      const ready = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const held = f.db.$transaction(
        async () => {
          acquired();
          await unlock;
        },
        { timeout: 10000, maxWait: 1000 },
      );
      try {
        await Promise.race([ready, held]);
        const rows = await f.page(f.personal.id);
        expect(rows[0]?.metadata?.status).toBe("restricted");
        expect(f.authorize).not.toHaveBeenCalled();
        expect(f.read).not.toHaveBeenCalled();
        release();
        await held;
        await expect(f.db.$queryRaw`SELECT 1 AS ready`).resolves.toEqual([
          { ready: 1 },
        ]);
        expect(f.authorize).not.toHaveBeenCalled();
      } finally {
        release();
        await held;
        await f.db.$disconnect();
      }
    });

    it("records verified workspace epochs and rejects rollback/CAS races before exposing metadata", async () => {
      const f = await fixture();
      try {
        const sync = new PrismaProviderAccountSynchronization(f.db);
        const input = {
          id: `${f.owned.id}-new`,
          workspaceId: f.org,
          gatewayAccountRef: `${f.owned.gatewayAccountRef}-new`,
          gatewayOperationRef: null,
          profileRef: "codex",
          displayName: "TEST newly connected",
          state: "active" as const,
          authorizationEpoch: 1,
        };
        const source = await sync.recordWorkspaceConnection(input);
        expect(source.authorizationEpochMirror).toBe(1);
        f.setScope({ userId: f.owner, workspaceId: f.org });
        expect((await f.page(source.id))[0]?.metadata?.status).toBe(
          "available",
        );
        const command = {
          workspaceId: f.org,
          connectionId: source.id,
          expectedRevision: 1,
          gatewayOperationRef: null,
          profileRef: "codex",
          displayName: input.displayName,
          state: "active" as const,
          authorizationEpoch: 2,
        };
        const advanced = await sync.synchronizeMetadata(command);
        expect(advanced.authorizationEpochMirror).toBe(2);
        expect((await f.page(source.id))[0]?.metadata?.status).toBe(
          "unavailable",
        );
        await expect(
          sync.synchronizeMetadata({ ...command, authorizationEpoch: 3 }),
        ).rejects.toMatchObject({ code: "revision_conflict" });
        await expect(
          sync.synchronizeMetadata({
            ...command,
            expectedRevision: 2,
            authorizationEpoch: 1,
          }),
        ).rejects.toMatchObject({ code: "revision_conflict" });
        f.read.mockImplementation(async (_owner, refs) =>
          observations(refs).map((item) => ({
            ...item,
            authorizationEpoch: 2,
          })),
        );
        expect((await f.page(source.id))[0]?.metadata?.status).toBe(
          "available",
        );
        const final = await f.db.providerAccountConnection.findUniqueOrThrow({
          where: { id: source.id },
        });
        expect(final.metadataRevision).toBe(2);
        expect(final.authorizationEpochMirror).toBe(2n);
      } finally {
        await f.db.$disconnect();
      }
    });
    it("retains an import method across restart and forbids nonce/method substitution in SQL", async () => {
      const f = await fixture();
      try {
        const store = new PrismaPersonalAccountOperations(f.db);
        const personalWorkspaceId = await store.resolvePersonalWorkspace(
          f.owner,
        );
        const intent = {
          actorUserId: f.owner,
          clientOperationId: randomUUID(),
          personalWorkspaceId,
          action: "connect" as const,
          proposedSourceId: `${f.personal.id}-import`,
          profileId: "openai-codex-oauth-responses-v1",
          displayName: "TEST import",
          ingress: "credential-import" as const,
          credentialImportMethod: "refresh_token" as const,
        };
        const receipt = await store.reserveConnect(intent);
        expect(
          await store.claimConnect(f.owner, intent.clientOperationId),
        ).toBe(true);
        await store.noteConnectPhase(
          f.owner,
          intent.clientOperationId,
          "unknown",
        );
        const restarted = new PrismaPersonalAccountOperations(f.db);
        expect(
          (await restarted.readOperation(f.owner, intent.clientOperationId))
            .intent,
        ).toEqual(intent);
        expect(
          await restarted.claimConnect(f.owner, intent.clientOperationId),
        ).toBe(false);
        await expect(
          restarted.reserveConnect({
            ...intent,
            credentialImportMethod: "oauth_auth_json",
          }),
        ).rejects.toMatchObject({ code: "operation_conflict" });
        await expect(
          f.db.personalAccountOperation.update({
            where: { id: receipt.id },
            data: { credentialImportMethod: "oauth_auth_json" },
          }),
        ).rejects.toThrow();
        const stored = await f.db.personalAccountOperation.findUniqueOrThrow({
          where: { id: receipt.id },
        });
        expect(stored.oauthMethod).toBeNull();
        expect(stored.credentialImportMethod).toBe("refresh_token");
      } finally {
        await f.db.$disconnect();
      }
    });

    it("shows facts only to personal owners and owning workspace admins while retaining borrower inventory", async () => {
      const f = await fixture();
      try {
        expect((await f.page(f.personal.id))[0]?.metadata?.status).toBe(
          "available",
        );
        f.setScope({ userId: f.admin });
        f.read.mockClear();
        expect((await f.page(f.personal.id))[0]?.metadata?.status).toBe(
          "restricted",
        );
        expect(f.read).not.toHaveBeenCalled();

        f.setScope({ userId: f.admin, workspaceId: f.org });
        const rows = await f.page(
          f.owned.id,
          f.bindings[0]!.id,
          f.bindings[2]!.id,
        );
        expect(rows.map((row) => row.metadata?.status)).toEqual([
          "available",
          "restricted",
          "restricted",
        ]);
        expect(f.read).toHaveBeenCalledExactlyOnceWith(
          `w-${f.org}`,
          [f.owned.gatewayAccountRef],
          expect.any(AbortSignal),
        );
        expect(JSON.stringify(rows.slice(1))).not.toContain("private-owner");
        expect(rows.every((row) => row.label === "Inventory survives")).toBe(
          true,
        );

        f.setScope({ userId: f.member, workspaceId: f.org });
        f.read.mockClear();
        expect((await f.page(f.bindings[1]!.id))[0]?.metadata?.status).toBe(
          "restricted",
        );
        expect(f.read).not.toHaveBeenCalled();

        f.setScope({ userId: f.owner });
        const unknownEpoch = await f.db.providerAccountConnection.create({
          data: {
            id: `${f.personal.id}-unknown`,
            ownerUserId: f.owner,
            gatewayAccountRef: `${f.personal.gatewayAccountRef}-unknown`,
            profileRef: "codex",
            displayName: "TEST unknown epoch",
            state: "active",
          },
        });
        f.read.mockClear();
        expect((await f.page(unknownEpoch.id))[0]?.metadata?.status).toBe(
          "unavailable",
        );
        expect(f.read).not.toHaveBeenCalled();
      } finally {
        await f.db.$disconnect();
      }
    });

    it("fences an early owner's facts when its binding changes while another owner's batch is awaited", async () => {
      const f = await fixture();
      try {
        f.setScope({ userId: f.owner, workspaceId: f.org });
        f.read.mockImplementation(async (ownerRef, refs) => {
          if (ownerRef === `w-${f.org}`) {
            await f.db.workspaceAccountBinding.update({
              where: { id: f.bindings[0]!.id },
              data: {
                revision: { increment: 1 },
                policyRevision: { increment: 1 },
              },
            });
          }
          return observations(refs);
        });
        const rows = await f.page(f.personal.id, f.owned.id);
        expect(rows.map((row) => row.metadata?.status)).toEqual([
          "restricted",
          "available",
        ]);
        expect(JSON.stringify(rows[0])).not.toContain("private-owner");
        expect(f.read).toHaveBeenCalledTimes(2);
      } finally {
        await f.db.$disconnect();
      }
    });

    it.each(["membership", "epoch", "binding", "scope", "disable"] as const)(
      "does not return private facts after a concurrent %s change",
      async (change) => {
        const f = await fixture();
        try {
          f.setScope({ userId: f.owner, workspaceId: f.org });
          f.read.mockImplementation(async (_ownerRef, refs) => {
            if (change === "membership")
              await f.db.workspaceMember.deleteMany({
                where: { workspaceId: f.org, userId: f.owner },
              });
            if (change === "epoch")
              await f.db.providerAccountConnection.update({
                where: { id: f.personal.id },
                data: {
                  authorizationEpochMirror: 2n,
                  metadataRevision: { increment: 1 },
                },
              });
            if (change === "binding")
              await f.db.workspaceAccountBinding.update({
                where: { id: f.bindings[0]!.id },
                data: {
                  state: "revoked",
                  revision: { increment: 1 },
                  policyRevision: { increment: 1 },
                  pendingFenceOperationId: randomUUID(),
                  pendingFencePolicySubject: f.bindings[0]!.id,
                  pendingFencePolicyRevision: 2,
                },
              });
            if (change === "scope")
              f.setScope({ userId: f.admin, workspaceId: f.org });
            if (change === "disable")
              await f.db.providerAccountConnection.update({
                where: { id: f.personal.id },
                data: { state: "disabled", metadataRevision: { increment: 1 } },
              });
            return observations(refs);
          });
          const rows = await f.page(f.personal.id);
          expect(rows[0]?.metadata?.status).toBe("restricted");
          expect(JSON.stringify(rows)).not.toContain("private-owner");
          expect(rows[0]?.label).toBe("Inventory survives");
        } finally {
          await f.db.$disconnect();
        }
      },
    );
  },
);
