import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it } from "vitest";
import { accountLimitsReader } from "./account-limits-composition";

const profileId = "kimi-code-global-responses-apikey-v1";
const target = {
  ownerRef: "test-owner",
  accountRef: "test-account",
  profileId,
  expectedAuthorizationEpoch: 3,
};
const capability = {
  contract: "provider-connections/v1",
  profileId,
  provider: { identity: "kimi", label: "Kimi Code" },
  plan: { identity: "coding_plan", label: "Kimi Code" },
  region: { identity: "global", label: "Global" },
  protocol: "openai-responses",
  modelIds: ["k3-256k"],
  authMethods: ["api_key"],
  completionInputKind: "none",
  availability: "enabled",
  oauthCallbackMode: null,
  reconnect: "replace_api_key",
  limitsContract: "account-limits/v2",
  models: [
    {
      modelId: "k3-256k",
      reasoning: null,
      fast: null,
      tools: { allowed: ["function"], default: "function" },
    },
  ],
};
const observation = {
  status: "snapshot",
  physicalGeneration: "native-generation",
  principalVersion: "principal",
  revision: 7,
  scope: "subscription",
  windows: [
    {
      id: "five_hour",
      provider: "kimi",
      dimension: "plan_quota",
      unit: "requests",
      period: { kind: "duration", durationSeconds: 18000 },
      label: "5h",
      usedPercent: 0,
      observedAt: "2026-10-23T10:00:00Z",
      resetAt: null,
    },
    {
      id: "monthly",
      provider: "kimi",
      dimension: "plan_quota",
      unit: "requests",
      period: { kind: "monthly_billing_cycle" },
      label: "Month",
      usedPercent: null,
      observedAt: "2026-10-23T10:00:00Z",
      resetAt: "2026-11-01T00:00:00Z",
    },
  ],
};
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
async function fixture(
  options: {
    missing?: boolean;
    denied?: boolean;
    foreignProvider?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const server = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    expect(request.headers.authorization).toBe(
      "Bearer test-control-credential",
    );
    response.setHeader("content-type", "application/json");
    if (request.url === "/v1/provider-connection-capabilities") {
      if (options.denied) {
        response.statusCode = 403;
        response.end(
          JSON.stringify({
            code: "forbidden",
            traceRef: "fixture-denial",
            effect: "not_dispatched",
            retry: { kind: "never" },
          }),
        );
      } else
        response.end(
          JSON.stringify({
            contract: "provider-connections/v1",
            capabilities: options.missing ? [] : [capability],
          }),
        );
    } else if (request.url === "/v2/capabilities/account-limits") {
      response.end(
        JSON.stringify({
          contract: "account-limits/v2",
          cachedRead: true,
          quotaOnlyRefresh: false,
        }),
      );
    } else if (request.url === "/v2/account-limits/read") {
      let body = "";
      for await (const chunk of request) body += chunk;
      bodies.push(JSON.parse(body));
      response.end(
        JSON.stringify(
          options.foreignProvider
            ? {
                ...observation,
                windows: observation.windows.map((window) => ({
                  ...window,
                  provider: "glm",
                })),
              }
            : observation,
        ),
      );
    } else if (request.url === "/v1/capabilities/account-limits") {
      response.end(
        JSON.stringify({
          contract: "account-limits/v1",
          cachedRead: true,
          quotaOnlyRefresh: false,
        }),
      );
    } else if (request.url === "/v1/account-limits/read") {
      response.end(JSON.stringify({ status: "unknown" }));
    } else {
      response.statusCode = 500;
      response.end("{}");
    }
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture_address");
  const reader = await accountLimitsReader({
    role: "consumer-control",
    origin: `http://127.0.0.1:${address.port}`,
    token: "test-control-credential",
  });
  return { reader, calls, bodies };
}

it("selects declared v2 once through the installed SDK and preserves month, zero and unknown", async () => {
  const f = await fixture();
  expect(f.calls).toEqual([]);
  const [first, second] = await Promise.all([
    f.reader.read(target),
    f.reader.read(target),
  ]);
  expect(first).toEqual(second);
  expect(first).toMatchObject({
    status: "snapshot",
    windows: [
      {
        id: "five_hour",
        family: "kimi",
        basis: "duration",
        durationSeconds: 18000,
        usedPercent: 0,
      },
      {
        id: "monthly",
        family: "kimi",
        basis: "billing_cycle",
        durationSeconds: null,
        usedPercent: null,
        resetAt: "2026-11-01T00:00:00Z",
      },
    ],
  });
  expect(f.calls).toEqual([
    "GET /v1/provider-connection-capabilities",
    "GET /v2/capabilities/account-limits",
    "POST /v2/account-limits/read",
    "POST /v2/account-limits/read",
  ]);
  expect(f.bodies).toEqual([target, target]);
});

it("keeps old Codex reads on v1 without discovering or probing v2", async () => {
  const f = await fixture();
  expect(
    await f.reader.read({
      ...target,
      profileId: "openai-codex-oauth-responses-v1",
    }),
  ).toEqual({ status: "unknown" });
  expect(f.calls).toEqual([
    "GET /v1/capabilities/account-limits",
    "POST /v1/account-limits/read",
  ]);
});

it("does not expose a different provider's otherwise valid observation", async () => {
  const f = await fixture({ foreignProvider: true });
  expect(await f.reader.read(target)).toEqual({
    status: "unavailable",
    reason: "invalid_snapshot",
  });
  expect(f.calls).toHaveLength(3);
});

it("does not probe v1 when a new profile has no advertised limits contract", async () => {
  const f = await fixture({ missing: true });
  expect(await f.reader.read(target)).toEqual({
    status: "unsupported",
    reason: "unsupported_profile",
  });
  expect(f.calls).toEqual(["GET /v1/provider-connection-capabilities"]);
});

it("clears observations on capability authorization loss instead of falling back", async () => {
  const f = await fixture({ denied: true });
  expect(await f.reader.read(target)).toEqual({
    status: "unknown",
    reason: "generation_changed",
  });
  expect(f.calls).toEqual(["GET /v1/provider-connection-capabilities"]);
});
