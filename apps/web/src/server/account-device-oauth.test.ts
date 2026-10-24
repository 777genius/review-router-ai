import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, expect, test } from "vitest";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createManagementClient,
  secretSubmission,
} from "@agent-teams/account-gateway/http";
import {
  ProviderAccountError,
  type PersonalAccountOperationStore,
  type PersonalOperationResult,
} from "@reviewrouter/features-provider-accounts";
import {
  personalIntentDigest,
  personalOperationId,
  snapshotPersonalIntent,
} from "@reviewrouter/features-provider-accounts/synchronization";
import {
  accountGatewayUserOwnerRef,
  accountGatewayWorkspaceOwnerRef,
  createAccountsAdapter,
  createDisabledPersonalAccountsAdapter,
} from "./account-gateway-accounts";

const profileId = "openai-codex-oauth-responses-v1";
const grokProfileId = "grok-subscription-responses-oauth-v1";
const claudeProfileId = "anthropic-claude-oauth-messages-v1";
const authorizationCode = `synthetic-claude-code#${"c".repeat(64)}`;
const handoff = {
  userCode: "ABCD-EFGH",
  verificationURL: "https://auth.openai.com/codex/device",
  expiresAt: "2099-01-01T00:00:00Z",
  intervalSeconds: 5,
};
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

