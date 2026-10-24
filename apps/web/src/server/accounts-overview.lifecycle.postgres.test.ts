import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaPersonalAccountOperations,
  PrismaAccountLifecycleOperations,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { createAccountLimitsService } from "./account-limits-service";
import { createAccountsOverview } from "./accounts-overview";
import {
  accountGatewayUserOwnerRef,
  accountGatewayWorkspaceOwnerRef,
} from "./account-gateway-accounts";
function disposableDatabase() {
  const raw = process.env.RR_C2C_PG_TEST_URL ?? "";
  const url = new URL(raw);
  if (
    process.env.RR_C2C_MIGRATED_DISPOSABLE_DATABASE !== "1" ||
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    !/^rr_gateway_test_c2c_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("accounts_lifecycle_disposable_loopback_required");
  return raw;
}
describe.skipIf(process.env.RR_H_PERSONAL_SHARING_QUERIES_PG_TEST !== "1")(
  "closed lifecycle ordinary inventory",
  () => {
    it("excludes only fully proved closed deletion before pagination after reload; pending and legacy remain", async () => {
      const db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: disposableDatabase() }),
      });
      const prefix = `lifecycle-inventory-${randomUUID()}`;
      try {
        const actor = `${prefix}-user`,
          workspaceId = `${prefix}-org`;
        await db.user.create({ data: { id: actor } });
        await db.workspace.create({
          data: {
            id: workspaceId,
            slug: workspaceId,
            name: "TEST lifecycle organization",
            members: { create: { userId: actor, role: "owner" } },
          },
        });
        const sources = await Promise.all(
          ["0closed", "1pending", "2legacy"].map((suffix) =>
            db.providerAccountConnection.create({
              data: {
                id: `${prefix}-${suffix}`,
                ownerWorkspaceId: workspaceId,
                gatewayAccountRef: `${prefix}-account-${suffix}`,
                profileRef: "profile",
                displayName: suffix,
                state: suffix === "2legacy" ? "disabled" : "active",
                authorizationEpochMirror: 1n,
              },
            }),
          ),
        );
        const store = new PrismaAccountLifecycleOperations(db);
        const reserve = (sourceId: string) =>
          store.reserve({
            actorUserId: actor,
            clientOperationId: randomUUID(),
            sourceId,
            action: "delete",
            personalWorkspaceId: null,
            owningWorkspaceId: workspaceId,
            expectedSourceMetadataRevision: 1,
            expectedGatewayRevision: 1,
            expectedAuthorizationEpoch: 1,
          });
        const closed = await reserve(sources[0]!.id);
        await store.ready(actor, closed.id);
        await store.claim(actor, closed.id);
        // Synthetic qualification facts exercise real immutable DB guards and read SQL.
        // This test does not claim native erasure or a Gateway integration proof.
        await store.finalize(
          actor,
          closed.id,
          {
            accountRef: sources[0]!.gatewayAccountRef,
            profileId: "profile",
            displayName: "0closed",
            state: "disabled",
            metadataRevision: 2,
            authorizationEpoch: 2,
          },
          closed.id,
          {
            retirementOperationId: closed.id,
            bindingErasureProofRef: `${prefix}-binding`,
            transportErasureProofRef: `${prefix}-transport`,
            nativeErasureProofRef: `${prefix}-native`,
          },
        );
        const pending = await reserve(sources[1]!.id);
        // The inventory may only advertise what this store can reserve.
        await expect(reserve(sources[2]!.id)).rejects.toMatchObject({
          code: "revision_conflict",
        });
        const reload = () =>
          createAccountsOverview({
            prisma: db,
            cursorSecret: "TEST-only-inventory-cursor-secret",
            profiles: [{ id: "profile", label: "TEST", authKind: "api_key" }],
            authorize: async () => ({ workspaceId, userId: actor }),
            visibleRepositoryIds: async () => null,
            ownerRef: (owner) =>
              owner.kind === "workspace"
                ? accountGatewayWorkspaceOwnerRef(owner.workspaceId)
                : "unused",
            lifecycleCompatible: async () => true,
            gateway: {
              get: async (accountRef) => ({
                accountRef,
                ownerRef: accountGatewayWorkspaceOwnerRef(workspaceId),
                profileId: "profile",
                displayName: "TEST",
                state: "disabled",
                metadataRevision: 2,
                authorizationEpoch: 2,
              }),
            },
          });
        const first = await reload().list({ limit: 1 });
        expect(first).toMatchObject({
          status: "ok",
          value: {
            accounts: [
              {
                connectionId: sources[1]!.id,
                lifecycle: {
                  status: "pending",
                  action: "delete",
                  operationId: pending.id,
                },
              },
            ],
          },
        });
        if (first.status !== "ok" || !first.value.nextCursor)
          throw new Error("expected_later_legacy_page");
        const second = await reload().list({
          limit: 1,
          afterBindingId: first.value.nextCursor,
        });
        expect(second).toMatchObject({
          status: "ok",
          value: {
            accounts: [
              {
                connectionId: sources[2]!.id,
                lifecycle: { status: "support_required" },
                allowedActions: [],
              },
            ],
            nextCursor: null,
          },
        });
        expect((await store.read(actor, closed.id)).closureComplete).toBe(true);
      } finally {
        await db.$disconnect();
      }
    }, 30000);
    it("omits a shared row revoked while an owned row awaits native quota", async () => {
      const db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: disposableDatabase() }),
      });
      const prefix = `quota-inventory-${randomUUID()}`;
      const viewer = `${prefix}-viewer`,
        donor = `${prefix}-donor`,
        workspaceId = `${prefix}-org`;
      try {
        await db.user.createMany({
          data: [
            { id: viewer },
            {
              id: donor,
              githubLogin: "private-donor",
              avatarUrl: "https://test.invalid/private-donor.png",
            },
          ],
        });
        await db.workspace.create({
          data: {
            id: workspaceId,
            slug: workspaceId,
            name: "TEST quota inventory",
            members: {
              create: [
                { userId: viewer, role: "owner" },
                { userId: donor, role: "admin" },
              ],
            },
          },
        });
        await db.workspace.create({
          data: {
            id: `${prefix}-donor-personal`,
            slug: `${prefix}-donor-personal`,
            name: "TEST donor personal workspace",
            personalOwnerUserId: donor,
          },
        });
        const shared = await db.providerAccountConnection.create({
          data: {
            id: `${prefix}-a-shared`,
            ownerUserId: donor,
            gatewayAccountRef: `${prefix}-shared-native`,
            profileRef: "profile",
            displayName: "Private donor label",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const owned = await db.providerAccountConnection.create({
          data: {
            id: `${prefix}-b-owned`,
            ownerWorkspaceId: workspaceId,
            gatewayAccountRef: `${prefix}-owned-native`,
            profileRef: "profile",
            displayName: "Owned",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const binding = await db.workspaceAccountBinding.create({
          data: {
            id: `${prefix}-binding`,
            workspaceId,
            connectionId: shared.id,
            state: "active",
          },
        });
        const sharing = new PrismaPersonalAccountOperations(db);
        const read = vi.fn(async () => {
          await sharing.detachRecipientBinding({
            actorUserId: viewer,
            workspaceId,
            bindingId: binding.id,
            expectedBindingRevision: 1,
          });
          return { status: "unknown" as const };
        });
        const ownerRef = (
          owner:
            | { kind: "user"; userId: string }
            | { kind: "workspace"; workspaceId: string },
        ) =>
          owner.kind === "user"
            ? accountGatewayUserOwnerRef(owner.userId)
            : accountGatewayWorkspaceOwnerRef(owner.workspaceId);
        const get = vi.fn(async (ref: string) => {
          const source = ref === shared.gatewayAccountRef ? shared : owned;
          return {
            accountRef: ref,
            ownerRef: source.ownerUserId
              ? accountGatewayUserOwnerRef(source.ownerUserId)
              : accountGatewayWorkspaceOwnerRef(workspaceId),
            profileId: "profile",
            displayName: source.displayName,
            state: "active" as const,
            metadataRevision: 1,
            authorizationEpoch: 1,
          };
        });
        const overview = createAccountsOverview({
          prisma: db,
          cursorSecret: "TEST-only-cursor-secret",
          profiles: [{ id: "profile", label: "TEST", authKind: "api_key" }],
          authorize: async () => ({ workspaceId, userId: viewer }),
          visibleRepositoryIds: async () => null,
          ownerRef,
          gateway: { get },
          limits: createAccountLimitsService({
            prisma: db,
            reader: { read },
            secret: "TEST-only-quota-secret",
            authorize: async () => ({ workspaceId, userId: viewer }),
            ownerRef,
          }),
        });
        const result = await overview.list();
        expect(read).toHaveBeenCalledOnce();
        // The cached-reader boundary intentionally masks source errors. Confirm
        // this controlled revoke actually completed rather than masking a bad fixture.
        await expect(read.mock.results[0]!.value).resolves.toEqual({
          status: "unknown",
        });
        expect(result).toMatchObject({
          status: "ok",
          value: { accounts: [{ connectionId: owned.id }] },
        });
        if (result.status !== "ok")
          throw new Error("fixture_expected_accounts");
        expect(result.value.accounts).toHaveLength(1);
        expect(JSON.stringify(result)).not.toMatch(
          /Private donor label|private-donor/,
        );
        expect(read).toHaveBeenCalledOnce();
        expect(get).toHaveBeenCalledTimes(2);
      } finally {
        await db.$disconnect();
      }
    }, 30000);
  },
);
