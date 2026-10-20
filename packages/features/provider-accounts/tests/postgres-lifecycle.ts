import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  submitAccountLifecycle,
  type AccountLifecycleDependencies,
} from "../src/application/use-cases/account-lifecycle";
import { personalOperationId } from "../src/application/use-cases/personal-account-operations";
import type { TestContext } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaAccountLifecycleOperations } from "../src/infrastructure/prisma/prisma-account-lifecycle-operations";
import { PrismaProviderAccountRepository } from "../src/infrastructure/prisma/prisma-provider-account-repository";
import { PrismaPersonalAccountOperations } from "../src/infrastructure/prisma/prisma-personal-account-operations";
import type { AccountLifecycleIntent } from "../src/domain/account-lifecycle";
import { ProviderAccountError } from "../src/domain/provider-account";

const sqlRefusal =
  (marker: string) =>
  (error: unknown): boolean =>
    error instanceof Error &&
    (error.message.includes(marker) || JSON.stringify(error).includes(marker));

/** Real migrated DB assertions. No replacement authority or bypassed triggers. */
export async function runAccountLifecyclePostgresTests(
  t: TestContext,
  db: PrismaClient,
) {
  const store = new PrismaAccountLifecycleOperations(db);
  const legacy = new PrismaPersonalAccountOperations(db);
  const fences = new PrismaProviderAccountRepository(db);
  async function ready(actor: string, id: string) {
    let after: string | undefined;
    for (;;) {
      const page = await store.listFences(actor, id, after);
      for (const fence of page)
        assert.equal(await fences.acknowledgeBindingFence(fence), true);
      if (!page.length) break;
      after = page.at(-1)!.bindingId;
    }
    return store.ready(actor, id);
  }
  async function fixture() {
    const userId = `lifecycle-${randomUUID()}`;
    await db.user.create({ data: { id: userId } });
    const personalWorkspaceId = await legacy.resolvePersonalWorkspace(userId);
    const sourceId = `source-${randomUUID()}`,
      nonce = randomUUID();
    const account = {
      accountRef: `account-${randomUUID()}`,
      profileId: "fixture-profile",
      displayName: "Lifecycle",
      state: "active",
      metadataRevision: 4,
      authorizationEpoch: 7,
    };
    await legacy.reserveConnect({
      action: "connect",
      actorUserId: userId,
      clientOperationId: nonce,
      personalWorkspaceId,
      proposedSourceId: sourceId,
      profileId: account.profileId,
      displayName: account.displayName,
      ingress: "api-key-create",
    });
    await legacy.claimConnect(userId, nonce);
    await legacy.finalizeConnect(userId, nonce, account);
    const request: AccountLifecycleIntent = {
      actorUserId: userId,
      clientOperationId: randomUUID(),
      personalWorkspaceId,
      owningWorkspaceId: null,
      sourceId,
      action: "suspend",
      expectedSourceMetadataRevision: 1,
      expectedGatewayRevision: 4,
      expectedAuthorizationEpoch: 7,
    };
    return { userId, sourceId, account, request };
  }
  await t.test(
    "lifecycle CAS has one winner across distinct nonces and preserves exact replay",
    async () => {
      const f = await fixture();
      const race = await Promise.allSettled([
        store.reserve(f.request),
        store.reserve({ ...f.request, clientOperationId: randomUUID() }),
      ]);
      assert.equal(
        race.filter((result) => result.status === "fulfilled").length,
        1,
      );
      const winner = race.find((result) => result.status === "fulfilled");
      assert.ok(winner?.status === "fulfilled");
      const original = await store.reserve(winner.value.intent);
      assert.equal(original.id, winner.value.id);
      assert.equal(original.source.state, "pending");
      await assert.rejects(
        store.reserve({ ...winner.value.intent, action: "delete" }),
        (error) =>
          error instanceof ProviderAccountError &&
          error.code === "operation_conflict",
      );
      await ready(f.userId, original.id);
      const claims = await Promise.all([
        store.ready(f.userId, original.id),
        store.ready(f.userId, original.id),
      ]);
      assert.ok(claims.every((row) => row.phase === "ready"));
      const submitted = await Promise.all([
        store.claim(f.userId, original.id),
        store.claim(f.userId, original.id),
      ]);
      assert.equal(submitted.filter(Boolean).length, 1);
    },
  );
  await t.test(
    "exact no-effect rejection releases own reservation with increasing revisions",
    async () => {
      const f = await fixture();
      const operation = await store.reserve(f.request);
      await ready(f.userId, operation.id);
      await store.claim(f.userId, operation.id);
      const recovered = await store.reject(
        f.userId,
        operation.id,
        f.account,
        "exact-no-effect-proof",
      );
      assert.equal(recovered.phase, "rejected");
      assert.equal(recovered.source.state, "active");
      assert.equal(recovered.source.pendingSourceOperationId, null);
      assert.equal(recovered.source.metadataRevision, 3);
      assert.equal(recovered.source.authorizationEpochMirror, 7);
      const next = await store.reserve({
        ...f.request,
        clientOperationId: randomUUID(),
        expectedSourceMetadataRevision: 3,
      });
      assert.equal(next.source.pendingSourceOperationId, next.id);
    },
  );
  await t.test(
    "delete stays denied after rejection and delayed active synchronization",
    async () => {
      const f = await fixture();
      const operation = await store.reserve({ ...f.request, action: "delete" });
      await ready(f.userId, operation.id);
      await store.claim(f.userId, operation.id);
      const rejected = await store.reject(
        f.userId,
        operation.id,
        f.account,
        "exact-delete-no-effect",
      );
      assert.equal(rejected.source.pendingSourceOperationId, operation.id);
      await assert.rejects(
        store.reserve({
          ...f.request,
          clientOperationId: randomUUID(),
          action: "resume",
          expectedSourceMetadataRevision: 2,
        }),
      );
      await assert.rejects(
        db.providerAccountConnection.update({
          where: { id: f.sourceId },
          data: {
            state: "active",
            pendingSourceOperationId: null,
            metadataRevision: { increment: 1 },
          },
        }),
      );
      assert.equal(
        (await store.read(f.userId, operation.id)).source.state,
        "pending",
      );
    },
  );
  await t.test(
    "suspend fences every grant beyond first page and resume preserves revoked identity",
    async () => {
      const f = await fixture();
      const grants = [];
      for (let index = 0; index < 101; index++) {
        const workspace = await db.workspace.create({
          data: { slug: `lifecycle-page-${randomUUID()}`, name: "Grant" },
        });
        await db.workspaceMember.create({
          data: { workspaceId: workspace.id, userId: f.userId, role: "admin" },
        });
        const grant = await legacy.attach({
          action: "attach",
          actorUserId: f.userId,
          clientOperationId: randomUUID(),
          personalWorkspaceId: f.request.personalWorkspaceId!,
          sourceId: f.sourceId,
          targetWorkspaceId: workspace.id,
          expectedSourceMetadataRevision: 1,
          expectedGatewayRevision: 4,
          predecessorBindingId: null,
          expectedPredecessorRevision: null,
        });
        assert.ok(grant.binding);
        grants.push(grant.binding!);
      }
      const suspension = await store.reserve(f.request);
      const page = await store.listFences(f.userId, suspension.id);
      assert.equal(page.length, 100);
      const tail = await store.listFences(
        f.userId,
        suspension.id,
        page.at(-1)!.bindingId,
      );
      assert.equal(tail.length, 2); // Includes the personal scope.
      assert.equal(
        (await store.ready(f.userId, suspension.id)).phase,
        "fencing",
      );
      await ready(f.userId, suspension.id);
      await store.claim(f.userId, suspension.id);
      const suspended = await store.finalize(
        f.userId,
        suspension.id,
        {
          ...f.account,
          state: "suspended",
          metadataRevision: 5,
          authorizationEpoch: 8,
        },
        null,
        null,
      );
      assert.equal(suspended.source.state, "suspended");
      assert.equal(
        await db.workspaceAccountBinding.count({
          where: { connectionId: f.sourceId, state: "active" },
        }),
        102,
      );
      const first = await db.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: grants[0]!.id },
      });
      await legacy.revoke({
        action: "revoke",
        actorUserId: f.userId,
        clientOperationId: randomUUID(),
        personalWorkspaceId: f.request.personalWorkspaceId!,
        sourceId: f.sourceId,
        targetWorkspaceId: first.workspaceId,
        bindingId: first.id,
        expectedBindingRevision: first.revision,
        expectedSourceMetadataRevision: suspended.source.metadataRevision,
        expectedGatewayRevision: 5,
      });
      // Its exact revocation fence must be ACKed; resume does not overwrite it.
      const revoked = await db.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: first.id },
      });
      assert.ok(revoked.pendingFenceOperationId);
      await fences.acknowledgeBindingFence({
        bindingId: revoked.id,
        workspaceId: revoked.workspaceId,
        operationId: revoked.pendingFenceOperationId!,
        policySubject: revoked.pendingFencePolicySubject!,
        policyRevision: revoked.pendingFencePolicyRevision!,
      });
      const resume = await store.reserve({
        ...f.request,
        action: "resume",
        clientOperationId: randomUUID(),
        expectedSourceMetadataRevision: suspended.source.metadataRevision,
        expectedGatewayRevision: 5,
        expectedAuthorizationEpoch: 8,
      });
      await ready(f.userId, resume.id);
      await store.claim(f.userId, resume.id);
      await store.finalize(
        f.userId,
        resume.id,
        {
          ...f.account,
          state: "active",
          metadataRevision: 6,
          authorizationEpoch: 9,
        },
        null,
        null,
      );
      const retained = await db.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: first.id },
      });
      assert.equal(retained.state, "revoked");
      assert.equal(
        retained.fenceAckPolicyRevision,
        revoked.pendingFencePolicyRevision,
      );
      assert.equal(
        await db.workspaceAccountBinding.count({
          where: { connectionId: f.sourceId, state: "active" },
        }),
        101,
      );
    },
  );
  await t.test(
    "lifecycle SQL rejects NULL owner authority, legacy shape escape and proof tampering",
    async () => {
      const f = await fixture();
      const operation = await store.reserve({ ...f.request, action: "delete" });
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: operation.id },
          data: { personalWorkspaceId: null },
        }),
      );
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: operation.id },
          data: { expectedGatewayRevision: 999n },
        }),
      );
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: operation.id },
          data: {
            action: "connect",
            owningWorkspaceId: f.request.personalWorkspaceId,
          },
        }),
      );
      await assert.rejects(
        db.providerAccountConnection.update({
          where: { id: f.sourceId },
          data: {
            pendingSourceOperationId: null,
            state: "active",
            metadataRevision: { increment: 1 },
          },
        }),
      );
      await assert.rejects(
        db.personalAccountOperation.delete({ where: { id: operation.id } }),
      );
      await ready(f.userId, operation.id);
      await store.claim(f.userId, operation.id);
      const account = {
        ...f.account,
        state: "disabled",
        metadataRevision: 5,
        authorizationEpoch: 8,
      };
      assert.equal(
        (
          await store.finalize(
            f.userId,
            operation.id,
            account,
            "exact-retirement",
            null,
          )
        ).phase,
        "unknown",
      );
      assert.ok(
        (
          await legacy.listOwnedSources({ actorUserId: f.userId, limit: 1 })
        ).some((row) => row.id === f.sourceId),
      );
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: operation.id },
          data: { deleteRemoteRetirementProofRef: "different-retirement" },
        }),
      );
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: operation.id },
          data: { phase: "applied", resultSourceId: f.sourceId },
        }),
      );
      const closed = await store.finalize(
        f.userId,
        operation.id,
        account,
        "exact-retirement",
        {
          retirementOperationId: "exact-retirement",
          bindingErasureProofRef: "binding-proof",
          transportErasureProofRef: "transport-proof",
          nativeErasureProofRef: "native-proof",
        },
      );
      assert.equal(closed.phase, "applied");
      assert.equal(closed.source.pendingSourceOperationId, operation.id);
      assert.equal(
        (await legacy.listOwnedSources({ actorUserId: f.userId, limit: 1 }))
          .length,
        0,
      );
      const survivorId = `zz-source-${randomUUID()}`,
        survivorNonce = randomUUID();
      await legacy.reserveConnect({
        action: "connect",
        actorUserId: f.userId,
        clientOperationId: survivorNonce,
        personalWorkspaceId: f.request.personalWorkspaceId!,
        proposedSourceId: survivorId,
        profileId: f.account.profileId,
        displayName: "Legacy disabled remains",
        ingress: "api-key-create",
      });
      await legacy.claimConnect(f.userId, survivorNonce);
      await legacy.finalizeConnect(f.userId, survivorNonce, {
        ...f.account,
        accountRef: `survivor-account-${randomUUID()}`,
        displayName: "Legacy disabled remains",
      });
      await db.providerAccountConnection.update({
        where: { id: survivorId },
        data: { state: "disabled", metadataRevision: { increment: 1 } },
      });
      assert.deepEqual(
        (
          await legacy.listOwnedSources({ actorUserId: f.userId, limit: 1 })
        ).map((row) => row.id),
        [survivorId],
      );
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: operation.id },
          data: { deleteNativeErasureProofRef: "tampered-proof" },
        }),
      );
      await assert.rejects(
        db.providerAccountConnection.update({
          where: { id: f.sourceId },
          data: {
            pendingSourceOperationId: null,
            state: "active",
            metadataRevision: { increment: 1 },
          },
        }),
      );
      const legacyOperation =
        await db.personalAccountOperation.findFirstOrThrow({
          where: {
            sourceId: null,
            proposedSourceId: f.sourceId,
            action: "connect",
          },
        });
      await assert.rejects(
        db.personalAccountOperation.update({
          where: { id: legacyOperation.id },
          data: {
            personalWorkspaceId: null,
            owningWorkspaceId: f.request.personalWorkspaceId,
          },
        }),
      );
    },
  );
  await t.test(
    "org operation readback follows current admin rather than original actor",
    async () => {
      const suffix = randomUUID(),
        a = `org-a-${suffix}`,
        b = `org-b-${suffix}`;
      await db.user.createMany({ data: [{ id: a }, { id: b }] });
      const workspace = await db.workspace.create({
        data: { slug: `lifecycle-org-${suffix}`, name: "Lifecycle org" },
      });
      await db.workspaceMember.createMany({
        data: [
          { workspaceId: workspace.id, userId: a, role: "owner" },
          { workspaceId: workspace.id, userId: b, role: "admin" },
        ],
      });
      const source = await db.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspace.id,
          gatewayAccountRef: `org-account-${suffix}`,
          displayName: "Org lifecycle",
          profileRef: "fixture-profile",
          state: "active",
          authorizationEpochMirror: 7n,
        },
      });
      const request: AccountLifecycleIntent = {
        actorUserId: a,
        clientOperationId: randomUUID(),
        personalWorkspaceId: null,
        owningWorkspaceId: workspace.id,
        sourceId: source.id,
        action: "suspend",
        expectedSourceMetadataRevision: 1,
        expectedGatewayRevision: 4,
        expectedAuthorizationEpoch: 7,
      };
      const outsider = `outsider-${suffix}`;
      await db.user.create({ data: { id: outsider } });
      const badNonce = randomUUID(),
        badId = personalOperationId(outsider, badNonce);
      const invalid = {
        id: badId,
        actorUserId: outsider,
        clientOperationId: badNonce,
        action: "suspend",
        personalWorkspaceId: null,
        owningWorkspaceId: workspace.id,
        originalOperationId: badId,
        sourceId: source.id,
        normalizedIntentHash: "0".repeat(64),
        expectedSourceMetadataRevision: 1,
        expectedGatewayRevision: 4n,
        expectedAuthorizationEpoch: 7n,
        phase: "fencing",
      };
      await assert.rejects(
        db.personalAccountOperation.create({ data: invalid }),
        sqlRefusal("lifecycle_owner_scope"),
      );
      await assert.rejects(
        db.personalAccountOperation.create({
          data: { ...invalid, owningWorkspaceId: null },
        }),
        sqlRefusal("workspace_deletion_admission_denied"),
      );
      const operation = await store.reserve(request);
      let authorizations = 0,
        posts = 0;
      const gateway: AccountLifecycleDependencies["gateway"] = {
        preflight: async () => {},
        submit: async () => {
          posts++;
        },
        read: async (command) => ({
          command,
          state: "applied",
          account: {
            accountRef: source.gatewayAccountRef,
            profileId: "fixture-profile",
            displayName: "Org lifecycle",
            state: "suspended",
            metadataRevision: 5,
            authorizationEpoch: 8,
          },
          retirementOperationId: null,
          closure: null,
          noEffectProofRef: null,
        }),
      };
      await assert.rejects(
        submitAccountLifecycle(a, operation.id, {
          store,
          gateway,
          authorize: async () => {
            if (++authorizations === 3) {
              await db.workspaceMember.update({
                where: {
                  workspaceId_userId: { workspaceId: workspace.id, userId: a },
                },
                data: { role: "member" },
              });
              throw new ProviderAccountError("workspace_forbidden");
            }
          },
        }),
      );
      assert.equal(
        posts,
        0,
        "no Gateway entry occurred before authorization failed",
      );
      await assert.rejects(store.read(a, operation.id));
      const released = await store.read(b, operation.id);
      assert.equal(released.phase, "fencing");
      assert.equal(released.source.pendingSourceOperationId, operation.id);
      assert.equal(released.source.metadataRevision, 2);
      const applied = await submitAccountLifecycle(b, operation.id, {
        store,
        gateway,
        authorize: async () => {},
      });
      assert.equal(applied.phase, "applied");
      assert.equal(applied.id, operation.id);
      assert.equal(applied.intent.actorUserId, a);
      assert.equal(posts, 1);
      const resumed = await store.reserve({
        ...request,
        actorUserId: b,
        clientOperationId: randomUUID(),
        action: "resume",
        expectedSourceMetadataRevision: 3,
        expectedGatewayRevision: 5,
        expectedAuthorizationEpoch: 8,
      });
      await store.ready(b, resumed.id);
      const claim = await store.claim(b, resumed.id);
      assert.ok(claim);
      assert.match(claim.claimToken, /^[a-f0-9-]{36}$/);
      assert.equal(
        await store.releaseUnenteredClaim(b, resumed.id, "wrong-token"),
        false,
      );
      assert.equal(
        await store.releaseUnenteredClaim(b, operation.id, claim.claimToken),
        false,
      );
      assert.equal(
        await store.releaseUnenteredClaim(a, resumed.id, claim.claimToken),
        false,
      );
      assert.equal(
        await new PrismaAccountLifecycleOperations(db).releaseUnenteredClaim(
          b,
          resumed.id,
          claim.claimToken,
        ),
        false,
      );
      assert.equal(
        await store.enterClaim(b, resumed.id, claim.claimToken),
        true,
      );
      assert.equal(
        await store.releaseUnenteredClaim(b, resumed.id, claim.claimToken),
        false,
      );
      assert.equal((await store.read(b, resumed.id)).phase, "submitted");
      // Role can also disappear during the store's final entry check after
      // session authorization returned. The unentered capability must survive
      // this failed transaction so its original holder can still abandon it.
      const secondSource = await db.providerAccountConnection.create({
        data: {
          ownerWorkspaceId: workspace.id,
          gatewayAccountRef: `late-role-${suffix}`,
          displayName: "Entry guard",
          profileRef: "fixture-profile",
          state: "active",
          authorizationEpochMirror: 7n,
        },
      });
      const secondOperation = await store.reserve({
        ...request,
        actorUserId: b,
        clientOperationId: randomUUID(),
        sourceId: secondSource.id,
      });
      let lateCalls = 0;
      await assert.rejects(
        submitAccountLifecycle(b, secondOperation.id, {
          store,
          gateway,
          authorize: async () => {
            if (++lateCalls === 3)
              await db.workspaceMember.update({
                where: {
                  workspaceId_userId: { workspaceId: workspace.id, userId: b },
                },
                data: { role: "member" },
              });
          },
        }),
      );
      assert.equal(
        posts,
        1,
        "late entry-role loss also performs zero additional POSTs",
      );
      await db.workspaceMember.create({
        data: { workspaceId: workspace.id, userId: outsider, role: "admin" },
      });
      assert.equal(
        (await store.read(outsider, secondOperation.id)).phase,
        "fencing",
      );
      await assert.rejects(store.read(b, secondOperation.id));
    },
  );
}