async function fixture(
  selectedProfileId:
    | typeof profileId
    | typeof claudeProfileId
    | typeof grokProfileId = profileId,
) {
  const profileId = selectedProfileId;
  const claude = profileId === claudeProfileId;
  const grok = profileId === grokProfileId;
  const grokAuthorization = new URL("https://auth.x.ai/oauth2/authorize");
  grokAuthorization.search = new URLSearchParams({
    response_type: "code",
    redirect_uri: "http://127.0.0.1:56121/callback",
    code_challenge_method: "S256",
    scope: "openid profile email offline_access grok-cli:access api:access",
    client_id: "synthetic-grok-browser",
    state: "c".repeat(64),
    code_challenge: "b".repeat(43),
    nonce: "d".repeat(43),
  }).toString();
  const claudeAuthorization = new URL("https://claude.com/cai/oauth/authorize");
  claudeAuthorization.search = new URLSearchParams({
    code: "true",
    client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
    response_type: "code",
    redirect_uri: "https://platform.claude.com/oauth/code/callback",
    code_challenge_method: "S256",
    scope:
      "user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload",
    state: "c".repeat(64),
    code_challenge: "b".repeat(43),
  }).toString();
  let actor = "device-owner";
  let beginCount = 0,
    pollCount = 0,
    finalized = 0,
    loseBegin = false;
  let afterRead: (() => void) | undefined, afterPoll: (() => void) | undefined;
  let pollState: "pending" | "applied" | "rejected" = "pending";
  const operations = new Map<string, c.Operation>();
  const rows = new Map<string, PersonalOperationResult>();
  const begins: c.OAuthBegin[] = [];
  const polls: Array<{ operationId: string; ownerRef: string }> = [];
  const completions: secretSubmission.OAuthComplete[] = [];
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET") {
      if (request.url === "/v1/profiles") {
        response.end(
          JSON.stringify({
            profiles: [
              {
                profileId,
                protocol: "openai-responses",
                authKinds: ["oauth"],
                modelIds: ["codex-fixture"],
              },
            ],
          }),
        );
      } else if (request.url?.startsWith("/v1/operations/")) {
        const operation = operations.get(
          decodeURIComponent(request.url.slice("/v1/operations/".length)),
        );
        if (!operation) {
          response.statusCode = 404;
          response.end(JSON.stringify({ error: { code: "not_found" } }));
          return;
        }
        afterRead?.();
        afterRead = undefined;
        response.end(JSON.stringify(operation));
      } else {
        response.end(
          JSON.stringify({
            accountRef: "device-account",
            ownerRef: accountGatewayUserOwnerRef("device-owner"),
            profileId,
            displayName: "My Codex",
            state: "active",
            metadataRevision: 1,
            authorizationEpoch: 1,
          }),
        );
      }
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = JSON.parse(Buffer.concat(chunks).toString()) as Record<
      string,
      unknown
    >;
    if (request.url === "/v1/accounts/oauth/begin") {
      const input = c.oauthBegin.parse(raw);
      begins.push(input);
      beginCount++;
      const operation: c.Operation = {
        operationRef: input.operationId,
        state: "pending",
        ...(input.method === "device_code"
          ? { oauthMethod: "device_code" }
          : {}),
      };
      operations.set(input.operationId, operation);
      if (loseBegin) {
        response.destroy();
        return;
      }
      response.statusCode = 202;
      response.end(
        JSON.stringify({
          operation,
          ...(grok
            ? { authorizationURL: grokAuthorization.href }
            : claude
              ? { authorizationURL: claudeAuthorization.href }
              : { deviceAuthorization: handoff }),
        }),
      );
    } else if (request.url === "/v1/accounts/oauth/complete") {
      const input = secretSubmission.oauthComplete.parse(raw);
      completions.push(input);
      const operation = {
        operationRef: input.operationId,
        state: "pending" as const,
      };
      operations.set(input.operationId, operation);
      response.statusCode = 202;
      response.end(JSON.stringify(operation));
    } else if (request.url === "/v1/accounts/oauth/poll") {
      const input = raw as { operationId: string; ownerRef: string };
      polls.push(input);
      pollCount++;
      const operation = c.operation.parse({
        operationRef: input.operationId,
        state: pollState,
        oauthMethod: "device_code",
        ...(pollState === "rejected"
          ? {
              error: {
                code: "conflict" as const,
                traceRef: "fixture-rejected",
                effect: "not_dispatched" as const,
                retry: { kind: "never" as const },
              },
            }
          : {}),
        ...(pollState === "applied"
          ? {
              result: {
                kind: "account" as const,
                accountRef: "device-account",
                metadataRevision: 1,
                authorizationEpoch: 1,
              },
            }
          : {}),
      });
      operations.set(input.operationId, operation);
      afterPoll?.();
      afterPoll = undefined;
      response.end(JSON.stringify(operation));
    } else {
      response.statusCode = 400;
      response.end("{}");
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup.push(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_address");
  const control = {
    role: "consumer-control" as const,
    origin: `http://127.0.0.1:${address.port}`,
    token: "synthetic",
    timeoutMs: 2000,
  };
  const store: PersonalAccountOperationStore = {
    async resolvePersonalWorkspace(user) {
      return `personal-${user}`;
    },
    async listOwnedSources() {
      return [];
    },
    async findOwnedSource() {
      throw new ProviderAccountError("not_found");
    },
    async reserveConnect(intent) {
      const key = `${intent.actorUserId}/${intent.clientOperationId}`;
      const prior = rows.get(key);
      if (prior) {
        if (personalIntentDigest(prior.intent) !== personalIntentDigest(intent))
          throw new ProviderAccountError("operation_conflict");
        return prior;
      }
      const row: PersonalOperationResult = {
        id: personalOperationId(intent.actorUserId, intent.clientOperationId),
        intent: snapshotPersonalIntent(intent),
        phase: "reserved",
        source: null,
        binding: null,
        available: false,
      };
      rows.set(key, row);
      return row;
    },
    async claimConnect(user, nonce) {
      const row = await this.readOperation(user, nonce);
      if (row.phase !== "reserved") return false;
      rows.set(`${user}/${nonce}`, { ...row, phase: "submitted" });
      return true;
    },
    async readOperation(user, nonce) {
      const row = rows.get(`${user}/${nonce}`);
      if (!row) throw new ProviderAccountError("not_found");
      return row;
    },
    async noteConnectPhase(user, nonce, phase) {
      rows.set(`${user}/${nonce}`, {
        ...(await this.readOperation(user, nonce)),
        phase,
      });
    },
    async finalizeConnect(user, nonce, account) {
      const row = await this.readOperation(user, nonce);
      if (row.intent.action !== "connect") throw new Error("fixture_intent");
      finalized++;
      const applied: PersonalOperationResult = {
        ...row,
        phase: "applied",
        source: {
          id: row.intent.proposedSourceId,
          owner: { kind: "user", userId: user },
          gatewayAccountRef: account.accountRef,
          gatewayOperationRef: row.id,
          profileRef: account.profileId,
          displayName: account.displayName,
          state: "active",
          metadataRevision: 1,
          authorizationEpochMirror: account.authorizationEpoch,
        },
      };
      rows.set(`${user}/${nonce}`, applied);
      return applied;
    },
    async attach() {
      throw new Error("unused");
    },
    async revoke() {
      throw new Error("unused");
    },
    async changeEligibility() {
      throw new Error("unused");
    },
  };
  const personal = () =>
    createDisabledPersonalAccountsAdapter({
      authorizeUser: async () => actor,
      store,
      control,
      profiles: new Map([[profileId, "oauth-begin"]]),
      ...(grok
        ? {
            connectionProfiles: [
              {
                id: grokProfileId,
                label: "Grok",
                oauthMethods: ["browser"] as const,
                connection: {
                  provider: "grok" as const,
                  planLabel: "Subscription",
                  regionLabel: "Global",
                  completionInputKind: "authorization_code" as const,
                  personalOnly: false,
                  limitsContract: "account-limits/v2" as const,
                  modelSettings: [],
                },
              },
            ],
          }
        : {}),
    });
  type WorkspaceInput = Parameters<typeof createAccountsAdapter>[0];
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("unexpected_mirror_access");
      },
    },
  );
  const workspace = createAccountsAdapter({
    gateway: createManagementClient({ ...control, role: "management" }),
    authorize: async (context) => {
      if (context !== "workspace" || actor !== "device-owner")
        throw new Error("denied");
      return {
        workspaceId: "device-workspace",
        actor: { userId: actor, githubUserId: "", githubLogin: "synthetic" },
      };
    },
    accounts: unused as WorkspaceInput["accounts"],
    synchronization: unused as WorkspaceInput["synchronization"],
    bindingDependencies: unused as WorkspaceInput["bindingDependencies"],
    apiKeyProfiles: new Map(),
    ...(claude
      ? { claudeOAuthProfileId: claudeProfileId }
      : { codexOAuthProfileId: "openai-codex-oauth-responses-v1" as const }),
  });
  return {
    personal,
    workspace,
    store,
    rows,
    operations,
    begins,
    polls,
    completions,
    counts: () => ({ beginCount, pollCount, finalized }),
    actor: (value: string) => {
      actor = value;
    },
    loseBegin: () => {
      loseBegin = true;
    },
    afterRead: (hook: () => void) => {
      afterRead = hook;
    },
    afterPoll: (hook: () => void) => {
      afterPoll = hook;
    },
    pollState: (value: typeof pollState) => {
      pollState = value;
    },
  };
}

