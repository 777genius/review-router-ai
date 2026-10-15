import { describe, expect, it } from "vitest";
import { PrismaProviderAccountRepository } from "@reviewrouter/features-provider-accounts";
import {
  snapshotPersonalIntent,
  personalIntentDigest,
  personalOperationId,
} from "@reviewrouter/features-provider-accounts/synchronization";
import { PrismaPersonalAccountOperations } from "../../../../packages/features/provider-accounts/src/infrastructure/prisma/prisma-personal-account-operations";
import { createReviewActionV2E2EHarness } from "../../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import { PrismaPersonalAccountSharingQueries } from "./personal-account-sharing-queries";

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
    throw new Error("personal_sharing_queries_disposable_loopback_required");
  return raw;
}

// Actual migrated RR DB: foreign catalog access, post-role/deletion label leaks,
// filters applied after pagination and unsafe/consumed predecessor hints go red.
// No Gateway/provider calls; ACKs below are explicit synthetic fixture facts.
describe.skipIf(process.env.RR_H_PERSONAL_SHARING_QUERIES_PG_TEST !== "1")(
  "personal sharing recipient read queries",
  () => {
    it("projects own scoped history and current eligible org pages without reviving lineage", async () => {
      const harness =
        await createReviewActionV2E2EHarness(disposableDatabase());
      const { prisma: db, prefix } = harness;
      try {
        const u = `${prefix}-u`,
          v = `${prefix}-v`,
          admin = `${prefix}-admin`;
        await db.user.createMany({
          data: [{ id: u }, { id: v }, { id: admin }],
        });
        const store = new PrismaPersonalAccountOperations(db);
        const p = await store.resolvePersonalWorkspace(u);
        const vp = await store.resolvePersonalWorkspace(v);
        const queries = new PrismaPersonalAccountSharingQueries(db);
        const accounts = new PrismaProviderAccountRepository(db);
        const org = async (
          suffix: string,
          role?: "owner" | "admin" | "member",
        ) => {
          const workspace = await db.workspace.create({
            data: {
              id: `${prefix}-${suffix}`,
              slug: `${prefix}-${suffix}`,
              name: `Organization ${suffix}`,
            },
          });
          if (role)
            await db.workspaceMember.create({
              data: { workspaceId: workspace.id, userId: u, role },
            });
          return workspace;
        };
        await org("0-nonmember");
        await org("0-member", "member");
        const x = await org("1-X", "admin"),
          y = await org("2-Y", "owner");
        const z = await org("3-deleted", "admin"),
          history = await org("4-history", "admin");
        const unissued = await org("5-unissued", "admin"),
          pending = await org("6-pending", "admin");
        await db.workspaceMember.create({
          data: { workspaceId: x.id, userId: admin, role: "owner" },
        });
        const source = await db.providerAccountConnection.create({
          data: {
            ownerUserId: u,
            gatewayAccountRef: `${prefix}-never-public`,
            profileRef: "mimo-responses-v1",
            displayName: "Own source",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const foreign = await db.providerAccountConnection.create({
          data: {
            ownerUserId: v,
            gatewayAccountRef: `${prefix}-foreign-secret-ref`,
            profileRef: "mimo-responses-v1",
            displayName: "Foreign source",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const extra = await db.providerAccountConnection.create({
          data: {
            ownerUserId: u,
            gatewayAccountRef: `${prefix}-extra`,
            profileRef: "mimo-responses-v1",
            displayName: "Second own source",
            state: "pending",
          },
        });
        await db.workspaceAccountBinding.createMany({
          data: [
            { workspaceId: p, connectionId: source.id, state: "active" },
            { workspaceId: vp, connectionId: foreign.id, state: "active" },
          ],
        });
        let sequence = 0;
        const intent = (workspaceId: string) => ({
          actorUserId: u,
          personalWorkspaceId: p,
          sourceId: source.id,
          targetWorkspaceId: workspaceId,
          expectedSourceMetadataRevision: 1,
          expectedGatewayRevision: 1,
          clientOperationId: `${prefix}-operation-${++sequence}`,
        });
        const attach = async (
          workspaceId: string,
          predecessorBindingId: string | null = null,
          expectedPredecessorRevision: number | null = null,
        ) => {
          const result = await store.attach({
            ...intent(workspaceId),
            action: "attach",
            predecessorBindingId,
            expectedPredecessorRevision,
          });
          if (!result.binding) throw new Error("query_fixture_binding_missing");
          return result.binding;
        };
        const revoke = (binding: {
          id: string;
          workspaceId: string;
          revision: number;
        }) =>
          store.revoke({
            ...intent(binding.workspaceId),
            action: "revoke",
            bindingId: binding.id,
            expectedBindingRevision: binding.revision,
          });
        const ack = async (bindingId: string, workspaceId: string) => {
          const selection = await accounts.findBinding({
            bindingId,
            workspaceId,
          });
          if (!selection?.binding.pendingFence)
            throw new Error("query_fixture_fence_missing");
          expect(
            await accounts.acknowledgeBindingFence({
              bindingId,
              workspaceId,
              ...selection.binding.pendingFence,
            }),
          ).toBe(true);
        };
        const bx = await attach(x.id),
          by = await attach(y.id),
          bz = await attach(z.id);
        await db.workspace.update({
          where: { id: z.id },
          data: {
            deletionState: "delete_pending",
            deletionRevision: { increment: 1 },
          },
        });
        // A valid root issued ahead of wall time represents a later backward
        // clock step. Immutable createdAt is supplied on INSERT, never bypassed.
        const original = await db.workspaceAccountBinding.create({
          data: {
            workspaceId: history.id,
            connectionId: source.id,
            state: "active",
            createdAt: new Date(Date.now() + 3_600_000),
          },
        });
        const rootIntent = snapshotPersonalIntent({
          ...intent(history.id),
          action: "attach",
          predecessorBindingId: null,
          expectedPredecessorRevision: null,
        });
        await db.personalAccountOperation.create({
          data: {
            ...rootIntent,
            id: personalOperationId(u, rootIntent.clientOperationId),
            normalizedIntentHash: personalIntentDigest(rootIntent),
            expectedGatewayRevision: 1n,
            phase: "applied",
            resultSourceId: source.id,
            resultBindingId: original.id,
          },
        });
        await revoke(original);
        const awaiting = await attach(pending.id);
        await revoke(awaiting);
        const raw = await db.workspaceAccountBinding.create({
          data: {
            workspaceId: unissued.id,
            connectionId: source.id,
            state: "active",
          },
        });
        await revoke(raw);
        await ack(raw.id, unissued.id);
        const own = { actorUserId: u, sourceId: source.id };
        const organizationPage = () =>
          queries.listEligibleOrganizations({
            actorUserId: u,
            sourceIds: [source.id, extra.id],
          });
        expect(
          (await organizationPage()).items.map((row) => row.workspaceId),
        ).toEqual([x.id, y.id, history.id, unissued.id, pending.id]);
        expect(
          (await organizationPage()).items.every(
            (row) => row.predecessors === undefined,
          ),
        ).toBe(true);
        await ack(original.id, history.id);
        expect(
          (await organizationPage()).items.find(
            (row) => row.workspaceId === history.id,
          )?.predecessors,
        ).toEqual([
          {
            sourceId: source.id,
            bindingId: original.id,
            revision: original.revision + 1,
          },
        ]);
        expect(
          (await organizationPage()).items.find(
            (row) => row.workspaceId === unissued.id,
          )?.predecessors,
        ).toBeUndefined();
        const successor = await attach(
          history.id,
          original.id,
          original.revision + 1,
        );
        const successorRow = await db.workspaceAccountBinding.findUniqueOrThrow(
          { where: { id: successor.id } },
        );
        expect(original.createdAt.getTime()).toBeGreaterThan(
          successorRow.createdAt.getTime(),
        );
        expect(
          (await organizationPage()).items.find(
            (row) => row.workspaceId === history.id,
          )?.predecessors,
        ).toBeUndefined();
        await revoke(successor);
        await ack(successor.id, history.id);
        expect(
          (await organizationPage()).items.find(
            (row) => row.workspaceId === history.id,
          )?.predecessors,
        ).toEqual([
          {
            sourceId: source.id,
            bindingId: successor.id,
            revision: successor.revision + 1,
          },
        ]);

        const first = await queries.listEligibleOrganizations({
          actorUserId: u,
          sourceIds: [source.id],
          limit: 1,
        });
        expect(first.items.map((row) => row.workspaceId)).toEqual([x.id]);
        expect(first.nextAfterId).toBe(x.id);
        expect(
          (
            await queries.listEligibleOrganizations({
              actorUserId: u,
              sourceIds: [source.id],
              afterWorkspaceId: first.nextAfterId!,
              limit: 1,
            })
          ).items[0]?.workspaceId,
        ).toBe(y.id);
        const seen: string[] = [];
        let cursor: string | undefined;
        do {
          const current = await queries.listOwnOrgBindings({
            ...own,
            ...(cursor ? { afterBindingId: cursor } : {}),
            limit: 1,
          });
          seen.push(...current.items.map((row) => row.bindingId));
          cursor = current.nextAfterId ?? undefined;
        } while (cursor);
        const all = await queries.listOwnOrgBindings(own);
        expect(seen).toEqual(all.items.map((row) => row.bindingId));
        expect(all.items).toHaveLength(7);
        expect(all.items.find((row) => row.bindingId === bz.id)).toMatchObject({
          organizationLabel: null,
          canRevoke: true,
        });
        expect(all.items.find((row) => row.bindingId === by.id)).toMatchObject({
          organizationLabel: y.name,
          remoteFenceDelivery: "not_required",
          canRevoke: true,
        });
        expect(
          all.items.find((row) => row.bindingId === awaiting.id),
        ).toMatchObject({
          remoteFenceDelivery: "remote_pending",
          canRevoke: false,
        });
        expect(
          all.items.find((row) => row.bindingId === successor.id),
        ).toMatchObject({
          remoteFenceDelivery: "remote_applied",
          canRevoke: false,
        });
        expect(
          all.items.every(
            (row) =>
              row.targetWorkspaceId !== p && row.targetWorkspaceId !== vp,
          ),
        ).toBe(true);
        expect(Object.keys(all.items[0]!).sort()).toEqual(
          [
            "bindingId",
            "sourceId",
            "targetWorkspaceId",
            "organizationLabel",
            "revision",
            "state",
            "remoteFenceDelivery",
            "canRevoke",
          ].sort(),
        );
        expect(JSON.stringify(all)).not.toContain(source.gatewayAccountRef);
        for (const sourceIds of [[foreign.id], [source.id, foreign.id]]) {
          await expect(
            queries.listEligibleOrganizations({ actorUserId: u, sourceIds }),
          ).rejects.toMatchObject({ code: "connection_unavailable" });
        }
        await expect(
          queries.listOwnOrgBindings({ actorUserId: u, sourceId: foreign.id }),
        ).rejects.toMatchObject({ code: "connection_unavailable" });
        for (const limit of [0, 101, 1.5])
          await expect(
            queries.listOwnOrgBindings({ ...own, limit }),
          ).rejects.toMatchObject({ code: "invalid_input" });
        await expect(
          queries.listEligibleOrganizations({
            actorUserId: u,
            sourceIds: Array.from({ length: 101 }, (_, i) => `source-${i}`),
          }),
        ).rejects.toMatchObject({ code: "invalid_input" });
        const member = await db.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: x.id, userId: u } },
        });
        await store.changeEligibility({
          actorUserId: admin,
          workspaceId: x.id,
          memberId: member.id,
          userId: u,
          expectedRole: "admin",
          nextRole: "member",
        });
        expect(
          (await queries.listOwnOrgBindings(own)).items.find(
            (row) => row.bindingId === bx.id,
          ),
        ).toMatchObject({
          organizationLabel: null,
          state: "revoked",
          remoteFenceDelivery: "remote_pending",
          canRevoke: false,
        });
        expect(
          (await organizationPage()).items.some(
            (row) => row.workspaceId === x.id,
          ),
        ).toBe(false);
      } finally {
        // Immutable grant/receipt rows stay in the disposable cluster for proof.
        await harness.close();
      }
    }, 120_000);
  },
);
