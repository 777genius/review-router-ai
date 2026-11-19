import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import type {
  AccountMetadataFields,
  AccountMetadataObservation,
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

async function fixture() {
  const db = createPrismaClient({
    databaseUrl: disposableDatabase(),
    poolMax: 4,
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
  const read = vi.fn(
    async (_ownerRef: string, refs: readonly string[], _signal: AbortSignal) =>
      observations(refs),
  );
  const service = createAccountMetadataService({
    prisma: db,
    reader: { read },
    secret: "TEST-only-metadata-secret",
    operatorWorkspaceId: operator,
    authorize: async () => scope,
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
    page,
    setScope: (value: typeof scope) => {
      scope = value;
    },
  };
}

describe.skipIf(process.env.RR_H_PERSONAL_SHARING_QUERIES_PG_TEST !== "1")(
  "native account metadata database authorization",
  () => {
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