// Real SDK transport catches handoff persistence, nonce replay, and method-switch regressions.
test("personal device handoff belongs only to the single fresh CAS winner", async () => {
  const f = await fixture();
  const request = {
    nonce: randomUUID(),
    profileId,
    label: "My Codex",
    method: "device_code" as const,
  };
  const fresh = await f.personal().connect(request);
  expect(fresh.deviceAuthorization).toEqual(handoff);
  expect(fresh.operation.oauthMethod).toBe("device_code");
  expect(
    (await f.personal().connect(request)).deviceAuthorization,
  ).toBeUndefined();
  await expect(
    f.personal().connect({ ...request, method: "browser" }),
  ).rejects.toMatchObject({ code: "operation_conflict" });
  const read = await f.personal().operation(request.nonce);
  expect(read.oauthMethod).toBe("device_code");
  expect(JSON.stringify([read, [...f.rows.values()]])).not.toMatch(
    /ABCD-EFGH|deviceAuthorization|verificationURL/,
  );
  expect(f.counts()).toEqual({ beginCount: 1, pollCount: 0, finalized: 0 });
});

test("personal polling reconciles the original device operation once and blocks other nonce/method/owner", async () => {
  const f = await fixture();
  const request = {
    nonce: randomUUID(),
    profileId,
    label: "My Codex",
    method: "device_code" as const,
  };
  await f.personal().connect(request);
  await expect(f.personal().pollOAuth(randomUUID())).rejects.toMatchObject({
    code: "connection_unavailable",
  });
  const original = await f.store.readOperation("device-owner", request.nonce);
  if (original.intent.action !== "connect") throw new Error("fixture_intent");
  const browserIntent = { ...original.intent };
  delete browserIntent.method;
  f.rows.set(`device-owner/${request.nonce}`, {
    ...original,
    intent: browserIntent,
  });
  await expect(f.personal().pollOAuth(request.nonce)).rejects.toMatchObject({
    code: "connection_unavailable",
  });
  f.rows.set(`device-owner/${request.nonce}`, original);
  f.actor("foreign-owner");
  await expect(f.personal().pollOAuth(request.nonce)).rejects.toMatchObject({
    code: "connection_unavailable",
  });
  f.actor("device-owner");
  f.pollState("applied");
  expect((await f.personal().pollOAuth(request.nonce)).phase).toBe("applied");
  expect((await f.personal().pollOAuth(request.nonce)).phase).toBe("applied");
  expect(f.polls).toEqual([
    {
      operationId: original.id,
      ownerRef: accountGatewayUserOwnerRef("device-owner"),
    },
  ]);
  expect(f.counts()).toEqual({ beginCount: 1, pollCount: 1, finalized: 1 });
});

