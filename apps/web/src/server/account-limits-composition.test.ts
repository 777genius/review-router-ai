import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import {
  accountLimitsReader,
  accountLimitsRefresher,
  REFRESH_DISCOVERY_TTL_MS,
} from "./account-limits-composition";

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
const nativeCapability = {
  profileId,
  provider: { id: "kimi", label: "Kimi Code" },
  product: { id: "coding_plan", label: "Kimi Code" },
  region: { id: "global", label: "Global" },
  protocol: "openai-responses",
  models: capability.models,
  modelPolicy: {
    sourceId: "native-test-models",
    contract: "native-account-models/v2",
    unavailableFallback: "deny",
  },
  methods: [
    {
      methodId: "api_key",
      revision: 1,
      configurationGeneration: "native-test-config",
      label: "API key",
      create: true,
      reconnect: true,
      allowedCredentialPolicies: ["provider_key"],
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
            fieldId: "api_key",
            label: "API key",
            kind: "secret",
            required: true,
            maxBytes: 65536,
          },
        ],
      },
    },
  ],
  accountInfo: true,
  limitsContract: "account-limits/v3",
  availability: "enabled",
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
    native?: boolean;
  } = {},
) {
  const calls: string[] = [];
  const bodies: unknown[] = [];
  const discoveryVersion = options.native ? "v3" : "v1";
  const limitsVersion = options.native ? "v3" : "v2";
  const server = createServer(async (request, response) => {
    calls.push(`${request.method} ${request.url}`);
    expect(request.headers.authorization).toBe(
      "Bearer test-control-credential",
    );
    response.setHeader("content-type", "application/json");
    if (
      request.url === `/${discoveryVersion}/provider-connection-capabilities`
    ) {
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
            contract: `provider-connections/${discoveryVersion}`,
            capabilities: options.missing
              ? []
              : options.native
                ? [nativeCapability]
                : [
                    capability,
                    {
                      ...capability,
                      profileId: "openai-codex-oauth-responses-v1",
                      provider: { identity: "openai", label: "Codex" },
                      authMethods: ["oauth_authorization_code"],
                      completionInputKind: "callback_url",
                      oauthCallbackMode: "manual_callback_url",
                      reconnect: "none",
                      limitsContract: "account-limits/v1",
                    },
                  ],
          }),
        );
    } else if (
      request.url === `/${limitsVersion}/capabilities/account-limits`
    ) {
      response.end(
        JSON.stringify({
          contract: `account-limits/${limitsVersion}`,
          cachedRead: true,
          quotaOnlyRefresh: false,
        }),
      );
    } else if (request.url === `/${limitsVersion}/account-limits/read`) {
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
  const reader = await accountLimitsReader(
    {
      role: "consumer-control",
      origin: `http://127.0.0.1:${address.port}`,
      token: "test-control-credential",
    },
    options.native ? undefined : "provider-connections/v1",
  );
  return { reader, calls, bodies };
}

it.each([
  { native: false, discovery: "v1", limits: "v2" },
  { native: true, discovery: "v3", limits: "v3" },
])(
  "selects declared $limits once through $discovery discovery and preserves month, zero and unknown",
  async ({ native, discovery, limits }) => {
    const f = await fixture({ native });
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
          family: "native",
          providerId: "kimi",
          basis: "duration",
          durationSeconds: 18000,
          usedPercent: 0,
        },
        {
          id: "monthly",
          family: "native",
          providerId: "kimi",
          basis: "billing_cycle",
          durationSeconds: null,
          usedPercent: null,
          resetAt: "2026-11-01T00:00:00Z",
        },
      ],
    });
    expect(f.calls).toEqual([
      `GET /${discovery}/provider-connection-capabilities`,
      `GET /${limits}/capabilities/account-limits`,
      `POST /${limits}/account-limits/read`,
      `POST /${limits}/account-limits/read`,
    ]);
    expect(f.bodies).toEqual([target, target]);
  },
);

it("keeps explicitly advertised old Codex reads on v1 without probing v2", async () => {
  const f = await fixture();
  expect(
    await f.reader.read({
      ...target,
      profileId: "openai-codex-oauth-responses-v1",
    }),
  ).toEqual({ status: "unknown" });
  expect(f.calls).toEqual([
    "GET /v1/provider-connection-capabilities",
    "GET /v1/capabilities/account-limits",
    "POST /v1/account-limits/read",
  ]);
});

it.each([false, true])(
  "does not expose a different provider's otherwise valid observation (native: %s)",
  async (native) => {
    const f = await fixture({ foreignProvider: true, native });
    expect(await f.reader.read(target)).toEqual({
      status: "unavailable",
      reason: "invalid_snapshot",
    });
    expect(f.calls).toHaveLength(3);
  },
);

it("does not probe v1 when a new profile has no advertised limits contract", async () => {
  const f = await fixture({ missing: true });
  expect(await f.reader.read(target)).toEqual({
    status: "unsupported",
    reason: "unsupported_profile",
  });
  expect(f.calls).toEqual(["GET /v1/provider-connection-capabilities"]);
});

