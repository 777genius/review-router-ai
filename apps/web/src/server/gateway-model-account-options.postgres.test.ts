import { describe, expect, it } from "vitest";
import type * as c from "@agent-teams/account-gateway/contracts";
import { PrismaPersonalAccountOperations } from "@reviewrouter/features-provider-accounts/synchronization";
import { createReviewActionV2E2EHarness } from "../../../../scripts/review-action-v2-production-e2e/support/review-action-v2-e2e-harness";
import { createGatewayModelAccountOptions } from "./gateway-model-account-options";

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
    throw new Error("models_explicit_disposable_loopback_required");
  return raw;
}

// Real local selection/membership reads + controlled SDK-shaped GET responses.
// Detects post-limit starvation, foreign discovery, member denial, fake remote
// counters, old-BX substitution and auth/source changes during the remote await.
describe.skipIf(process.env.RR_H_MODEL_ACCOUNT_OPTIONS_PG_TEST !== "1")(
  "member-authorized Models exact account options",
  () => {
    it("pages only eligible local bindings, keeps original IDs, and reauthorizes every GET", async () => {
      const harness =
        await createReviewActionV2E2EHarness(disposableDatabase());
      const { prisma: db, prefix, workspaceId: x } = harness;
      try {
        const u = `${prefix}-donor`,
          member = `${prefix}-member`,
          v = `${prefix}-other`;
        await db.user.createMany({
          data: [{ id: u }, { id: member }, { id: v }],
        });
        await db.workspaceMember.createMany({
          data: [
            { workspaceId: x, userId: u, role: "admin" },
            { workspaceId: x, userId: member, role: "member" },
            { workspaceId: x, userId: v, role: "member" },
          ],
        });
        const store = new PrismaPersonalAccountOperations(db);
        const p = await store.resolvePersonalWorkspace(u);
        await store.resolvePersonalWorkspace(v);
        const s = await db.workspace.create({
          data: { slug: `${prefix}-operator`, name: "Operator" },
        });
        const foreign = await db.workspace.create({
          data: { slug: `${prefix}-foreign`, name: "Foreign" },
        });
        const profile = "mimo-responses-v1";
        const personal = await db.providerAccountConnection.create({
          data: {
            ownerUserId: u,
            gatewayAccountRef: `${prefix}-personal-account`,
            profileRef: profile,
            displayName: "Personal",
            state: "active",
            authorizationEpochMirror: 7n,
          },
        });
        const own = await db.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: x,
            gatewayAccountRef: `${prefix}-org-account`,
            profileRef: profile,
            displayName: "Organization",
            state: "active",
          },
        });
        const operator = await db.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: s.id,
            gatewayAccountRef: `${prefix}-operator-account`,
            profileRef: profile,
            displayName: "Shared operator",
            state: "active",
          },
        });
        const pending = await db.providerAccountConnection.create({
          data: {
            ownerUserId: u,
            gatewayAccountRef: `${prefix}-pending`,
            profileRef: profile,
            displayName: "Pending",
            state: "pending",
            authorizationEpochMirror: 7n,
          },
        });
        const ineligible = await db.providerAccountConnection.create({
          data: {
            ownerUserId: v,
            gatewayAccountRef: `${prefix}-ineligible`,
            profileRef: profile,
            displayName: "Not donated by admin",
            state: "active",
            authorizationEpochMirror: 1n,
          },
        });
        const ungranted = await db.providerAccountConnection.create({
          data: {
            ownerWorkspaceId: foreign.id,
            gatewayAccountRef: `${prefix}-foreign-account`,
            profileRef: profile,
            displayName: "Foreign",
            state: "active",
          },
        });
        const bind = (id: string, connectionId: string, workspaceId = x) =>
          db.workspaceAccountBinding.create({
            data: {
              id: `${prefix}-${id}`,
              workspaceId,
              connectionId,
              state: "active",
            },
          });
        await bind("00-pending", pending.id);
        await bind("01-ineligible", ineligible.id);
        const foreignBinding = await bind("02-foreign", ungranted.id);
        const bx = await bind("10-personal", personal.id),
          bd = await bind("20-org", own.id),
          bs = await bind("30-operator", operator.id);
        const bp = await bind("personal-scope", personal.id, p);
        const remote = new Map<string, c.Account>();
        const ownerRef = (
          owner:
            | { kind: "user"; userId: string }
            | { kind: "workspace"; workspaceId: string },
        ) =>
          owner.kind === "user"
            ? `fixture-user-${owner.userId}`
            : `fixture-workspace-${owner.workspaceId}`;
        for (const source of [personal, own, operator])
          remote.set(source.gatewayAccountRef, {
            accountRef: source.gatewayAccountRef,
            ownerRef: ownerRef(
              source.ownerUserId
                ? { kind: "user", userId: source.ownerUserId }
                : { kind: "workspace", workspaceId: source.ownerWorkspaceId! },
            ),
            profileId: profile,
            displayName: source.displayName,
            state: "active",
            metadataRevision: 41,
            authorizationEpoch: 7,
          });
        let workspaceId = x,
          userId = member;
        let onGet: (() => Promise<void>) | undefined;
        let transform: ((account: c.Account) => c.Account) | undefined;
        const gets: string[] = [];
        const make = (
          enabled = true,
          configuredOperator: string | undefined = s.id,
        ) =>
          createGatewayModelAccountOptions({
            prisma: db,
            env: enabled
              ? { REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED: "1" }
              : {},
            ...(configuredOperator
              ? { operatorWorkspaceId: configuredOperator }
              : {}),
            profiles: [
              {
                id: profile,
                label: "MiMo",
                protocol: "openai-responses",
                models: ["mimo-v2-pro"],
                authKind: "api_key",
              },
            ],
            ownerRef,
            authorizeWorkspace: async () => ({
              workspaceId,
              actor: { userId },
            }),
            gateway: {
              async get(accountRef) {
                gets.push(accountRef);
                const effect = onGet;
                onGet = undefined;
                await effect?.();
                const account = remote.get(accountRef);
                if (!account)
                  throw new Error("foreign_gateway_discovery_forbidden");
                return transform ? transform({ ...account }) : { ...account };
              },
            },
          });
        const api = make();
        const first = await api.list({ limit: 1 });
        if (first.status !== "ok") throw new Error("models_first_page_failed");
        expect(first.value.accounts[0]).toMatchObject({
          origin: "personal",
          isOwnedByViewer: false,
          canManage: false,
          connectionId: bx.id,
          gatewayRevision: 41,
          mirrorRevision: 1,
          binding: { id: bx.id },
        });
        expect(first.value.nextCursor).toBe(bx.id);
        expect(gets).toEqual([personal.gatewayAccountRef]);
        userId = u;
        const ownedShared = await api.get(bx.id);
        expect(
          ownedShared.status === "ok" && ownedShared.value.account,
        ).toMatchObject({
          isOwnedByViewer: true,
          connectionId: bx.id,
          canManage: false,
        });
        userId = member;
        const exactOffPage = await api.get(bd.id);
        expect(
          exactOffPage.status === "ok" &&
            exactOffPage.value.account.binding?.id,
        ).toBe(bd.id);
        expect(
          exactOffPage.status === "ok" && exactOffPage.value.account.canManage,
        ).toBe(false);
        const second = await api.list({
          afterBindingId: first.value.nextCursor!,
          limit: 1,
        });
        expect(
          second.status === "ok" && second.value.accounts[0]?.binding?.id,
        ).toBe(bd.id);
        const operatorRow = await api.get(bs.id);
        expect(
          operatorRow.status === "ok" && operatorRow.value.account,
        ).toMatchObject({
          origin: "operator",
          connectionId: bs.id,
          canManage: false,
        });
        for (const forbidden of [
          personal.id,
          operator.id,
          personal.gatewayAccountRef,
          remote.get(personal.gatewayAccountRef)!.ownerRef,
          u,
        ]) {
          expect(JSON.stringify(first)).not.toContain(forbidden);
          expect(JSON.stringify(operatorRow)).not.toContain(forbidden);
        }
        const disabled = await make(false).list({ limit: 1 });
        expect(
          disabled.status === "ok" && disabled.value.accounts[0]?.binding?.id,
        ).toBe(bd.id);
        const beforeDenied = gets.length;
        expect((await api.get(foreignBinding.id)).status).toBe("denied");
        expect((await make(true, "").get(bs.id)).status).toBe("denied");
        expect(gets).toHaveLength(beforeDenied);
        for (const limit of [0, 101, 1.5])
          expect((await api.list({ limit })).status).toBe("invalid");
        expect((await api.get("bad/id")).status).toBe("invalid");
        workspaceId = p;
        userId = v;
        expect((await api.get(bp.id)).status).toBe("denied");
        userId = u;
        const ownP = await api.get(bp.id);
        expect(ownP.status === "ok" && ownP.value.account).toMatchObject({
          origin: "personal",
          isOwnedByViewer: true,
          connectionId: personal.id,
          canManage: true,
        });
        workspaceId = x;
        userId = member;
        transform = (account) => ({ ...account, ownerRef: "wrong-owner" });
        expect((await api.get(bx.id)).status).toBe("denied");
        transform = (account) => ({
          ...account,
          profileId: "different-profile",
        });
        expect((await api.get(bx.id)).status).toBe("denied");
        transform = (account) => ({ ...account, authorizationEpoch: 8 });
        expect((await api.get(bx.id)).status).toBe("denied");
        transform = (account) =>
          account.accountRef === personal.gatewayAccountRef
            ? { ...account, authorizationEpoch: 8 }
            : account;
        const drifted = await api.list({ limit: 2 });
        expect(drifted.status).toBe("ok");
        if (drifted.status !== "ok")
          throw new Error("drifted_row_poisoned_page");
        expect(drifted.value.accounts.map((row) => row.binding?.id)).toEqual([
          bd.id,
        ]);
        expect(drifted.value.profiles[0]?.id).toBe(profile);
        expect(drifted.value.nextCursor).toBe(bd.id);
        const emptyFirst = await api.list({ limit: 1 });
        expect(emptyFirst.status === "ok" && emptyFirst.value.accounts).toEqual(
          [],
        );
        expect(emptyFirst.status === "ok" && emptyFirst.value.nextCursor).toBe(
          bx.id,
        );
        transform = undefined;
        onGet = async () => {
          throw new Error("synthetic_gateway_outage");
        };
        expect((await api.list({ limit: 2 })).status).toBe("unavailable");
        // A scope change on the second lookup must discard the already valid first row.
        onGet = async () => {
          onGet = async () => {
            userId = u;
          };
        };
        expect((await api.list({ limit: 2 })).status).toBe("denied");
        userId = member;
        onGet = async () => {
          userId = u;
        };
        expect((await api.get(bx.id)).status).toBe("denied");
        userId = member;
        const membership = await db.workspaceMember.findUniqueOrThrow({
          where: { workspaceId_userId: { workspaceId: x, userId: member } },
        });
        onGet = () =>
          store.changeEligibility({
            actorUserId: u,
            workspaceId: x,
            memberId: membership.id,
            userId: member,
            expectedRole: "member",
            nextRole: null,
          });
        expect((await api.get(bx.id)).status).toBe("denied");
        await db.workspaceMember.create({
          data: { workspaceId: x, userId: member, role: "member" },
        });
        onGet = () =>
          store
            .revoke({
              actorUserId: u,
              personalWorkspaceId: p,
              action: "revoke",
              clientOperationId: `${prefix}-retire-old`,
              sourceId: personal.id,
              targetWorkspaceId: x,
              expectedSourceMetadataRevision: 1,
              expectedGatewayRevision: 41,
              bindingId: bx.id,
              expectedBindingRevision: 1,
            })
            .then(() => undefined);
        const retiredPage = await api.list({ limit: 2 });
        expect(
          retiredPage.status === "ok" &&
            retiredPage.value.accounts.map((row) => row.binding?.id),
        ).toEqual([bd.id]);
        // Consumption fixture only: C2's separate PG suite owns attach/ACK
        // issuance. Even another active ID must never replace this retired pin.
        const successor = await bind("40-personal-successor", personal.id);
        const callsBeforeOld = gets.length;
        expect((await api.get(bx.id)).status).toBe("denied");
        expect(gets).toHaveLength(callsBeforeOld);
        expect((await api.get(successor.id)).status).toBe("ok");
        onGet = async () => {
          await db.providerAccountConnection.update({
            where: { id: personal.id },
            data: { state: "pending", metadataRevision: { increment: 1 } },
          });
        };
        expect((await api.get(successor.id)).status).toBe("denied");
      } finally {
        await harness.close();
      }
    }, 120_000);
  },
);