test("personal device poll rechecks session around readback and provider await", async () => {
  const f = await fixture();
  const request = {
    nonce: randomUUID(),
    profileId,
    label: "My Codex",
    method: "device_code" as const,
  };
  await f.personal().connect(request);
  f.afterRead(() => f.actor("foreign-owner"));
  await expect(f.personal().pollOAuth(request.nonce)).rejects.toMatchObject({
    code: "connection_unavailable",
  });
  expect(f.counts().pollCount).toBe(0);
  f.actor("device-owner");
  f.pollState("applied");
  f.afterPoll(() => f.actor("foreign-owner"));
  await expect(f.personal().pollOAuth(request.nonce)).rejects.toMatchObject({
    code: "connection_unavailable",
  });
  expect(f.counts()).toEqual({ beginCount: 1, pollCount: 1, finalized: 0 });
});

test("lost fresh handoff is recoverable by readback without replaying begin or polling", async () => {
  const f = await fixture();
  f.loseBegin();
  const request = {
    nonce: randomUUID(),
    profileId,
    label: "My Codex",
    method: "device_code" as const,
  };
  expect(
    (await f.personal().connect(request)).deviceAuthorization,
  ).toBeUndefined();
  expect(
    (await f.personal().connect(request)).deviceAuthorization,
  ).toBeUndefined();
  await f.personal().operation(request.nonce);
  expect(f.counts()).toEqual({ beginCount: 1, pollCount: 0, finalized: 0 });
});

test("workspace device polling uses the original owner operation and never polls terminal receipts", async () => {
  const f = await fixture();
  const nonce = randomUUID();
  const fresh = await f.workspace.beginOAuth("workspace", {
    nonce,
    profileId,
    method: "device_code",
  });
  expect(fresh).toMatchObject({
    status: "ok",
    value: {
      deviceAuthorization: handoff,
      operation: { oauthMethod: "device_code" },
    },
  });
  expect(f.begins[0]?.method).toBe("device_code");
  expect(await f.workspace.pollOAuth("foreign-context", nonce)).toEqual({
    status: "denied",
  });
  f.pollState("rejected");
  expect(await f.workspace.pollOAuth("workspace", nonce)).toEqual({
    status: "ok",
    value: {
      nonce,
      state: "rejected",
      oauthMethod: "device_code",
      cleanup: "unresolved",
    },
  });
  await f.workspace.pollOAuth("workspace", nonce);
  expect(f.polls).toEqual([
    {
      operationId: f.begins[0]?.operationId,
      ownerRef: accountGatewayWorkspaceOwnerRef("device-workspace"),
    },
  ]);
  expect(f.counts().pollCount).toBe(1);
});