it.each([false, true])(
  "clears observations on capability authorization loss without fallback (native: %s)",
  async (native) => {
    const f = await fixture({ denied: true, native });
    expect(await f.reader.read(target)).toEqual({
      status: "unknown",
      reason: "generation_changed",
    });
    expect(f.calls).toEqual([
      `GET /${native ? "v3" : "v1"}/provider-connection-capabilities`,
    ]);
  },
);

// This transport test catches accidental read/refresh endpoint mixing and unsafe
// error retention; service tests own authorization policy coverage.
it.each([403, 503, 200])(
  "normalizes explicit quota refresh HTTP %s without legacy reads",
  async (status) => {
    const calls: string[] = [];
    const server = createServer((request, response) => {
      calls.push(`${request.method} ${request.url}`);
      response.setHeader("content-type", "application/json");
      if (request.url === "/v1/capabilities/account-limits-refresh") {
        response.end(
          JSON.stringify({
            contract: "account-limits-refresh/v1",
            quotaOnlyRefresh: true,
            profileIds: ["openai-codex-oauth-responses-v1"],
          }),
        );
        return;
      }
      response.statusCode = status;
      response.end(
        JSON.stringify(
          status === 200
            ? { status: "unknown" }
            : {
                code: status === 403 ? "forbidden" : "unavailable",
                traceRef: "test-only",
                effect: "not_dispatched",
                retry: { kind: "never" },
              },
        ),
      );
    });
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture");
    const refresher = accountLimitsRefresher({
      role: "management",
      origin: `http://127.0.0.1:${address.port}`,
      token: "test-credential",
    });
    expect(await refresher.supports("openai-codex-oauth-responses-v1")).toBe(
      true,
    );
    expect(await refresher.supports("foreign")).toBe(false);
    const result = refresher.refresh({
      ...target,
      profileId: "openai-codex-oauth-responses-v1",
    });
    if (status === 503)
      await expect(result).rejects.toMatchObject({
        diagnosis: { code: "unavailable" },
      });
    else
      await expect(result).resolves.toMatchObject(
        status === 403
          ? { status: "unknown", reason: "generation_changed" }
          : { status: "unknown" },
      );
    expect(calls).toEqual([
      "GET /v1/capabilities/account-limits-refresh",
      "POST /v1/account-limits/refresh",
    ]);
  },
);

it("retries a failed capability read instead of permanently caching an outage", async () => {
  const options = { denied: true };
  const f = await fixture(options);
  expect(await f.reader.read(target)).toEqual({
    status: "unknown",
    reason: "generation_changed",
  });
  options.denied = false;
  expect(await f.reader.read(target)).toMatchObject({
    status: "snapshot",
  });
  expect(
    f.calls.filter(
      (call) => call === "GET /v1/provider-connection-capabilities",
    ),
  ).toHaveLength(2);
});

it("retries quota refresh capability discovery after one transport failure", async () => {
  const calls: string[] = [];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    if (calls.length === 1) {
      response.statusCode = 503;
      response.end(
        JSON.stringify({
          code: "unavailable",
          traceRef: "transient-discovery",
          effect: "not_dispatched",
          retry: { kind: "never" },
        }),
      );
      return;
    }
    response.end(
      JSON.stringify({
        contract: "account-limits-refresh/v1",
        quotaOnlyRefresh: true,
        profileIds: ["openai-codex-oauth-responses-v1"],
      }),
    );
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture");
  const refresher = accountLimitsRefresher({
    role: "management",
    origin: `http://127.0.0.1:${address.port}`,
    token: "test-credential",
  });
  const id = "openai-codex-oauth-responses-v1";
  await expect(refresher.supports(id)).rejects.toThrow();
  expect(await refresher.supports(id)).toBe(true);
  expect(await refresher.supports(id)).toBe(true);
  expect(calls).toEqual([
    "GET /v1/capabilities/account-limits-refresh",
    "GET /v1/capabilities/account-limits-refresh",
  ]);
});

it("shares refresh capability discovery across requests and rechecks it in the background", async () => {
  const calls: string[] = [];
  let profileIds = ["openai-codex-oauth-responses-v1"];
  const server = createServer((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        contract: "account-limits-refresh/v1",
        quotaOnlyRefresh: true,
        profileIds,
      }),
    );
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture");
  // Each page request composes a new refresher for the same Gateway.
  const refresherForRequest = () =>
    accountLimitsRefresher({
      role: "management",
      origin: `http://127.0.0.1:${address.port}`,
      token: "test-credential",
    });
  const id = "openai-codex-oauth-responses-v1";
  expect(await refresherForRequest().supports(id)).toBe(true);
  expect(await refresherForRequest().supports(id)).toBe(true);
  expect(calls).toHaveLength(1);
  // After the reuse period the known answer serves at once while the Gateway
  // is asked again; its new answer applies to later reads.
  profileIds = [];
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + REFRESH_DISCOVERY_TTL_MS);
  try {
    expect(await refresherForRequest().supports(id)).toBe(true);
    await vi.waitFor(async () =>
      expect(await refresherForRequest().supports(id)).toBe(false),
    );
    expect(calls).toHaveLength(2);
  } finally {
    vi.restoreAllMocks();
  }
});
