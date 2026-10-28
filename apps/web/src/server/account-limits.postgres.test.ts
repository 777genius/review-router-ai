import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaAccountLifecycleOperations,
  PrismaPersonalAccountOperations,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { PrismaProviderAccountRepository } from "@reviewrouter/features-provider-accounts";
import { createAccountLimitsService } from "./account-limits-service";
import type { AccountLimitsSourceResult } from "@reviewrouter/features-provider-accounts";
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
    throw new Error("account_limits_disposable_loopback_required");
  return url.toString();
}
const snapshot: AccountLimitsSourceResult = {
  status: "snapshot",
  physicalGeneration: "secret-generation",
  principalVersion: "secret-principal",
  revision: 1,
  scope: "account",
  windows: [
    {
      id: "primary",
      family: "codex",
      durationSeconds: 18000,
      usedPercent: 37.5,
      observedAt: "2026-10-22T10:00:00Z",
      resetAt: "2026-10-22T12:00:00Z",
      basis: "duration",
    },
  ],
};
describe.skipIf(process.env.RR_H_PERSONAL_SHARING_QUERIES_PG_TEST !== "1")(
  "account limits canonical database authorization",
  () => {
    it("resolves personal/organization/binding IDs and fences membership, reconnect and deletion during the cached read", async () => {
      const db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: disposableDatabase() }),
      });
      const prefix = `limits-${randomUUID()}`;
      const owner = `${prefix}-owner`,
        admin = `${prefix}-admin`,
        member = `${prefix}-member`,
        org = `${prefix}-org`,
        operator = `${prefix}-operator`,
        personalWorkspaceId = `${prefix}-personal-workspace`;
      try {
        await db.user.createMany({
          data: [owner, admin, member].map((id) => ({ id })),
        });
        await db.workspace.create({
          data: {
            id: org,
            slug: org,
            name: "TEST limits",
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
          data: {
            id: personalWorkspaceId,
            slug: personalWorkspaceId,
            name: "TEST personal",
            personalOwnerUserId: owner,
          },
        });
        await db.workspace.create({
          data: { id: operator, slug: operator, name: "TEST operator" },
        });
        const personal = await db.providerAccountConnection.create({
          data: {
            id: `${prefix}-personal`,
            ownerUserId: owner,
            gatewayAccountRef: `${prefix}-native-personal`,
            profileRef: "codex",
            displayName: "TEST",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const owned = await db.providerAccountConnection.create({
          data: {
            id: `${prefix}-owned`,
            ownerWorkspaceId: org,
            gatewayAccountRef: `${prefix}-native-org`,
            profileRef: "codex",
            displayName: "TEST",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const operated = await db.providerAccountConnection.create({
          data: {
            id: `${prefix}-operated`,
            ownerWorkspaceId: operator,
            gatewayAccountRef: `${prefix}-native-operator`,
            profileRef: "codex",
            displayName: "TEST",
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
          async (): Promise<AccountLimitsSourceResult> => snapshot,
        );
        const service = createAccountLimitsService({
          prisma: db,
          reader: { read },
          secret: "TEST-only-secret",
          operatorWorkspaceId: operator,
          authorize: async () => scope,
          ownerRef: (value) =>
            value.kind === "user"
              ? `u-${value.userId}`
              : `w-${value.workspaceId}`,
          now: () => new Date("2026-10-22T10:01:00Z"),
        });
        expect(await service.read(personal.id)).toMatchObject({
          status: "ok",
          value: { status: "snapshot", windows: [{ remainingPercent: 62.5 }] },
        });
        expect(read).toHaveBeenLastCalledWith({
          ownerRef: `u-${owner}`,
          accountRef: personal.gatewayAccountRef,
          profileId: "codex",
          expectedAuthorizationEpoch: 1,
        });
        scope = { userId: owner, workspaceId: org };
        for (const id of [personal.id, bindings[0]!.id]) {
          expect(await service.read(id)).toMatchObject({
            status: "ok",
            value: {
              status: "snapshot",
              windows: [{ remainingPercent: 62.5 }],
            },
          });
          expect(read).toHaveBeenLastCalledWith({
            ownerRef: `u-${owner}`,
            accountRef: personal.gatewayAccountRef,
            profileId: "codex",
            expectedAuthorizationEpoch: 1,
          });
        }
        // Personal ownership does not bypass the authorized workspace binding.
        const sharing = new PrismaPersonalAccountOperations(db);
        const revokedBindingId = bindings[0]!.id;
        read.mockClear();
        read.mockImplementationOnce(async () => {
          await sharing.detachRecipientBinding({
            actorUserId: owner,
            workspaceId: org,
            bindingId: revokedBindingId,
            expectedBindingRevision: bindings[0]!.revision,
          });
          return snapshot;
        });
        const revokedRead = await service.read(revokedBindingId);
        expect(read).toHaveBeenCalledOnce();
        const revokedBinding =
          await db.workspaceAccountBinding.findUniqueOrThrow({
            where: { id: revokedBindingId },
          });
        expect(revokedBinding).toMatchObject({
          state: "revoked",
          revision: 2,
          policyRevision: 2,
          pendingFencePolicySubject: revokedBindingId,
          pendingFencePolicyRevision: 2,
        });
        expect(revokedBinding.pendingFenceOperationId).not.toBeNull();
        expect(revokedRead).toEqual({ status: "denied" });
        read.mockClear();
        expect(await service.read(revokedBindingId)).toEqual({
          status: "denied",
        });
        expect(await service.read(personal.id)).toEqual({ status: "denied" });
        expect(read).not.toHaveBeenCalled();
        const accounts = new PrismaProviderAccountRepository(
          db,
          operator,
          true,
        );
        // Controlled Gateway ACK fixture: later lifecycle readiness requires
        // every persisted fence to be acknowledged, including revoked bindings.
        expect(
          await accounts.acknowledgeBindingFence({
            bindingId: revokedBindingId,
            workspaceId: org,
            operationId: revokedBinding.pendingFenceOperationId!,
            policySubject: revokedBindingId,
            policyRevision: revokedBinding.policyRevision,
          }),
        ).toBe(true);
        // Revoked personal bindings are terminal. Later scenarios use a fresh
        // disposable binding, leaving the old identity terminal.
        bindings[0] = await db.workspaceAccountBinding.create({
          data: {
            id: `${personal.id}-replacement-binding`,
            workspaceId: org,
            connectionId: personal.id,
            state: "active",
          },
        });
        scope = { userId: admin };
        read.mockClear();
        expect(await service.read(personal.id)).toEqual({ status: "denied" });
        expect(read).not.toHaveBeenCalled();
        scope = { userId: admin, workspaceId: org };
        expect(await service.read(owned.id)).toMatchObject({
          status: "ok",
          value: { status: "snapshot" },
        });
        read.mockClear();
        for (const id of [bindings[0]!.id, bindings[2]!.id, operated.id]) {
          const result = await service.read(id);
          expect(result).toMatchObject({
            status: "ok",
            value: { status: "restricted" },
          });
          expect(JSON.stringify(result)).not.toMatch(
            /native-|secret-generation|secret-principal|37.5/,
          );
        }
        expect(read).not.toHaveBeenCalled();
        scope = { userId: member, workspaceId: org };
        expect(await service.read(bindings[1]!.id)).toMatchObject({
          status: "ok",
          value: { status: "restricted" },
        });
        expect(await service.read(owned.id)).toMatchObject({
          status: "ok",
          value: { status: "restricted" },
        });
        expect(read).not.toHaveBeenCalled();
        scope = { userId: admin, workspaceId: org };
        read.mockImplementationOnce(async () => {
          await db.workspaceMember.deleteMany({
            where: { workspaceId: org, userId: admin },
          });
          return snapshot;
        });
        expect(await service.read(owned.id)).toEqual({ status: "denied" });
        scope = { userId: owner };
        read.mockImplementationOnce(async () => {
          await db.providerAccountConnection.update({
            where: { id: personal.id },
            data: {
              authorizationEpochMirror: 2n,
              metadataRevision: { increment: 1 },
            },
          });
          return snapshot;
        });
        expect(await service.read(personal.id)).toEqual({ status: "denied" });
        // Delete reservation changes the canonical pending lifetime before the native response returns.
        const operations = new PrismaAccountLifecycleOperations(db);
        let deletionId = "";
        read.mockImplementationOnce(async () => {
          const deletion = await operations.reserve({
            actorUserId: owner,
            clientOperationId: randomUUID(),
            sourceId: personal.id,
            action: "delete",
            personalWorkspaceId,
            owningWorkspaceId: null,
            expectedSourceMetadataRevision: 2,
            expectedGatewayRevision: 1,
            expectedAuthorizationEpoch: 2,
          });
          deletionId = deletion.id;
          return snapshot;
        });
        expect(await service.read(personal.id)).toEqual({ status: "denied" });
        read.mockClear();
        expect(await service.read(personal.id)).toMatchObject({
          status: "ok",
          value: { status: "unknown" },
        });
        expect(read).not.toHaveBeenCalled();
        expect(
          await db.providerAccountConnection.findUniqueOrThrow({
            where: { id: personal.id },
          }),
        ).toMatchObject({
          state: "pending",
          metadataRevision: 3,
          authorizationEpochMirror: 2n,
          pendingSourceOperationId: deletionId,
        });
        // The shared source must drain its exact binding fences before lifecycle
        // completion; these are controlled Gateway ACK fixtures, not native effects.
        for (const fence of await operations.listFences(owner, deletionId))
          expect(await accounts.acknowledgeBindingFence(fence)).toBe(true);
        expect((await operations.ready(owner, deletionId)).phase).toBe("ready");
        const claim = await operations.claim(owner, deletionId);
        expect(claim).not.toBeNull();
        if (!claim) throw new Error("limits_fixture_claim_required");
        expect(
          await operations.enterClaim(owner, deletionId, claim.claimToken),
        ).toBe(true);
        await operations.finalize(
          owner,
          deletionId,
          {
            accountRef: personal.gatewayAccountRef,
            profileId: "codex",
            displayName: "TEST",
            state: "tombstoned",
            metadataRevision: 2,
            authorizationEpoch: 3,
          },
          deletionId,
          {
            retirementOperationId: deletionId,
            bindingErasureProofRef: `${prefix}-binding-proof`,
            transportErasureProofRef: `${prefix}-transport-proof`,
            nativeErasureProofRef: `${prefix}-native-proof`,
          },
        );
        expect(await service.read(personal.id)).toEqual({ status: "denied" });
        expect(read).not.toHaveBeenCalled();
      } finally {
        await db.$disconnect();
      }
    }, 30000);
  },
);