// A saved personal intent must select the sensitive credential shape. A wrong
// callback, owner switch, or device method must never enter completion ingress.
test("Claude personal browser completion is bound to the saved profile and owner without persisting its code", async () => {
  const f = await fixture(claudeProfileId);
  const nonce = randomUUID();
  const fresh = await f.personal().connect({
    nonce,
    profileId: claudeProfileId,
    label: "My Claude",
    method: "browser",
  });
  expect(fresh.authorizationURL).toContain(
    "https://claude.com/cai/oauth/authorize?",
  );
  await expect(
    f.personal().completeOAuth({
      nonce,
      callbackURL: `http://localhost:1455/auth/callback?code=synthetic&state=${"c".repeat(64)}`,
    }),
  ).rejects.toMatchObject({ code: "connection_unavailable" });
  expect(f.completions).toHaveLength(0);
  await expect(
    f
      .personal()
      .completeOAuth({ nonce, authorizationCode: "synthetic-grok-plain-code" }),
  ).rejects.toMatchObject({ code: "connection_unavailable" });
  expect(f.completions).toHaveLength(0);
  f.actor("foreign-owner");
  await expect(
    f.personal().completeOAuth({ nonce, authorizationCode }),
  ).rejects.toMatchObject({ code: "connection_unavailable" });
  f.actor("device-owner");
  await expect(f.personal().pollOAuth(nonce)).rejects.toMatchObject({
    code: "connection_unavailable",
  });
  expect(f.polls).toHaveLength(0);
  expect(
    (await f.personal().completeOAuth({ nonce, authorizationCode })).phase,
  ).toBe("submitted");
  expect(f.completions).toEqual([
    {
      operationId: personalOperationId("device-owner", nonce),
      ownerRef: accountGatewayUserOwnerRef("device-owner"),
      authorizationCode,
    },
  ]);
  expect(JSON.stringify([...f.rows.values()])).not.toMatch(
    /synthetic-claude-code|authorizationCode|claude.com|cccccccc/,
  );
});

test("Claude workspace enrollment defaults to browser, denies device, and forwards only its explicit code ingress", async () => {
  const f = await fixture(claudeProfileId);
  expect(
    await f.workspace.beginOAuth("workspace", {
      nonce: randomUUID(),
      profileId: claudeProfileId,
      method: "device_code",
    }),
  ).toMatchObject({ status: "denied" });
  expect(f.begins).toHaveLength(0);
  const nonce = randomUUID();
  expect(
    await f.workspace.beginOAuth("workspace", {
      nonce,
      profileId: claudeProfileId,
    }),
  ).toMatchObject({ status: "ok", value: { operation: { state: "pending" } } });
  expect(f.begins[0]?.method).toBe("browser");
  expect(
    await f.workspace.completeOAuth("workspace", { nonce, authorizationCode }),
  ).toMatchObject({ status: "ok", value: { nonce, state: "pending" } });
  expect(f.completions).toEqual([
    {
      operationId: f.begins[0]!.operationId,
      ownerRef: accountGatewayWorkspaceOwnerRef("device-workspace"),
      authorizationCode,
    },
  ]);
  expect(
    await f.workspace.completeOAuth("workspace", {
      nonce,
      authorizationCode: "invalid#state",
    }),
  ).toMatchObject({ status: "invalid" });
  expect(f.completions).toHaveLength(1);
});

test.each(["plain_code", "callback_url"] as const)(
  "Grok personal browser completion forwards %s only under the saved Grok profile and owner",
  async (representation) => {
    const f = await fixture(grokProfileId);
    const nonce = randomUUID();
    await f.personal().connect({
      nonce,
      profileId: grokProfileId,
      label: "Own Grok",
      method: "browser",
    });
    expect((await f.personal().operation(nonce)).completion).toMatchObject({
      providerLabel: "Grok",
      inputKind: "authorization_code",
    });
    await expect(
      f.personal().completeOAuth({ nonce, authorizationCode }),
    ).rejects.toMatchObject({ code: "connection_unavailable" });
    expect(f.completions).toHaveLength(0);
    const credential =
      representation === "plain_code"
        ? { authorizationCode: "synthetic-grok-plain-code" }
        : {
            callbackURL: `http://127.0.0.1:56121/callback?code=synthetic-grok&state=${"c".repeat(64)}`,
          };
    f.actor("foreign-owner");
    await expect(
      f.personal().completeOAuth({ nonce, ...credential }),
    ).rejects.toMatchObject({ code: "connection_unavailable" });
    expect(f.completions).toHaveLength(0);
    f.actor("device-owner");
    expect(
      (await f.personal().completeOAuth({ nonce, ...credential })).phase,
    ).toBe("submitted");
    expect(f.completions).toEqual([
      {
        operationId: personalOperationId("device-owner", nonce),
        ownerRef: accountGatewayUserOwnerRef("device-owner"),
        ...credential,
      },
    ]);
    expect(JSON.stringify([...f.rows.values()])).not.toMatch(
      /synthetic-grok|authorizationCode|callbackURL|auth.x.ai/,
    );
  },
);
