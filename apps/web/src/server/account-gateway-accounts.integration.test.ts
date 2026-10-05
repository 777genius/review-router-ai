import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createManagementClient,
  secretSubmission,
} from "@agent-teams/account-gateway/http";
import {
  assertWorkspaceAdminAllowed,
  PrismaWorkspaceAccessRepository,
} from "@reviewrouter/features-auth";
import {
  bindWorkspaceAccount,
  resolveWorkspaceAccountBinding,
  PrismaProviderAccountRepository,
  type WorkspaceAccountActor,
} from "@reviewrouter/features-provider-accounts";
import { PrismaProviderAccountSynchronization } from "@reviewrouter/features-provider-accounts/synchronization";
import {
  createAccountsAdapter,
  type AccountView,
  type AccountsResult,
} from "./account-gateway-accounts";

function ok<T>(result: AccountsResult<T>): T {
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("fixture_expected_ok");
  return result.value;
}

// RED if a non-admin/foreign connection reaches management mutation, stale CAS
// overwrites metadata, a lost/pending ACK invents an account, disable leaves its
// local binding executable, or a credential reaches the safe response/SQL mirror.
// This is the real pinned SDK over loopback HTTP + real C1 Prisma/PostgreSQL.
// Primary must supply a NEW disposable loopback cluster already migrated through
// the current schema; this test does not provision/migrate or use ambient DB auth.
test.skipIf(process.env.RR_C3_ACCOUNTS_PG_TEST !== "1")(
  "C3 Accounts adapter at PostgreSQL/controlled HTTP boundary",
  async () => {
    assert.equal(process.env.RR_C3_ACCOUNTS_DISPOSABLE_CLUSTER, "1");
    const helperUrl = new URL(
      "../../../../packages/features/provider-accounts/tests/database-target.mjs",
      import.meta.url,
    );
    const helpers = (await import(helperUrl.href)) as {
      checkedDatabaseTarget(
        raw: string,
      ): ConstructorParameters<typeof PrismaPg>[0];
    };
    const target = helpers.checkedDatabaseTarget(
      process.env.RR_C3_ACCOUNTS_PG_TEST_URL ?? "",
    );
    const db = new PrismaClient({ adapter: new PrismaPg(target) });
    const accounts = new PrismaProviderAccountRepository(db);
    const synchronization = new PrismaProviderAccountSynchronization(db);
    const access = new PrismaWorkspaceAccessRepository(db);
    const prefix = `c3-${randomUUID()}`;
    const workspaceId = `${prefix}-a`;
    const otherWorkspaceId = `${prefix}-b`;
    const actor: WorkspaceAccountActor = {
      userId: `${prefix}-admin`,
      githubUserId: "",
      githubLogin: "synthetic",
    };
    const member: WorkspaceAccountActor = {
      userId: `${prefix}-member`,
      githubUserId: "",
      githubLogin: "synthetic",
    };
    const sentinel = `synthetic-write-only-${randomUUID()}`;
    const profileId = "fixture-mimo-responses";
    const foreignProfileId = "fixture-openrouter-chat";
    let httpReads = 0;
    let mutationEntries = 0;
    let owner = "";
    let account: c.Account | undefined;
    let wrongOwner = false;
    let loseAck = false;
    let disablePending = false;
    let held: ServerResponse | undefined;
    let holdNextGet = false;
    let notifyHeld: (() => void) | undefined;
    let wireFailure = false;
    const operations = new Map<string, c.Operation>(); // safe fixture receipts only, no intent/key storage
    function json(response: ServerResponse, status: number, body: unknown) {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    }
    const server = createServer(async (request, response) => {
      try {
        assert.equal(request.headers.authorization, "Bearer t");
        const url = new URL(request.url ?? "/", "http://127.0.0.1");
        if (request.method === "GET") {
          httpReads++;
          if (url.pathname === "/v1/profiles")
            return json(response, 200, {
              profiles: [
                {
                  profileId,
                  protocol: "openai-responses",
                  authKinds: ["api_key"],
                  modelIds: ["fixture-mimo"],
                },
                {
                  profileId: foreignProfileId,
                  protocol: "openai-chat",
                  authKinds: ["api_key"],
                  modelIds: ["fixture-openrouter"],
                },
                {
                  profileId: "fixture-oauth",
                  protocol: "openai-responses",
                  authKinds: ["oauth"],
                  modelIds: ["fixture-codex"],
                },
              ],
            });
          if (url.pathname === "/v1/accounts") {
            assert.equal(url.searchParams.get("limit"), "25");
            return json(response, 200, {
              accounts:
                account && url.searchParams.get("ownerRef") === owner
                  ? [account]
                  : [],
            });
          }
          if (url.pathname.startsWith("/v1/operations/")) {
            const receipt = operations.get(
              decodeURIComponent(url.pathname.slice("/v1/operations/".length)),
            );
            return receipt
              ? json(response, receipt.state === "pending" ? 202 : 200, receipt)
              : json(response, 404, {
                  code: "not_found",
                  traceRef: "fixture-missing",
                  effect: "not_dispatched",
                  retry: { kind: "never" },
                });
          }
          if (
            account &&
            url.pathname === `/v1/accounts/${account.accountRef}`
          ) {
            if (holdNextGet) {
              holdNextGet = false;
              held = response;
              notifyHeld?.();
              return;
            }
            return json(response, 200, {
              ...account,
              ...(wrongOwner ? { ownerRef: "foreign-workspace-owner" } : {}),
            });
          }
          throw new Error("unexpected_fixture_read");
        }
        let body = "";
        for await (const chunk of request) {
          body += String(chunk);
          assert.ok(Buffer.byteLength(body) < 32768);
        }
        const raw: unknown = JSON.parse(body);
        mutationEntries++;
        if (url.pathname === "/v1/accounts") {
          const input = secretSubmission.connect.parse(raw);
          assert.equal(input.credential.kind, "api_key");
          if (input.credential.kind === "api_key")
            assert.equal(input.credential.value, sentinel);
          assert.notEqual(input.ownerRef, workspaceId);
          if (operations.has(input.operationId))
            return json(response, 409, {
              code: "conflict",
              traceRef: "fixture-conflict",
              operationRef: input.operationId,
              effect: "not_dispatched",
              retry: { kind: "never" },
            });
          owner = input.ownerRef;
          const receipt: c.Operation = {
            operationRef: input.operationId,
            state: "pending",
          };
          operations.set(input.operationId, receipt);
          if (loseAck) {
            loseAck = false;
            response.destroy();
            return;
          }
          return json(response, 202, receipt);
        }
        assert.ok(account);
        let operationId: string;
        if (request.method === "PATCH") {
          const input = c.rename.parse(raw);
          assert.equal(
            input.expectedMetadataRevision,
            account.metadataRevision,
          );
          operationId = input.operationId;
          account = {
            ...account,
            displayName: input.displayName,
            metadataRevision: account.metadataRevision + 1,
          };
        } else if (url.pathname.endsWith("/reconnect")) {
          const input = secretSubmission.reconnect.parse(raw);
          assert.equal(input.credential.kind, "api_key");
          if (input.credential.kind === "api_key")
            assert.equal(input.credential.value, sentinel);
          assert.equal(
            input.expectedMetadataRevision,
            account.metadataRevision,
          );
          operationId = input.operationId;
          account = {
            ...account,
            metadataRevision: account.metadataRevision + 1,
            authorizationEpoch: account.authorizationEpoch + 1,
          };
        } else {
          assert.equal(
            url.pathname,
            `/v1/accounts/${account.accountRef}/disable`,
          );
          const input = c.disable.parse(raw);
          assert.equal(
            input.expectedMetadataRevision,
            account.metadataRevision,
          );
          operationId = input.operationId;
          if (disablePending) {
            const receipt: c.Operation = {
              operationRef: operationId,
              state: "pending",
            };
            operations.set(operationId, receipt);
            if (loseAck) {
              loseAck = false;
              response.destroy();
              return;
            }
            return json(response, 202, receipt);
          }
          account = {
            ...account,
            state: "disabled",
            metadataRevision: account.metadataRevision + 1,
            authorizationEpoch: account.authorizationEpoch + 1,
          };
        }
        const receipt: c.Operation = {
          operationRef: operationId,
          state: "applied",
          result: {
            kind: "account",
            accountRef: account.accountRef,
            metadataRevision: account.metadataRevision,
            authorizationEpoch: account.authorizationEpoch,
          },
        };
        operations.set(operationId, receipt);
        json(response, 200, receipt);
      } catch {
        wireFailure = true;
        json(response, 500, {
          code: "internal_error",
          traceRef: "fixture-error",
          effect: "effect_unknown",
          retry: { kind: "readback" },
        });
      }
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const gateway = createManagementClient({
      role: "management",
      origin: `http://127.0.0.1:${address.port}`,
      token: "t",
      timeoutMs: 2000,
    });
    const dependencies = { accounts, workspaceAccess: access };
    const compose = () =>
      createAccountsAdapter({
        gateway,
        accounts,
        synchronization,
        bindingDependencies: dependencies,
        apiKeyProfiles: new Map<string, "MiMo" | "OpenRouter">([
          [profileId, "MiMo"],
          [foreignProfileId, "OpenRouter"],
        ]),
        async authorize(context) {
          // Trusted test session selection, followed by ACTUAL live stable-ID membership assertion.
          const currentActor = context === "member" ? member : actor;
          const currentWorkspace =
            context === "b" ? otherWorkspaceId : workspaceId;
          if (!["a", "b", "member"].includes(context))
            throw new Error("invalid_session");
          await assertWorkspaceAdminAllowed(
            { workspaceId: currentWorkspace, ...currentActor },
            { workspaceAccess: access },
          );
          return { workspaceId: currentWorkspace, actor: currentActor };
        },
      });
    const adapter = compose();
    const connectNonce = randomUUID();
    const connect = {
      kind: "connect" as const,
      nonce: connectNonce,
      profileId,
      label: "Synthetic MiMo",
    };
    const observed: unknown[] = [];
    const observe = <T>(result: T): T => {
      observed.push(result);
      return result;
    };
    try {
      await db.workspace.createMany({
        data: [
          { id: workspaceId, slug: workspaceId, name: "Synthetic A" },
          { id: otherWorkspaceId, slug: otherWorkspaceId, name: "Synthetic B" },
        ],
      });
      await db.user.createMany({
        data: [{ id: actor.userId! }, { id: member.userId! }],
      });
      await db.workspaceMember.createMany({
        data: [
          { workspaceId, userId: actor.userId!, role: "admin" },
          {
            workspaceId: otherWorkspaceId,
            userId: actor.userId!,
            role: "admin",
          },
          { workspaceId, userId: member.userId!, role: "member" },
        ],
      });
      assert.equal(
        observe(await adapter.mutate("member", connect, sentinel)).status,
        "denied",
      );
      assert.equal(observe(await adapter.list("member")).status, "denied");
      assert.equal(httpReads, 0);
      assert.equal(mutationEntries, 0);
      const pending = ok(observe(await adapter.mutate("a", connect, sentinel)));
      assert.equal(pending.state, "pending");
      assert.equal(pending.account, undefined);
      assert.equal(
        await db.providerAccountConnection.count({
          where: { ownerWorkspaceId: workspaceId },
        }),
        0,
      );
      assert.equal(
        ok(observe(await compose().operation("a", connectNonce))).state,
        "pending",
      );
      assert.equal(mutationEntries, 1, "readback/reload cannot replay connect");
      assert.equal(
        observe(
          await adapter.mutate(
            "a",
            { ...connect, label: "Changed intent" },
            sentinel,
          ),
        ).status,
        "conflict",
      );
      assert.equal(
        ok(observe(await adapter.operation("b", connectNonce))).state,
        "unknown",
        "foreign namespace must not fetch A's operation",
      );
      assert.equal(
        observe(await adapter.operation("a", "foreign-operation-ref")).status,
        "invalid",
      );
      const [operationId] = operations.keys();
      assert.ok(operationId);
      account = {
        accountRef: `${prefix}-account`,
        ownerRef: owner,
        profileId,
        displayName: "Synthetic MiMo",
        state: "active",
        metadataRevision: 1,
        authorizationEpoch: 1,
      };
      operations.set(operationId, {
        operationRef: operationId,
        state: "applied",
        result: {
          kind: "account",
          accountRef: account.accountRef,
          metadataRevision: 1,
          authorizationEpoch: 1,
        },
      });
      wrongOwner = true;
      assert.equal(
        observe(await adapter.operation("a", connectNonce)).status,
        "denied",
      );
      assert.equal(
        await db.providerAccountConnection.count({
          where: { ownerWorkspaceId: workspaceId },
        }),
        0,
      );
      wrongOwner = false;
      const applied = ok(observe(await adapter.operation("a", connectNonce)));
      assert.ok(applied.account);
      let displayed: AccountView = applied.account;
      assert.equal(displayed.state, "active");
      assert.equal("accountRef" in displayed, false);
      assert.equal("ownerRef" in displayed, false);
      const existing = () => ({
        connectionId: displayed.connectionId,
        gatewayRevision: displayed.gatewayRevision,
        mirrorRevision: displayed.mirrorRevision,
      });
      const before = mutationEntries;
      assert.equal(
        observe(
          await adapter.mutate("b", {
            kind: "disable",
            nonce: randomUUID(),
            ...existing(),
          }),
        ).status,
        "denied",
      );
      assert.equal(
        observe(
          await adapter.mutate("a", {
            kind: "rename",
            nonce: randomUUID(),
            ...existing(),
            gatewayRevision: 0,
            label: "stale",
          }),
        ).status,
        "conflict",
      );
      assert.equal(mutationEntries, before);
      // P64: overlap initial bind's real SDK GET with disable on an unbound row.
      // Old source leaves no denial row; releasing the active GET lets bind(0) succeed.
      const originalAccount = account;
      for (const outcome of ["pending", "unknown"] as const) {
        account = { ...originalAccount, accountRef: `${prefix}-${outcome}` };
        const unbound = ok(observe(await adapter.list("a"))).accounts[0]!;
        const scope = { workspaceId, connectionId: unbound.connectionId };
        const revisions = {
          connectionId: unbound.connectionId,
          gatewayRevision: unbound.gatewayRevision,
          mirrorRevision: unbound.mirrorRevision,
        };
        assert.equal(await accounts.findConnectionBinding(scope), null);
        holdNextGet = true;
        const bindReadReady = new Promise<void>((resolve) => {
          notifyHeld = resolve;
        });
        const concurrentBind = adapter.bind("a", {
          ...revisions,
          bindingRevision: 0,
        });
        await bindReadReady;
        disablePending = true;
        loseAck = outcome === "unknown";
        const intent = {
          kind: "disable" as const,
          nonce: randomUUID(),
          ...revisions,
        };
        assert.equal(
          ok(observe(await adapter.mutate("a", intent))).state,
          outcome,
        );
        const denied = await accounts.findConnectionBinding(scope);
        assert.ok(
          denied,
          "P64 RED: absent binding must become retained local denial",
        );
        assert.equal(denied.state, "revoked");
        assert.equal(denied.revision, 2);
        assert.equal(denied.policyRevision, 2);
        assert.equal(denied.pendingFence?.policySubject, denied.id);
        assert.equal(denied.pendingFence?.policyRevision, 2);
        assert.equal(denied.fenceAck, null);
        assert.ok(held);
        json(held, 200, account);
        held = undefined;
        assert.equal(observe(await concurrentBind).status, "conflict");
        assert.equal(
          observe(await adapter.bind("a", { ...revisions, bindingRevision: 0 }))
            .status,
          "conflict",
        );
        assert.equal(
          observe(
            await adapter.bind("a", {
              ...revisions,
              bindingRevision: denied.revision,
            }),
          ).status,
          "denied",
        );
        await assert.rejects(
          bindWorkspaceAccount(
            { ...scope, actor, expectedRevision: 0 },
            dependencies,
          ),
          { code: "revision_conflict" },
        );
        await assert.rejects(
          resolveWorkspaceAccountBinding(
            { workspaceId, bindingId: denied.id, actor },
            dependencies,
          ),
          { code: "binding_unavailable" },
        );
        assert.equal(
          ok(observe(await compose().operation("a", intent.nonce))).state,
          "pending",
        );
        const stillActive = ok(observe(await adapter.list("a"))).accounts[0]!;
        assert.equal(stillActive.state, "active");
        assert.equal(stillActive.gatewayRevision, unbound.gatewayRevision);
        assert.equal(stillActive.mirrorRevision, unbound.mirrorRevision);
        const mirror = await accounts.findOwnedConnection(scope);
        assert.equal(mirror?.state, "active");
        assert.equal(mirror?.metadataRevision, unbound.mirrorRevision);
        assert.equal(
          ok(observe(await adapter.mutate("a", intent))).state,
          "pending",
        );
        assert.deepEqual(await accounts.findConnectionBinding(scope), denied);
      }
      account = originalAccount;
      disablePending = false;
      ok(
        observe(await adapter.bind("a", { ...existing(), bindingRevision: 0 })),
      );
      assert.equal(
        (
          await accounts.findConnectionBinding({
            workspaceId,
            connectionId: displayed.connectionId,
          })
        )?.state,
        "active",
      );
      displayed = ok(observe(await adapter.list("a"))).accounts[0]!;
      const scopedBinding = await accounts.findConnectionBinding({
        workspaceId,
        connectionId: displayed.connectionId,
      });
      assert.ok(scopedBinding);
      assert.deepEqual(displayed.binding, {
        id: scopedBinding.id,
        revision: scopedBinding.revision,
        state: scopedBinding.state,
        fencePending: scopedBinding.pendingFence !== null,
      });
      const renamed = ok(
        observe(
          await adapter.mutate("a", {
            kind: "rename",
            nonce: randomUUID(),
            ...existing(),
            label: "Renamed MiMo",
          }),
        ),
      );
      assert.ok(renamed.account);
      displayed = renamed.account;
      const reconnected = ok(
        observe(
          await adapter.mutate(
            "a",
            { kind: "reconnect", nonce: randomUUID(), ...existing() },
            sentinel,
          ),
        ),
      );
      assert.ok(reconnected.account);
      displayed = reconnected.account;
      const staleBefore = mutationEntries;
      assert.equal(
        observe(
          await adapter.mutate("a", {
            kind: "rename",
            nonce: randomUUID(),
            ...existing(),
            mirrorRevision: applied.account.mirrorRevision,
            label: "Stale mirror",
          }),
        ).status,
        "conflict",
      );
      assert.equal(mutationEntries, staleBefore);
      disablePending = true;
      const disableNonce = randomUUID();
      const deniedLocally = ok(
        observe(
          await adapter.mutate("a", {
            kind: "disable",
            nonce: disableNonce,
            ...existing(),
          }),
        ),
      );
      assert.equal(deniedLocally.state, "pending");
      assert.equal(deniedLocally.account, undefined);
      const binding = await accounts.findConnectionBinding({
        workspaceId,
        connectionId: displayed.connectionId,
      });
      assert.equal(binding?.state, "revoked");
      assert.ok(binding?.pendingFence);
      assert.equal(
        (
          await accounts.findOwnedConnection({
            workspaceId,
            connectionId: displayed.connectionId,
          })
        )?.state,
        "active",
        "pending cannot overwrite gateway mirror",
      );
      // A newer trusted C1 writer must win over a delayed older actual HTTP GET.
      const prior = await accounts.findOwnedConnection({
        workspaceId,
        connectionId: displayed.connectionId,
      });
      assert.ok(prior);
      account = {
        ...account,
        displayName: "Delayed older metadata",
        metadataRevision: account.metadataRevision + 1,
      };
      const delayed = { ...account };
      holdNextGet = true;
      const heldReady = new Promise<void>((resolve) => {
        notifyHeld = resolve;
      });
      const reading = adapter.operation("a", connectNonce);
      await heldReady;
      await synchronization.synchronizeMetadata({
        workspaceId,
        connectionId: prior.id,
        expectedRevision: prior.metadataRevision,
        profileRef: profileId,
        displayName: "Newer CAS wins",
        state: "active",
        gatewayOperationRef: prior.gatewayOperationRef,
      });
      assert.ok(held);
      json(held, 200, delayed);
      assert.equal(observe(await reading).status, "conflict");
      assert.equal(
        (
          await accounts.findOwnedConnection({
            workspaceId,
            connectionId: prior.id,
          })
        )?.displayName,
        "Newer CAS wins",
      );
      loseAck = true;
      const lostNonce = randomUUID();
      assert.equal(
        ok(
          observe(
            await adapter.mutate(
              "a",
              { ...connect, nonce: lostNonce },
              sentinel,
            ),
          ),
        ).state,
        "unknown",
      );
      const afterLost = mutationEntries;
      assert.equal(
        ok(observe(await compose().operation("a", lostNonce))).state,
        "pending",
      );
      assert.equal(mutationEntries, afterLost);
      await db.workspaceMember.updateMany({
        where: { workspaceId, userId: actor.userId! },
        data: { role: "member" },
      });
      assert.equal(
        observe(
          await adapter.mutate(
            "a",
            { ...connect, nonce: randomUUID() },
            sentinel,
          ),
        ).status,
        "denied",
      );
      assert.equal(mutationEntries, afterLost);
      const rows = await db.providerAccountConnection.findMany({
        where: { ownerWorkspaceId: workspaceId },
      });
      assert.ok(
        rows.every(
          (row) =>
            row.ownerUserId === null && row.ownerWorkspaceId === workspaceId,
        ),
      );
      assert.equal(
        JSON.stringify({ observed, rows }).includes(sentinel),
        false,
      );
      assert.equal(
        wireFailure,
        false,
        "controlled HTTP fixture assertions must pass",
      );
    } finally {
      held?.destroy();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      // Only this test's synthetic rows, never broad delete or migration.
      await db.workspaceAccountBinding.deleteMany({ where: { workspaceId } });
      await db.providerAccountConnection.deleteMany({
        where: { ownerWorkspaceId: { in: [workspaceId, otherWorkspaceId] } },
      });
      await db.workspaceMember.deleteMany({
        where: { workspaceId: { in: [workspaceId, otherWorkspaceId] } },
      });
      await db.workspace.deleteMany({
        where: { id: { in: [workspaceId, otherWorkspaceId] } },
      });
      await db.user.deleteMany({
        where: { id: { in: [actor.userId!, member.userId!] } },
      });
      await db.$disconnect();
    }
  },
  30000,
);
