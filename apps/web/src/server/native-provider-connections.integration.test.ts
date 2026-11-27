import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { expect, it } from "vitest";
import * as c from "@agent-teams/account-gateway/contracts";
import { createManagementClient } from "@agent-teams/account-gateway/http";
import { createAccountsAdapter } from "./account-gateway-accounts";

/** Real installed SDK HTTP: new native identity, bounded primitives, original recovery. */
it("uses native methods without provider code and recovers after discovery disappears", async () => {
  const methods: c.ConnectionMethodV3[] = [
    {
      methodId: "structured",
      revision: 1,
      configurationGeneration: "generation-1",
      label: "Service identity",
      create: true,
      reconnect: true,
      allowedCredentialPolicies: ["cloud_identity"],
      requirements: [
        "native_dispatch/v1",
        "effect_fence/v1",
        "owner_scoped_custody/v1",
      ],
      availability: "enabled",
      interaction: {
        kind: "credential_form",
        inputFields: [
          {
            fieldId: "document",
            label: "Identity document",
            kind: "document",
            required: true,
            maxBytes: 65536,
          },
        ],
      },
    },
    {
      methodId: "browser",
      revision: 1,
      configurationGeneration: "generation-1",
      label: "Browser",
      create: true,
      reconnect: true,
      allowedCredentialPolicies: ["subscription_session"],
      requirements: [
        "native_dispatch/v1",
        "effect_fence/v1",
        "owner_scoped_custody/v1",
      ],
      availability: "enabled",
      interaction: {
        kind: "browser",
        callbackMode: "manual",
        completionInputKind: "authorization_code",
      },
    },
    {
      methodId: "device",
      revision: 1,
      configurationGeneration: "generation-1",
      label: "Device",
      create: true,
      reconnect: true,
      allowedCredentialPolicies: ["delegated_identity"],
      requirements: [
        "native_dispatch/v1",
        "effect_fence/v1",
        "owner_scoped_custody/v1",
      ],
      availability: "enabled",
      interaction: { kind: "device" },
    },
  ];
  const catalog = c.providerConnectionCapabilitiesV3.parse({
    contract: "provider-connections/v3",
    capabilities: [
      {
        profileId: "new-native-profile",
        provider: { id: "new-provider", label: "New provider" },
        product: { id: "mixed", label: "API and credits" },
        region: { id: "global", label: "Global" },
        protocol: "openai-responses",
        models: [
          {
            modelId: "new-model",
            reasoning: null,
            fast: null,
            tools: { allowed: ["function"], default: "function" },
          },
        ],
        modelPolicy: {
          sourceId: "new-model-source",
          contract: "native-account-models/v2",
          unavailableFallback: "deny",
        },
        methods,
        accountInfo: true,
        limitsContract: "account-limits/v3",
        availability: "enabled",
      },
    ],
  });
  const receipts = new Map<string, c.ConnectionOperation>();
  const effects: { path: string; input: Record<string, unknown> }[] = [];
  let discoveryAvailable = true;
  let readbackMissing = false;
  let discoveryReads = 0;
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    const path = request.url!;
    if (path === "/v3/provider-connection-capabilities") {
      discoveryReads++;
      response.statusCode = discoveryAvailable ? 200 : 503;
      response.end(
        JSON.stringify(
          discoveryAvailable
            ? catalog
            : {
                code: "unavailable",
                effect: "not_dispatched",
                traceRef: "synthetic",
                retry: { kind: "never" },
              },
        ),
      );
      return;
    }
    if (path.startsWith("/v3/operations/")) {
      if (readbackMissing) {
        response.statusCode = 404;
        response.end(JSON.stringify({ error: "operation_not_observed" }));
        return;
      }
      response.end(
        JSON.stringify(
          receipts.get(
            decodeURIComponent(path.slice("/v3/operations/".length)),
          ),
        ),
      );
      return;
    }
    const buffers: Buffer[] = [];
    for await (const chunk of request) buffers.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(buffers).toString()) as Record<
      string,
      unknown
    >;
    effects.push({ path, input });
    if (path === "/v3/accounts/connections/begin") {
      const binding = c.connectionBinding.parse(input.connection);
      const method = methods.find(
        (method) => method.methodId === binding.methodId,
      )!;
      const receipt = c.connectionOperation.parse({
        operation: { operationRef: input.operationId, state: "pending" },
        connection: { connection: binding, method },
      });
      receipts.set(String(input.operationId), receipt);
      response.statusCode = 202;
      response.end(
        JSON.stringify({
          ...receipt,
          ...(method.interaction.kind === "browser"
            ? {
                challenge: {
                  kind: "browser",
                  authorizationURL:
                    "https://identity.example.invalid/authorize?sensitive=once",
                },
              }
            : method.interaction.kind === "device"
              ? {
                  challenge: {
                    kind: "device",
                    userCode: "TEST-CODE",
                    verificationURL: "https://identity.example.invalid/device",
                    expiresAt: "2099-01-01T00:00:00Z",
                    intervalSeconds: 3,
                  },
                }
              : {}),
        }),
      );
      return;
    }
    if (
      path === "/v3/accounts/connections/submit" ||
      path === "/v3/accounts/connections/poll"
    ) {
      response.statusCode = 202;
      response.end(JSON.stringify(receipts.get(String(input.operationId))));
      return;
    }
    response.statusCode = 404;
    response.end("{}");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_address");
  type Input = Parameters<typeof createAccountsAdapter>[0];
  const unused = new Proxy(
    {},
    {
      get() {
        throw new Error("pending_projection_must_not_touch_mirrors");
      },
    },
  );
  let authorized = true;
  const adapter = createAccountsAdapter({
    gateway: createManagementClient({
      role: "management",
      origin: `http://127.0.0.1:${address.port}`,
      token: "synthetic",
      timeoutMs: 2000,
    }),
    authorize: async () => {
      if (!authorized) throw new Error("revoked");
      return {
        workspaceId: "workspace",
        actor: { userId: "admin", githubUserId: "", githubLogin: "synthetic" },
      };
    },
    accounts: unused as Input["accounts"],
    synchronization: unused as Input["synchronization"],
    bindingDependencies: unused as Input["bindingDependencies"],
    apiKeyProfiles: new Map(),
  });
  const selection = (methodId: string) => ({
    profileId: "new-native-profile",
    methodId,
    methodRevision: 1,
    configurationGeneration: "generation-1",
  });
  try {
    expect((await adapter.reviewCatalog())[0]).toMatchObject({
      id: "new-native-profile",
      connection: { provider: "new-provider" },
      models: ["new-model"],
    });
    const nonce = randomUUID();
    const result = await adapter.beginNative(
      "context",
      { nonce, connection: selection("browser") },
      {},
    );
    expect(result).toMatchObject({
      status: "ok",
      value: {
        operation: {
          nonce,
          state: "pending",
          native: { connection: selection("browser") },
        },
        authorizationURL: expect.any(String),
      },
    });
    discoveryAvailable = false;
    const reads = discoveryReads;
    const recovered = await adapter.operation("context", nonce);
    expect(recovered).toMatchObject({
      status: "ok",
      value: { state: "pending", native: { connection: selection("browser") } },
    });
    expect(JSON.stringify(recovered)).not.toContain("sensitive=once");
    expect(discoveryReads).toBe(reads);
    const opaque = " native callback # state, whitespace is native-owned ";
    expect(
      await adapter.continueNative("context", nonce, { completion: opaque }),
    ).toMatchObject({ status: "ok", value: { state: "pending" } });
    expect(effects.at(-1)?.input.inputFields).toEqual({ completion: opaque });
    discoveryAvailable = true;
    const document =
      '{"native_type":"future-agent","synthetic_secret":"DO_NOT_CACHE"}';
    const form = await adapter.beginNative(
      "context",
      { nonce: randomUUID(), connection: selection("structured") },
      { document },
    );
    expect(form).toMatchObject({
      status: "ok",
      value: { operation: { state: "pending" } },
    });
    expect(JSON.stringify(form)).not.toContain("DO_NOT_CACHE");
    const deviceNonce = randomUUID();
    expect(
      await adapter.beginNative(
        "context",
        { nonce: deviceNonce, connection: selection("device") },
        {},
      ),
    ).toMatchObject({
      status: "ok",
      value: { deviceAuthorization: { userCode: "TEST-CODE" } },
    });
    expect(await adapter.continueNative("context", deviceNonce)).toMatchObject({
      status: "ok",
    });
    const count = effects.length;
    expect(
      await adapter.beginNative(
        "context",
        {
          nonce: randomUUID(),
          connection: { ...selection("structured"), methodRevision: 2 },
        },
        { document },
      ),
    ).toMatchObject({ status: "denied" });
    expect(effects).toHaveLength(count);
    readbackMissing = true;
    expect(await adapter.operation("context", nonce)).toMatchObject({
      status: "ok",
      value: { nonce, state: "unknown", cleanup: "unresolved" },
    });
    expect(
      await adapter.continueNative("context", nonce, { completion: opaque }),
    ).toMatchObject({
      status: "ok",
      value: { nonce, state: "unknown", cleanup: "unresolved" },
    });
    expect(effects).toHaveLength(count);
    readbackMissing = false;
    authorized = false;
    expect(
      await adapter.continueNative("context", nonce, { completion: opaque }),
    ).toMatchObject({ status: "denied" });
    expect(effects).toHaveLength(count);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
