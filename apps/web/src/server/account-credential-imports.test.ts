import { once } from "node:events";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  createManagementClient,
  secretSubmission,
} from "@agent-teams/account-gateway/http";
import { createAccountsAdapter } from "./account-gateway-accounts";

it("uses the pinned SDK transport for Codex imports and native-only direct APIs, with method admission before ingress", async () => {
  const codex = "openai-codex-oauth-responses-v1";
  const anthropic = "anthropic-messages-apikey-v1";
  const gemini = "gemini-openai-chat-apikey-v1";
  const entered: ReturnType<typeof secretSubmission.connect.parse>[] = [];
  const modelReads: string[] = [];
  let importEnabled = true;
  let authorized = true;
  const profile = (profileId: string, provider: string) => ({
    profileId,
    provider: { id: provider, label: provider },
    product: { id: "pay_as_you_go", label: "API" },
    region: { id: "global", label: "Global" },
    protocol: "openai-responses",
    models: [
      {
        modelId: "qualified-test-model",
        reasoning: null,
        fast: null,
        tools:
          profileId === codex
            ? { allowed: ["function"], default: "function" }
            : {
                allowed: ["function", "function_and_custom"],
                default: "function_and_custom",
              },
      },
    ],
    methods:
      profileId === codex
        ? [
            {
              kind: "browser",
              completionInputKind: "callback_url",
              callbackMode: "manual_callback_url",
              create: true,
              reconnect: false,
            },
            {
              kind: "credential_import",
              method: "refresh_token",
              maxBytes: 65536,
              create: importEnabled,
              reconnect: true,
            },
            {
              kind: "credential_import",
              method: "oauth_auth_json",
              maxBytes: 65536,
              create: true,
              reconnect: true,
            },
          ]
        : [{ kind: "api_key", create: true, reconnect: true }],
    accountInfo: true,
    limitsContract: "none",
    availability: "enabled",
  });
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && request.url === "/v1/profiles") {
      response.end(
        JSON.stringify({
          profiles: [codex, anthropic, gemini].map((profileId) => ({
            profileId,
            protocol: "openai-responses",
            authKinds: [profileId === codex ? "oauth" : "api_key"],
            modelIds: ["qualified-test-model"],
          })),
        }),
      );
      return;
    }
    if (
      request.method === "GET" &&
      request.url === "/v2/provider-connection-capabilities"
    ) {
      response.end(
        JSON.stringify({
          contract: "provider-connections/v2",
          capabilities: [
            profile(codex, "openai"),
            profile(anthropic, "anthropic"),
            profile(gemini, "gemini"),
          ],
        }),
      );
      return;
    }
    if (request.method === "POST" && request.url === "/v1/accounts") {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const input = secretSubmission.connect.parse(
        JSON.parse(Buffer.concat(chunks).toString("utf8")),
      );
      entered.push(input);
      response.statusCode = 202;
      response.end(
        JSON.stringify({ operationRef: input.operationId, state: "pending" }),
      );
      return;
    }
    if (
      request.method === "POST" &&
      request.url === "/v1/account-models/read"
    ) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const { profileId } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      modelReads.push(profileId);
      response.end(
        JSON.stringify({
          status: "snapshot",
          source: "native_catalog",
          physicalGeneration: "test-generation",
          principalVersion: "test-principal",
          fetchedAt: new Date(Date.now() - 1000).toISOString(),
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          models: [
            {
              modelId: "qualified-test-model",
              reasoning: null,
              fast: null,
              tools: {
                allowed: ["function", "function_and_custom"],
                default: "function_and_custom",
              },
            },
          ],
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end(
      JSON.stringify({
        code: "not_found",
        traceRef: "test-absent",
        effect: "not_dispatched",
        retry: { kind: "never" },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test_address");
  type Input = Parameters<typeof createAccountsAdapter>[0];
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("pending import must not persist provider data");
      },
    },
  );
  const gateway = createManagementClient({
    role: "management",
    origin: `http://127.0.0.1:${address.port}`,
    token: "TEST-only",
    timeoutMs: 2000,
  });
  const adapter = createAccountsAdapter({
    gateway,
    authorize: async () => {
      if (!authorized) throw new Error("denied");
      return { workspaceId: "test-workspace", actor: { userId: "test-admin" } };
    },
    accounts: unused as Input["accounts"],
    synchronization: unused as Input["synchronization"],
    bindingDependencies: unused as Input["bindingDependencies"],
    apiKeyProfiles: new Map(),
    codexOAuthProfileId: codex,
  });
  try {
    for (const method of ["refresh_token", "oauth_auth_json"] as const) {
      const value =
        method === "refresh_token"
          ? "opaque-refresh-token"
          : '{"tokens":{"refresh_token":"opaque-native-json"}}';
      const result = await adapter.mutate(
        "context",
        {
          kind: "connect",
          nonce: randomUUID(),
          profileId: codex,
          label: "TEST Codex",
          credentialImportMethod: method,
        },
        value,
      );
      expect(result).toMatchObject({
        status: "ok",
        value: { state: "pending" },
      });
      if (result.status === "ok") {
        expect(result.value.oauthMethod).toBeUndefined();
        expect(result.value.completion).toBeUndefined();
      }
      expect(entered.at(-1)?.credential).toEqual({
        kind: "credential_import",
        method,
        value,
      });
      expect(JSON.stringify(result)).not.toContain(value);
    }
    for (const profileId of [anthropic, gemini]) {
      expect(
        await adapter.mutate(
          "context",
          { kind: "connect", nonce: randomUUID(), profileId },
          "opaque-key",
        ),
      ).toMatchObject({ status: "ok" });
      expect(entered.at(-1)).toMatchObject({
        profileId,
        credential: { kind: "api_key", value: "opaque-key" },
      });
      // Both v2 admission and the installed SDK account-model reader must retain
      // custom tools; accepting an API key alone does not qualify review models.
      expect(
        (await adapter.reviewCatalog()).find((row) => row.id === profileId),
      ).toMatchObject({
        connection: {
          modelSettings: [
            {
              modelId: "qualified-test-model",
              tools: {
                allowed: ["function", "function_and_custom"],
                default: "function_and_custom",
              },
            },
          ],
        },
      });
      expect(
        await gateway.readAccountModels({
          ownerRef: "test-owner",
          accountRef: "test-account",
          profileId,
          expectedAuthorizationEpoch: 1,
        }),
      ).toMatchObject({
        status: "snapshot",
        source: "native_catalog",
        models: [
          {
            modelId: "qualified-test-model",
            tools: {
              allowed: ["function", "function_and_custom"],
              default: "function_and_custom",
            },
          },
        ],
      });
    }
    expect(modelReads).toEqual([anthropic, gemini]);
    const before = entered.length;
    const intent = {
      kind: "connect" as const,
      nonce: randomUUID(),
      profileId: codex,
      credentialImportMethod: "refresh_token" as const,
    };
    importEnabled = false;
    expect(await adapter.mutate("context", intent, "opaque-disabled")).toEqual({
      status: "denied",
    });
    expect(
      await adapter.mutate(
        "context",
        { ...intent, profileId: anthropic },
        "opaque-wrong-profile",
      ),
    ).toEqual({ status: "denied" });
    expect(await adapter.mutate("context", intent, "é".repeat(32769))).toEqual({
      status: "invalid",
    });
    authorized = false;
    expect(
      await adapter.mutate("context", intent, "opaque-no-access"),
    ).not.toMatchObject({ status: "ok" });
    expect(entered).toHaveLength(before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
