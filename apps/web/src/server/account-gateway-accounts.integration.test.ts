import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { once } from "node:events";
import { test, vi } from "vitest";
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
import {
  PrismaProviderAccountSynchronization,
  PrismaPersonalAccountOperations,
} from "@reviewrouter/features-provider-accounts/synchronization";
import {
  createAccountsAdapter,
  createDisabledPersonalAccountsAdapter,
  accountsServerAdapter,
  loadAccountsBootstrap,
  type AccountView,
  type AccountsResult,
} from "./account-gateway-accounts";

function ok<T>(result: AccountsResult<T>): T {
  assert.equal(result.status, "ok");
  if (result.status !== "ok") throw new Error("fixture_expected_ok");
  return result.value;
}

// Wrong/foreign endpoints must be denied before the existing SDK secret ingress.
// This uses the real SDK wire contract and starts no provider or database.
test("Accounts connect binds dedicated URL to the configured profile and freezes a blank label", async () => {
  const profileId = "fixture-mimo-responses";
  const baseURL = "https://token-plan-sgp.xiaomimimo.com/v1";
  const submitted: ReturnType<typeof secretSubmission.connect.parse>[] = [];
  let receipt: c.Operation | undefined;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/provider-connection-capabilities") {
      response.statusCode = 404;
      response.end(
        JSON.stringify({
          code: "not_found",
          traceRef: "fixture-missing-capabilities",
          effect: "not_dispatched",
          retry: { kind: "never" },
        }),
      );
      return;
    }
    if (request.method === "GET") {
      response.end(
        JSON.stringify(
          request.url === "/v1/profiles"
            ? {
                profiles: [
                  {
                    profileId,
                    protocol: "openai-responses",
                    authKinds: ["api_key"],
                    modelIds: ["fixture-mimo"],
                  },
                ],
              }
            : receipt,
        ),
      );
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = secretSubmission.connect.parse(
      JSON.parse(Buffer.concat(chunks).toString()),
    );
    submitted.push(input);
    assert.equal(Object.hasOwn(input, "baseURL"), false);
    receipt = { operationRef: input.operationId, state: "pending" };
    response.statusCode = 202;
    response.end(JSON.stringify(receipt));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const gateway = createManagementClient({
    role: "management",
    origin: `http://127.0.0.1:${address.port}`,
    token: "synthetic",
    timeoutMs: 2000,
  });
  // Pending projection must never touch mirror persistence.
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("unexpected_mirror_access");
      },
    },
  );
  type Input = Parameters<typeof createAccountsAdapter>[0];
  const adapter = createAccountsAdapter({
    gateway,
    authorize: async () => ({
      workspaceId: "fixture-workspace",
      actor: {
        userId: "fixture-admin",
        githubUserId: "",
        githubLogin: "synthetic",
      },
    }),
    accounts: unused as Input["accounts"],
    synchronization: unused as Input["synchronization"],
    bindingDependencies: unused as Input["bindingDependencies"],
    apiKeyProfiles: new Map([[profileId, "MiMo"]]),
    apiKeyProfileBaseURLs: new Map([[profileId, baseURL]]),
  });
  const intent = {
    kind: "connect" as const,
    nonce: randomUUID(),
    profileId,
    label: "   ",
  };
  try {
    for (const invalid of [
      "http://127.0.0.1/v1",
      `${baseURL}?redirect=1`,
      "https://token-plan-cn.xiaomimimo.com/v1",
      "https://token-plan-sgp.xiaomimimo.com.evil.test/v1",
    ]) {
      assert.equal(
        (
          await adapter.mutate(
            "context",
            { ...intent, baseURL: invalid },
            "synthetic-key",
          )
        ).status,
        "denied",
      );
    }
    assert.equal(submitted.length, 0);
    const result = ok(
      await adapter.mutate(
        "context",
        { ...intent, baseURL: ` ${baseURL}/ ` },
        "synthetic-key",
      ),
    );
    assert.equal(result.state, "pending");
    assert.equal(submitted.length, 1);
    assert.equal(submitted[0]!.displayName, "MiMo Account 1");
    assert.equal(submitted[0]!.profileId, profileId);
    assert.equal(
      ok(await adapter.operation("context", intent.nonce)).nonce,
      intent.nonce,
    );
    assert.equal(submitted.length, 1);
    assert.equal(JSON.stringify(result).includes("synthetic-key"), false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

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
    const oauthProfileId = "openai-codex-oauth-responses-v1";
    const oauthState = `oauth-state-${randomUUID()}`;
    const callbackCode = `synthetic-callback-${randomUUID()}`;
    const callbackState = "b".repeat(64);
    const callbackURL = `http://localhost:1455/auth/callback?code=${callbackCode}&state=${callbackState}`;
    const authorizationURL = `https://auth.openai.com/oauth/authorize?${new URLSearchParams(
      {
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        response_type: "code",
        redirect_uri: "http://localhost:1455/auth/callback",
        code_challenge_method: "S256",
        code_challenge: "a".repeat(43),
        scope: "openid profile email offline_access",
        state: oauthState,
      },
    )}`;
    c.oauthAuthorizationURL.parse(authorizationURL);
    let personalIngressEntries = 0;
    let hidePersonalReadback = true;
    let personalOperationId = "";
    let oauthBeginEntries = 0;
    let oauthCompleteEntries = 0;
    let oauthReconnectEntries = 0;
    const genericReadRefs: string[] = [];
    let personalWorkspaceId: string | undefined;
    let selectedWorkspace = workspaceId;
    let afterOAuthBegin: (() => Promise<void>) | undefined;
    let afterOAuthRead: (() => Promise<void>) | undefined;
    let afterAccountRead: (() => Promise<void>) | undefined;
    let afterOAuthComplete: (() => Promise<void>) | undefined;
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
                {
                  profileId: oauthProfileId,
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
            genericReadRefs.push(
              decodeURIComponent(url.pathname.slice("/v1/operations/".length)),
            );
            if (
              hidePersonalReadback &&
              url.pathname.endsWith(`/${personalOperationId}`) &&
              personalOperationId
            )
              return json(response, 404, {
                code: "not_found",
                traceRef: "fixture-missing",
                effect: "not_dispatched",
                retry: { kind: "never" },
              });
            const receipt = operations.get(
              decodeURIComponent(url.pathname.slice("/v1/operations/".length)),
            );
            const readHook = afterOAuthRead;
            afterOAuthRead = undefined;
            await readHook?.();
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
            const accountReadHook = afterAccountRead;
            afterAccountRead = undefined;
            await accountReadHook?.();
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
        if (url.pathname === "/v1/accounts/oauth/begin") {
          assert.equal(request.method, "POST");
          const input = c.oauthBegin.parse(raw);
          assert.equal(input.profileId, oauthProfileId);
          assert.notEqual(input.ownerRef, workspaceId);
          assert.equal(input.ownerRef, owner);
          oauthBeginEntries++;
          const receipt: c.Operation = {
            operationRef: input.operationId,
            state: "pending",
          };
          operations.set(input.operationId, receipt);
          const effectHook = afterOAuthBegin;
          afterOAuthBegin = undefined;
          await effectHook?.();
          if (loseAck) {
            loseAck = false;
            response.destroy();
            return;
          }
          return json(response, 202, { operation: receipt, authorizationURL });
        }
        if (
          account?.profileId === oauthProfileId &&
          url.pathname === `/v1/accounts/${account.accountRef}/reconnect`
        ) {
          assert.equal(request.method, "POST");
          const input = c.oauthReconnect.parse(raw);
          assert.equal(
            input.expectedMetadataRevision,
            account.metadataRevision,
          );
          oauthReconnectEntries++;
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
          return json(response, 202, { operation: receipt, authorizationURL });
        }
        if (url.pathname === "/v1/accounts/oauth/complete") {
          assert.equal(request.method, "POST");
          const input = secretSubmission.oauthComplete.parse(raw);
          assert.equal(input.ownerRef, owner);
          assert.ok("callbackURL" in input);
          assert.equal(input.callbackURL, callbackURL);
          const receipt = operations.get(input.operationId);
          assert.equal(receipt?.state, "pending");
          oauthCompleteEntries++;
          const effectHook = afterOAuthComplete;
          afterOAuthComplete = undefined;
          await effectHook?.();
          return json(response, 202, receipt);
        }
        if (url.pathname === "/v1/accounts") {
          const input = secretSubmission.connect.parse(raw);
          assert.equal(input.credential.kind, "api_key");
          if (input.credential.kind === "api_key")
            assert.equal(input.credential.value, sentinel);
          assert.notEqual(input.ownerRef, workspaceId);
          if (input.ownerRef.startsWith("rru_")) {
            // RED: HTTP ingress precedes RR COMMIT, uses caller ownership or
            // changed safe intent, or a lost ACK repeats secret submission.
            const persisted =
              await db.personalAccountOperation.findUniqueOrThrow({
                where: { id: input.operationId },
              });
            assert.ok(["submitted", "unknown"].includes(persisted.phase));
            assert.equal(
              input.ownerRef,
              `rru_${createHash("sha256").update(`rr-user-owner-v1\0${persisted.actorUserId}`).digest("hex")}`,
            );
            assert.equal(input.profileId, persisted.profileId);
            assert.equal(input.displayName, persisted.displayName);
            assert.equal(
              await db.providerAccountConnection.count({
                where: { id: persisted.proposedSourceId! },
              }),
              0,
            );
            personalIngressEntries++;
            assert.equal(personalIngressEntries, 1);
            personalOperationId = input.operationId;
            owner = input.ownerRef;
            account = {
              accountRef: `h-http-${prefix}`,
              ownerRef: owner,
              profileId: input.profileId,
              displayName: input.displayName,
              state: "active",
              metadataRevision: 2,
              authorizationEpoch: 3,
            };
            operations.set(input.operationId, {
              operationRef: input.operationId,
              state: "applied",
              result: {
                kind: "account",
                accountRef: account.accountRef,
                metadataRevision: 2,
                authorizationEpoch: 3,
              },
            });
            response.destroy(); // applied original operation, deliberately lost ingress ACK
            return;
          }
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
    const compose = (oauthEnabled = false) =>
      createAccountsAdapter({
        gateway,
        accounts,
        synchronization,
        bindingDependencies: dependencies,
        apiKeyProfiles: new Map<string, "MiMo" | "OpenRouter">([
          [profileId, "MiMo"],
          [foreignProfileId, "OpenRouter"],
        ]),
        ...(oauthEnabled
          ? { codexOAuthProfileId: oauthProfileId as typeof oauthProfileId }
          : {}),
        async authorize(context) {
          // Trusted test session selection, followed by ACTUAL live stable-ID membership assertion.
          const currentActor = context === "member" ? member : actor;
          const currentWorkspace =
            context === "b" ? otherWorkspaceId : selectedWorkspace;
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
      // RED: production authorize accepts a new personal owner as an ordinary
      // workspace admin and reaches profiles/create/OAuth management. Use its
      // actual trusted query against real Prisma, with only the session and
      // composition dependencies replaced; no copied personal predicate.
      const { PrismaWorkspaceMembershipRepository } =
        await import("../../../../packages/features/auth/src/infrastructure/prisma/prisma-workspace-membership-repository");
      personalWorkspaceId = (
        await new PrismaWorkspaceMembershipRepository(
          db,
        ).ensurePersonalWorkspaceOwner({
          userId: actor.userId!,
          provider: "github",
          externalUserId: `${prefix}-external`,
          login: "personal-label",
          githubUserId: "",
          githubLogin: actor.githubLogin,
          primaryEmail: null,
          avatarUrl: null,
        })
      ).workspaceId;
      const personalRow = await db.workspace.findUniqueOrThrow({
        where: { id: personalWorkspaceId },
      });
      assert.equal(personalRow.personalOwnerUserId, actor.userId);
      await assertWorkspaceAdminAllowed(
        { workspaceId: personalWorkspaceId, ...actor },
        { workspaceAccess: access },
      );
      vi.doMock("./prisma", () => ({ getPrisma: () => db }));
      vi.doMock("./dashboard-mutations", () => ({
        getDashboardSignedInActor: async () => actor,
        assertDashboardWorkspaceAdminAllowed: async (id: string) => {
          await assertWorkspaceAdminAllowed(
            { workspaceId: id, ...actor },
            { workspaceAccess: access },
          );
          return actor;
        },
      }));
      const contextKey = "synthetic-context-key-for-personal-guard";
      vi.stubEnv(
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_ACCOUNTS_CONTEXT_SECRET",
        contextKey,
      );
      vi.stubEnv(
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_ORIGIN",
        `http://127.0.0.1:${address.port}`,
      );
      vi.stubEnv("REVIEW_ROUTER_ACCOUNT_GATEWAY_MANAGEMENT_TOKEN", "t");
      vi.stubEnv("REVIEW_ROUTER_ACCOUNT_GATEWAY_MIMO_PROFILE_ID", profileId);
      vi.stubEnv(
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_OPENROUTER_PROFILE_ID",
        foreignProfileId,
      );
      vi.stubEnv(
        "REVIEW_ROUTER_ACCOUNT_GATEWAY_CODEX_OAUTH_PROFILE_ID",
        oauthProfileId,
      );
      vi.stubEnv("ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID", "");
      try {
        // No operator workspace is configured in this fixture.
        delete process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID;
        const bootstrap = await loadAccountsBootstrap(personalWorkspaceId);
        assert.equal(bootstrap.context, "");
        assert.equal(bootstrap.page.status, "denied");
        const body = Buffer.from(
          JSON.stringify({
            workspaceId: personalWorkspaceId,
            userId: actor.userId,
          }),
        ).toString("base64url");
        const signature = createHmac("sha256", contextKey)
          .update(`rr-c3-accounts-context-v1\0${body}`)
          .digest("base64url");
        const personalContext = `${body}.${signature}`;
        const live = await accountsServerAdapter();
        assert.equal((await live.list(personalContext)).status, "denied");
        assert.equal(
          (await live.mutate(personalContext, connect, sentinel)).status,
          "denied",
        );
        assert.equal(
          (
            await live.beginOAuth(personalContext, {
              nonce: randomUUID(),
              profileId: oauthProfileId,
              label: "Personal OAuth",
            })
          ).status,
          "denied",
        );
        assert.equal(
          (await live.operation(personalContext, randomUUID())).status,
          "denied",
        );
        assert.equal(
          httpReads,
          0,
          "personal denial precedes profiles and all Gateway reads",
        );
        assert.equal(mutationEntries, 0);
        assert.equal(oauthBeginEntries, 0);
        assert.equal(
          await db.providerAccountConnection.count({
            where: {
              OR: [
                { ownerWorkspaceId: personalWorkspaceId },
                { ownerUserId: actor.userId! },
              ],
            },
          }),
          0,
        );
        assert.equal(
          await db.workspaceAccountBinding.count({
            where: { workspaceId: personalWorkspaceId },
          }),
          0,
        );
      } finally {
        vi.doUnmock("./prisma");
        vi.doUnmock("./dashboard-mutations");
        vi.unstubAllEnvs();
      }
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
      // OAuth RED: exposing a merely advertised/unconfigured profile, forwarding
      // caller ownership, or allowing a member to Begin would release a capability.
      const oauthAdapter = compose(true);
      const oauthIntent = {
        nonce: randomUUID(),
        profileId: oauthProfileId,
        label: "Synthetic Codex",
      };
      const beforeOAuth = mutationEntries;
      assert.equal(
        observe(await adapter.beginOAuth("a", oauthIntent)).status,
        "denied",
      );
      assert.equal(
        observe(await oauthAdapter.beginOAuth("member", oauthIntent)).status,
        "denied",
      );
      assert.equal(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...oauthIntent,
            profileId: "fixture-oauth",
          }),
        ).status,
        "denied",
      );
      assert.equal(
        observe(
          await oauthAdapter.mutate(
            "a",
            {
              kind: "connect",
              ...oauthIntent,
            },
            sentinel,
          ),
        ).status,
        "denied",
      );
      assert.equal(mutationEntries, beforeOAuth);
      const catalogue = ok(observe(await oauthAdapter.list("a"))).profiles;
      assert.deepEqual(
        catalogue.map((p) => [p.id, p.provider, p.authKind, p.canReconnect]),
        [
          [profileId, "codex-mimo", "api_key", true],
          [foreignProfileId, "openrouter", "api_key", true],
          [oauthProfileId, "codex", "oauth", true],
        ],
      );
      const original = account;
      const mirrorCount = await db.providerAccountConnection.count({
        where: { ownerWorkspaceId: workspaceId },
      });
      const fresh = ok(await oauthAdapter.beginOAuth("a", oauthIntent));
      assert.equal(fresh.authorizationURL, authorizationURL);
      observe(fresh.operation); // one-off capability is deliberately outside the safe-data set
      assert.equal(fresh.operation.state, "pending");
      assert.deepEqual(fresh.operation.completion, {
        providerLabel: "Codex",
        inputKind: "callback_url",
      });
      assert.equal(fresh.operation.account, undefined);
      assert.equal(
        await db.providerAccountConnection.count({
          where: { ownerWorkspaceId: workspaceId },
        }),
        mirrorCount,
      );
      const oauthOp = [...operations.keys()].at(-1)!;
      // RED: readback replaying Begin or projecting a URL/account from pending ACK.
      assert.equal(
        ok(observe(await compose(true).operation("a", oauthIntent.nonce)))
          .state,
        "pending",
      );
      assert.equal(oauthBeginEntries, 1);
      assert.equal(genericReadRefs.at(-1), oauthOp);
      // RED: caller selectors, malformed URLs, another owner/nonce or lost
      // current admin authority can enter sensitive completion ingress.
      const completion = { nonce: oauthIntent.nonce, callbackURL };
      const beforeCompleteReads = httpReads;
      assert.equal(
        observe(
          await oauthAdapter.completeOAuth("a", {
            ...completion,
            callbackURL: `${callbackURL}&state=${callbackState}`,
          }),
        ).status,
        "invalid",
      );
      assert.equal(httpReads, beforeCompleteReads);
      assert.equal(
        observe(
          await oauthAdapter.completeOAuth("a", {
            ...completion,
            accountRef: "caller-selected-account",
          } as typeof completion),
        ).status,
        "invalid",
      );
      assert.equal(
        observe(await oauthAdapter.completeOAuth("member", completion)).status,
        "denied",
      );
      assert.notEqual(
        observe(await oauthAdapter.completeOAuth("b", completion)).status,
        "ok",
      );
      assert.notEqual(
        observe(
          await oauthAdapter.completeOAuth("a", {
            ...completion,
            nonce: randomUUID(),
          }),
        ).status,
        "ok",
      );
      operations.set(oauthOp, {
        operationRef: "wrong-original-operation",
        state: "pending",
      });
      // The real SDK rejects a response for another operation before projection.
      assert.equal(
        observe(await oauthAdapter.completeOAuth("a", completion)).status,
        "unavailable",
      );
      assert.equal(oauthCompleteEntries, 0);
      operations.set(oauthOp, { operationRef: oauthOp, state: "pending" });
      afterOAuthRead = async () => {
        await db.workspaceMember.updateMany({
          where: { workspaceId, userId: actor.userId! },
          data: { role: "member" },
        });
      };
      assert.equal(
        observe(await oauthAdapter.completeOAuth("a", completion)).status,
        "denied",
      );
      assert.equal(oauthCompleteEntries, 0);
      await db.workspaceMember.updateMany({
        where: { workspaceId, userId: actor.userId! },
        data: { role: "admin" },
      });
      assert.equal(
        ok(
          observe(
            await oauthAdapter.completeOAuth("a", {
              nonce: oauthIntent.nonce,
              authorizationResult: callbackURL,
            }),
          ),
        ).state,
        "pending",
      );
      assert.equal(oauthCompleteEntries, 1);
      afterOAuthComplete = async () => {
        await db.workspaceMember.updateMany({
          where: { workspaceId, userId: actor.userId! },
          data: { role: "member" },
        });
      };
      const completionRevoked = ok(
        observe(await oauthAdapter.completeOAuth("a", completion)),
      );
      assert.deepEqual(completionRevoked, {
        nonce: oauthIntent.nonce,
        state: "unknown",
        cleanup: "unresolved",
      });
      assert.equal(oauthCompleteEntries, 2);
      await db.workspaceMember.updateMany({
        where: { workspaceId, userId: actor.userId! },
        data: { role: "admin" },
      });
      // A read of unknown/terminal state cannot repeat completion.
      for (const state of ["unknown", "rejected"] as const) {
        operations.set(
          oauthOp,
          state === "unknown"
            ? { operationRef: oauthOp, state }
            : {
                operationRef: oauthOp,
                state,
                error: {
                  code: "conflict",
                  traceRef: "fixture-rejected",
                  effect: "not_dispatched",
                  retry: { kind: "never" },
                },
              },
        );
        assert.equal(
          ok(observe(await oauthAdapter.completeOAuth("a", completion))).state,
          state,
        );
      }
      assert.equal(oauthCompleteEntries, 2);
      operations.set(oauthOp, { operationRef: oauthOp, state: "pending" });
      account = {
        accountRef: `${prefix}-oauth`,
        ownerRef: owner,
        profileId: oauthProfileId,
        displayName: "Synthetic Codex",
        state: "staging",
        metadataRevision: 1,
        authorizationEpoch: 1,
      };
      let oauthRow = ok(observe(await oauthAdapter.list("a"))).accounts[0]!;
      const oauthRevisions = () => ({
        connectionId: oauthRow.connectionId,
        gatewayRevision: oauthRow.gatewayRevision,
        mirrorRevision: oauthRow.mirrorRevision,
      });
      assert.equal(oauthRow.authKind, "oauth");
      assert.equal(
        observe(
          await oauthAdapter.bind("a", {
            ...oauthRevisions(),
            bindingRevision: 0,
          }),
        ).status,
        "denied",
      );
      const beforeReconnect = mutationEntries;
      assert.equal(
        observe(
          await oauthAdapter.mutate(
            "a",
            {
              kind: "reconnect",
              nonce: randomUUID(),
              ...oauthRevisions(),
            },
            sentinel,
          ),
        ).status,
        "denied",
      );
      assert.equal(mutationEntries, beforeReconnect);
      account = { ...account, state: "active", metadataRevision: 2 };
      operations.set(oauthOp, {
        operationRef: oauthOp,
        state: "applied",
        result: {
          kind: "account",
          accountRef: account.accountRef,
          metadataRevision: 2,
          authorizationEpoch: 1,
        },
      });
      oauthRow = ok(
        observe(await oauthAdapter.operation("a", oauthIntent.nonce)),
      ).account!;
      assert.equal(oauthRow.state, "active");
      assert.equal(
        ok(observe(await oauthAdapter.completeOAuth("a", completion))).state,
        "applied",
      );
      assert.equal(oauthCompleteEntries, 2);
      ok(
        observe(
          await oauthAdapter.bind("a", {
            ...oauthRevisions(),
            bindingRevision: 0,
          }),
        ),
      );
      assert.equal(
        (
          await accounts.findConnectionBinding({
            workspaceId,
            connectionId: oauthRow.connectionId,
          })
        )?.state,
        "active",
      );
      // Reconnect reuses the stable server-owned account; stale selectors and
      // member access cannot enter, and a lost URL remains ordinary readback.
      const reconnectIntent = { nonce: randomUUID(), ...oauthRevisions() };
      const reconnectAccount = { ...account };
      const beforeOAuthReconnect = mutationEntries;
      assert.equal(
        observe(await oauthAdapter.beginOAuth("member", reconnectIntent))
          .status,
        "denied",
      );
      assert.equal(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...reconnectIntent,
            gatewayRevision: reconnectIntent.gatewayRevision - 1,
          }),
        ).status,
        "conflict",
      );
      assert.equal(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...reconnectIntent,
            mirrorRevision: reconnectIntent.mirrorRevision + 1,
          }),
        ).status,
        "conflict",
      );
      assert.equal(mutationEntries, beforeOAuthReconnect);
      // Revoke ACTUAL membership while the second owned-mirror SQL read is
      // awaited: reconnect must reauthorize before any Begin POST can enter.
      const originalOwnedRead = accounts.findOwnedConnection;
      let reconnectMirrorReads = 0;
      accounts.findOwnedConnection = async (query) => {
        const found = await originalOwnedRead.call(accounts, query);
        if (++reconnectMirrorReads === 2) {
          await db.workspaceMember.updateMany({
            where: { workspaceId, userId: actor.userId! },
            data: { role: "member" },
          });
        }
        return found;
      };
      try {
        assert.equal(
          observe(await oauthAdapter.beginOAuth("a", reconnectIntent)).status,
          "denied",
        );
        assert.equal(reconnectMirrorReads, 2);
        assert.equal(mutationEntries, beforeOAuthReconnect);
      } finally {
        accounts.findOwnedConnection = originalOwnedRead;
        await db.workspaceMember.updateMany({
          where: { workspaceId, userId: actor.userId! },
          data: { role: "admin" },
        });
      }
      const oauthReconnected = ok(
        await oauthAdapter.beginOAuth("a", reconnectIntent),
      );
      observe(oauthReconnected.operation); // fresh capability stays outside safe-data observations
      assert.equal(oauthReconnected.authorizationURL, authorizationURL);
      assert.equal(observe(oauthReconnected.operation).state, "pending");
      assert.deepEqual(account, reconnectAccount);
      assert.equal(oauthReconnectEntries, 1);
      const afterReconnect = mutationEntries;
      assert.equal(
        ok(observe(await oauthAdapter.operation("a", reconnectIntent.nonce)))
          .state,
        "pending",
      );
      assert.equal(mutationEntries, afterReconnect);
      loseAck = true;
      const lostReconnectNonce = randomUUID();
      const lostReconnect = ok(
        await oauthAdapter.beginOAuth("a", {
          ...reconnectIntent,
          nonce: lostReconnectNonce,
        }),
      );
      assert.equal(lostReconnect.operation.state, "unknown");
      assert.equal(lostReconnect.authorizationURL, undefined);
      const afterLostReconnect = mutationEntries;
      assert.equal(
        ok(observe(await oauthAdapter.operation("a", lostReconnectNonce)))
          .state,
        "pending",
      );
      assert.equal(mutationEntries, afterLostReconnect);
      assert.equal(oauthReconnectEntries, 2);
      // RED: lost Begin ACK treated as non-entry, or a reload/manual read repeating Begin.
      loseAck = true;
      const lostOAuthNonce = randomUUID();
      const lostOAuth = ok(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...oauthIntent,
            nonce: lostOAuthNonce,
          }),
        ),
      );
      assert.equal(lostOAuth.operation.state, "unknown");
      assert.equal(lostOAuth.authorizationURL, undefined);
      assert.equal(
        ok(observe(await compose(true).operation("a", lostOAuthNonce))).state,
        "pending",
      );
      assert.equal(oauthBeginEntries, 2);
      // RED: checking admin only BEFORE awaited Begin leaks its URL after role loss.
      afterOAuthBegin = async () => {
        await db.workspaceMember.updateMany({
          where: { workspaceId, userId: actor.userId! },
          data: { role: "member" },
        });
      };
      const revokedNonce = randomUUID();
      const revoked = ok(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...oauthIntent,
            nonce: revokedNonce,
          }),
        ),
      );
      assert.equal(revoked.operation.nonce, revokedNonce);
      assert.equal(revoked.operation.state, "unknown");
      assert.equal(revoked.authorizationURL, undefined);
      const afterRevoked = mutationEntries;
      assert.equal(
        observe(await oauthAdapter.operation("a", revokedNonce)).status,
        "denied",
      );
      assert.equal(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...oauthIntent,
            nonce: randomUUID(),
          }),
        ).status,
        "denied",
      );
      assert.equal(mutationEntries, afterRevoked);
      await db.workspaceMember.updateMany({
        where: { workspaceId, userId: actor.userId! },
        data: { role: "admin" },
      });
      assert.equal(
        ok(observe(await oauthAdapter.operation("a", revokedNonce))).state,
        "pending",
      );
      // RED: a different currently-admin workspace after Begin passes an unbound recheck.
      afterOAuthBegin = async () => {
        selectedWorkspace = otherWorkspaceId;
      };
      const switchedNonce = randomUUID();
      const switched = ok(
        observe(
          await oauthAdapter.beginOAuth("a", {
            ...oauthIntent,
            nonce: switchedNonce,
          }),
        ),
      );
      assert.equal(switched.operation.state, "unknown");
      assert.equal(switched.authorizationURL, undefined);
      assert.equal(
        ok(observe(await oauthAdapter.operation("a", switchedNonce))).state,
        "unknown",
      );
      selectedWorkspace = workspaceId;
      assert.equal(
        ok(observe(await oauthAdapter.operation("a", switchedNonce))).state,
        "pending",
      );
      assert.equal(oauthBeginEntries, 4);
      account = original;
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
      assert.equal(mutationEntries, afterRevoked + 1);
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
      for (const secret of [
        authorizationURL,
        oauthState,
        callbackURL,
        callbackCode,
        callbackState,
        "code_challenge",
        "authorizationURL",
        "refresh_token",
        "access_token",
      ]) {
        assert.equal(
          JSON.stringify({
            observed,
            rows,
            operations: [...operations.values()],
          }).includes(secret),
          false,
        );
      }
      // Controlled personal source recovery uses the real store and public C1
      // consumer-control factory. These retained inert rows do not enable H.
      const stableUser = `h-http-user-${randomUUID()}`;
      await db.user.create({ data: { id: stableUser } });
      const store = new PrismaPersonalAccountOperations(db);
      const personal = (authorizeUser = async () => stableUser) =>
        createDisabledPersonalAccountsAdapter({
          authorizeUser,
          store,
          control: {
            role: "consumer-control",
            origin: `http://127.0.0.1:${address.port}`,
            token: "t",
            timeoutMs: 2000,
          },
          profiles: new Map([[profileId, "api-key-create"]]),
        });
      // Real store awaits cannot retain a session across reserve/claim and secret ingress.
      let activePersonalUser = stableUser;
      const sessionPersonal = personal(async () => activePersonalUser);
      const beforeDeniedConnect = await db.personalAccountOperation.count({
        where: { actorUserId: stableUser },
      });
      const resolvePersonal = store.resolvePersonalWorkspace.bind(store);
      const resolveSpy = vi
        .spyOn(store, "resolvePersonalWorkspace")
        .mockImplementationOnce(async (actorUserId) => {
          const resolved = await resolvePersonal(actorUserId);
          activePersonalUser = member.userId!;
          return resolved;
        });
      try {
        await assert.rejects(
          sessionPersonal.connect(
            { nonce: randomUUID(), profileId, label: "Denied before reserve" },
            sentinel,
          ),
        );
      } finally {
        resolveSpy.mockRestore();
      }
      assert.equal(
        await db.personalAccountOperation.count({
          where: { actorUserId: stableUser },
        }),
        beforeDeniedConnect,
      );
      assert.equal(personalIngressEntries, 0);
      activePersonalUser = stableUser;
      const deniedClaimNonce = randomUUID();
      const claimPersonal = store.claimConnect.bind(store);
      const claimSpy = vi
        .spyOn(store, "claimConnect")
        .mockImplementationOnce(async (actorUserId, operationNonce) => {
          const claimed = await claimPersonal(actorUserId, operationNonce);
          activePersonalUser = member.userId!;
          return claimed;
        });
      try {
        await assert.rejects(
          sessionPersonal.connect(
            { nonce: deniedClaimNonce, profileId, label: "Denied after claim" },
            sentinel,
          ),
        );
      } finally {
        claimSpy.mockRestore();
      }
      const deniedClaim = await store.readOperation(
        stableUser,
        deniedClaimNonce,
      );
      assert.equal(deniedClaim.phase, "submitted");
      assert.equal(deniedClaim.source, null);
      assert.equal(personalIngressEntries, 0);
      activePersonalUser = stableUser;
      // Retained claim is readback-only even after the owner returns.
      await sessionPersonal.connect(
        { nonce: deniedClaimNonce, profileId, label: "Denied after claim" },
        sentinel,
      );
      assert.equal(personalIngressEntries, 0);
      const personalIntent = {
        nonce: randomUUID(),
        profileId,
        label: "  Personal canonical  ",
      };
      const attempts = await Promise.all([
        personal().connect(personalIntent, sentinel),
        personal().connect(personalIntent, sentinel),
      ]);
      assert.equal(personalIngressEntries, 1);
      // Original personal ingress kind and owner are loaded from the store;
      // an API-key nonce or foreign user's nonce cannot enter OAuth completion.
      const beforePersonalComplete = oauthCompleteEntries;
      await assert.rejects(
        personal().completeOAuth({
          nonce: personalIntent.nonce,
          callbackURL,
        }),
      );
      assert.equal(oauthCompleteEntries, beforePersonalComplete);
      assert.ok(attempts.every((r) => r.operation.sourceId === null));
      const personalOriginal = await store.readOperation(
        stableUser,
        personalIntent.nonce,
      );
      assert.equal(personalOriginal.intent.action, "connect");
      if (personalOriginal.intent.action !== "connect")
        throw new Error("expected_connect");
      assert.equal(personalOriginal.intent.displayName, "Personal canonical");
      assert.equal(
        await db.providerAccountConnection.count({
          where: { id: personalOriginal.intent.proposedSourceId },
        }),
        0,
      );
      const persisted = await db.personalAccountOperation.findUniqueOrThrow({
        where: { id: personalOriginal.id },
      });
      assert.equal(
        JSON.stringify(persisted, (_, v) =>
          typeof v === "bigint" ? v.toString() : v,
        ).includes(sentinel),
        false,
      );
      hidePersonalReadback = false;
      assert.ok(account);
      const personalOriginalAccount = account;
      // RED: a later owner/epoch/revision replaces the original operation result.
      for (const patch of [
        { ownerRef: "foreign-owner" },
        { authorizationEpoch: 4 },
        { metadataRevision: 3 },
      ]) {
        account = { ...personalOriginalAccount, ...patch };
        assert.equal(
          (await personal().operation(personalIntent.nonce)).sourceId,
          null,
        );
        assert.equal(genericReadRefs.at(-1), personalOriginal.id);
      }
      account = personalOriginalAccount;
      // Switch at the actual inner SDK GET: no connect mirror/P binding may be finalized.
      afterAccountRead = async () => {
        activePersonalUser = member.userId!;
      };
      await assert.rejects(sessionPersonal.operation(personalIntent.nonce));
      assert.equal(
        await db.providerAccountConnection.count({
          where: { id: personalOriginal.intent.proposedSourceId },
        }),
        0,
      );
      assert.equal(
        await db.workspaceAccountBinding.count({
          where: { connectionId: personalOriginal.intent.proposedSourceId },
        }),
        0,
      );
      activePersonalUser = stableUser;
      const finalized = await Promise.all([
        personal().operation(personalIntent.nonce),
        personal().operation(personalIntent.nonce),
      ]);
      assert.equal(
        finalized[0]!.sourceId,
        personalOriginal.intent.proposedSourceId,
      );
      assert.deepEqual(finalized[0], finalized[1]);
      assert.equal(finalized[0]!.phase, "applied");
      assert.equal(
        await db.workspaceAccountBinding.count({
          where: { connectionId: personalOriginal.intent.proposedSourceId },
        }),
        1,
      );
      assert.equal(personalIngressEntries, 1);
      const catalogForeignUser = `h-http-foreign-${randomUUID()}`;
      await db.user.create({ data: { id: catalogForeignUser } });
      await store.resolvePersonalWorkspace(catalogForeignUser);
      const foreign = createDisabledPersonalAccountsAdapter({
        authorizeUser: async () => catalogForeignUser,
        store,
        control: {
          role: "consumer-control",
          origin: `http://127.0.0.1:${address.port}`,
          token: "t",
        },
        profiles: new Map([[profileId, "api-key-create"]]),
      });
      // Catalog is owner-filtered before keyset limit; no remote read, pending
      // finalization, Gateway identity, operation reference or org labels leak.
      const sourceId = personalOriginal.intent.proposedSourceId;
      const pendingNonce = randomUUID();
      const pendingId = `${sourceId}-catalog-pending`;
      const reservedPending = await store.reserveConnect({
        ...personalOriginal.intent,
        clientOperationId: pendingNonce,
        proposedSourceId: pendingId,
      });
      await db.providerAccountConnection.createMany({
        data: [
          {
            id: pendingId,
            ownerUserId: stableUser,
            gatewayAccountRef: `${prefix}-pending-private-gateway`,
            gatewayOperationRef: reservedPending.id,
            profileRef: profileId,
            displayName: "Pending own source",
            state: "pending",
            pendingSourceOperationId: reservedPending.id,
          },
          {
            id: `${sourceId}-0-foreign`,
            ownerUserId: catalogForeignUser,
            gatewayAccountRef: `${prefix}-foreign-private-gateway`,
            profileRef: profileId,
            displayName: "Foreign private source",
            state: "active",
          },
        ],
      });
      const beforeCatalog = httpReads;
      const firstPage = await personal().list({ limit: 1 });
      assert.equal(firstPage.sources.length, 1);
      assert.equal(firstPage.sources[0]!.sourceId, sourceId);
      assert.equal(firstPage.nextCursor, sourceId);
      const secondPage = await personal().list({
        limit: 1,
        afterSourceId: firstPage.nextCursor!,
      });
      assert.deepEqual(secondPage, {
        sources: [
          {
            sourceId: pendingId,
            label: "Pending own source",
            profileId,
            state: "pending",
            metadataRevision: 1,
            sourceOperationPending: true,
          },
        ],
        nextCursor: null,
      });
      assert.equal((await personal().list()).sources.length, 2);
      await assert.rejects(personal().list({ limit: 101 }));
      assert.equal(httpReads, beforeCatalog);
      assert.equal(
        (
          await db.providerAccountConnection.findUniqueOrThrow({
            where: { id: pendingId },
          })
        ).pendingSourceOperationId,
        reservedPending.id,
      );
      for (const secret of [
        "gatewayAccountRef",
        "ownerUserId",
        "authorizationEpoch",
        reservedPending.id,
      ])
        assert.equal(
          JSON.stringify([firstPage, secondPage]).includes(secret),
          false,
        );

      // Source-owner revoke remains possible after leaving X. It retires exact
      // BX only, with one retained nonce and honest pending fencing; P/Y survive.
      const orgX = `${prefix}-personal-share-x`;
      const orgY = `${prefix}-personal-share-y`;
      await db.workspace.createMany({
        data: [orgX, orgY].map((id) => ({ id, slug: id, name: id })),
      });
      await db.workspaceMember.createMany({
        data: [orgX, orgY].map((workspaceId) => ({
          workspaceId,
          userId: stableUser,
          role: "admin",
        })),
      });
      const attach = async (targetWorkspaceId: string) =>
        personal().attach({
          nonce: randomUUID(),
          sourceId,
          targetWorkspaceId,
          expectedSourceMetadataRevision: 1,
          expectedGatewayRevision: 2,
          predecessorBindingId: null,
          expectedPredecessorRevision: null,
        });
      // The actual adapter/usecase GET is an await inside the facade's outer call.
      // Session loss there must precede the real store.attach commit.
      const deniedAttachNonce = randomUUID();
      const beforeDeniedAttach = await db.personalAccountOperation.count({
        where: { actorUserId: stableUser },
      });
      afterAccountRead = async () => {
        activePersonalUser = member.userId!;
      };
      await assert.rejects(
        sessionPersonal.attach({
          nonce: deniedAttachNonce,
          sourceId,
          targetWorkspaceId: orgX,
          expectedSourceMetadataRevision: 1,
          expectedGatewayRevision: 2,
          predecessorBindingId: null,
          expectedPredecessorRevision: null,
        }),
      );
      assert.equal(
        await db.personalAccountOperation.count({
          where: { actorUserId: stableUser },
        }),
        beforeDeniedAttach,
      );
      assert.equal(
        await db.workspaceAccountBinding.count({
          where: { connectionId: sourceId, workspaceId: orgX },
        }),
        0,
      );
      activePersonalUser = stableUser;
      const bx = await attach(orgX);
      const by = await attach(orgY);
      assert.ok(bx.bindingId && by.bindingId);
      const revoke = {
        nonce: randomUUID(),
        sourceId,
        targetWorkspaceId: orgX,
        expectedSourceMetadataRevision: 1,
        expectedGatewayRevision: 2,
        bindingId: bx.bindingId,
        expectedBindingRevision: 1,
      };
      const beforeRevoke = httpReads;
      // A target admin is not the source owner at this seam.
      await db.workspaceMember.create({
        data: { workspaceId: orgX, userId: catalogForeignUser, role: "admin" },
      });
      await assert.rejects(foreign.revoke(revoke));
      await assert.rejects(
        personal().revoke({ ...revoke, expectedBindingRevision: 2 }),
      );
      const beforeSessionLoss =
        await db.workspaceAccountBinding.findUniqueOrThrow({
          where: { id: bx.bindingId },
        });
      const beforeSessionLossOperations =
        await db.personalAccountOperation.count({
          where: { actorUserId: stableUser },
        });
      let authorizationCalls = 0;
      await assert.rejects(
        personal(async () =>
          ++authorizationCalls === 1 ? stableUser : member.userId!,
        ).revoke(revoke),
      );
      assert.deepEqual(
        await db.workspaceAccountBinding.findUniqueOrThrow({
          where: { id: bx.bindingId },
        }),
        beforeSessionLoss,
      );
      assert.equal(
        await db.personalAccountOperation.count({
          where: { actorUserId: stableUser },
        }),
        beforeSessionLossOperations,
      );
      await db.workspaceMember.deleteMany({
        where: { workspaceId: orgX, userId: stableUser },
      });
      const revokedShare = await personal().revoke(revoke);
      assert.equal(revokedShare.operation.bindingId, bx.bindingId);
      assert.equal(revokedShare.operation.state, "revoked");
      assert.equal(revokedShare.operation.available, false);
      assert.equal(revokedShare.remoteFenceDelivery, "remote_pending");
      assert.deepEqual(await personal().revoke(revoke), revokedShare);
      await assert.rejects(
        personal().revoke({ ...revoke, bindingId: by.bindingId }),
      );
      assert.equal(httpReads, beforeRevoke); // denial requires no remote authority/ACK
      const retainedX = await db.workspaceAccountBinding.findUniqueOrThrow({
        where: { id: bx.bindingId },
      });
      assert.equal(
        retainedX.pendingFenceOperationId,
        revokedShare.operation.operationId,
      );
      assert.equal(retainedX.revision, 2);
      assert.equal(
        (
          await db.workspaceAccountBinding.findUniqueOrThrow({
            where: { id: by.bindingId },
          })
        ).state,
        "active",
      );
      assert.equal(
        (
          await db.workspaceAccountBinding.findUniqueOrThrow({
            where: { id: finalized[0]!.bindingId! },
          })
        ).state,
        "active",
      );
      assert.equal(
        (
          await db.providerAccountConnection.findUniqueOrThrow({
            where: { id: sourceId },
          })
        ).state,
        "active",
      );
      const beforeForeign = httpReads;
      await assert.rejects(foreign.operation(personalIntent.nonce));
      await assert.rejects(
        foreign.completeOAuth({
          nonce: personalIntent.nonce,
          callbackURL,
        }),
      );
      assert.equal(oauthCompleteEntries, beforePersonalComplete);
      assert.equal(httpReads, beforeForeign); // foreign receipt never reaches Gateway
      // Existing production personal zero-entry assertions above remain mandatory;
      // public factory/list/GET never materializes these pending/applied sources.
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
      // This checked disposable database retains its synthetic rows and immutable
      // personal receipts for inspection. Whole-fixture disposal belongs to the
      // owning harness; raw row deletion must not bypass current owner guards.
      await db.$disconnect();
    }
  },
  30000,
);
