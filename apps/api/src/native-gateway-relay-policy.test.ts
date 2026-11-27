import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as c from "@agent-teams/account-gateway/contracts";
import { afterEach, expect, it, vi } from "vitest";
import {
  createNativeGatewayRelayPolicySource,
  qualifiedGatewayRelayPolicy,
} from "./native-gateway-relay-policy";
import { gatewayProfileMatchesCapturedNativeContext } from "./review-run-gateway-model-qualification";

const raw = JSON.stringify({
  contract: "native-profiles/v1",
  profiles: [{ profileId: "native-profile", outputTokens: 4096 }],
  ingressBytes: 8192,
  requestTimeoutMs: 10_000,
  waitBudgetMs: 0,
  maxWaits: 0,
  maxSessions: 4,
  maxInFlight: 2,
});
const env = {
  REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED: "1",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: raw,
  REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN:
    "https://gateway.example",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_TOKEN: "consumer-test-bearer",
  REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: "https://gateway.example",
};

function catalogue() {
  return c.providerConnectionCapabilitiesV3.parse({
    contract: "provider-connections/v3",
    capabilities: [
      {
        profileId: "native-profile",
        provider: { id: "native-provider", label: "Provider" },
        product: { id: "native-product", label: "Product" },
        region: { id: "global", label: "Global" },
        protocol: "openai-responses",
        models: [
          {
            modelId: "model-1",
            reasoning: null,
            fast: null,
            tools: { allowed: ["function"], default: "function" },
          },
        ],
        modelPolicy: {
          sourceId: "native-models",
          contract: "native-account-models/v2",
          unavailableFallback: "deny",
        },
        methods: [
          {
            methodId: "key",
            revision: 1,
            configurationGeneration: "generation-1",
            label: "API key",
            create: true,
            reconnect: true,
            allowedCredentialPolicies: ["delegated_identity"],
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
                  maxBytes: 16384,
                },
              ],
            },
          },
        ],
        accountInfo: true,
        limitsContract: "account-limits/v3",
        availability: "enabled",
      },
    ],
  });
}

afterEach(() => vi.useRealTimers());

it("starts without HTTP and recovers a failed discovery on demand with one attempt per burst", async () => {
  let now = 0;
  const catalog = catalogue();
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(catalog);
  const source = createNativeGatewayRelayPolicySource(env, {
    load,
    now: () => now,
  })!;
  expect(load).not.toHaveBeenCalled();
  expect(
    await Promise.all(Array.from({ length: 100 }, () => source.read())),
  ).toEqual(Array(100).fill(undefined));
  expect(load).toHaveBeenCalledTimes(1);
  now = 999;
  expect(await source.read()).toBeUndefined();
  expect(load).toHaveBeenCalledTimes(1);
  now = 1000;
  const recovered = await source.read();
  expect(recovered?.policy.profiles[0]?.profile.nativeContext).toEqual({
    schemaVersion: 1,
    profileId: "native-profile",
    providerId: "native-provider",
    productId: "native-product",
  });
  expect(recovered?.expiresAt).toBe(31_000);
  expect(await source.read()).toBe(recovered);
  expect(load).toHaveBeenCalledTimes(2);
  catalog.capabilities[0]!.provider.id = "mutated-after-read";
  expect(recovered?.policy.profiles[0]?.profile.nativeContext?.providerId).toBe(
    "native-provider",
  );
  expect(
    Object.isFrozen(recovered?.policy.profiles[0]?.profile.nativeContext),
  ).toBe(true);
});

it("does not serve an expired observation after refresh failure or revive it on an identical refresh", async () => {
  let now = 0;
  const load = vi
    .fn()
    .mockResolvedValueOnce(catalogue())
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(catalogue());
  const source = createNativeGatewayRelayPolicySource(env, {
    load,
    now: () => now,
  })!;
  const old = (await source.read())!;
  now = 30_000;
  expect(source.isFresh(old)).toBe(false);
  expect(await source.read()).toBeUndefined();
  now = 31_000;
  const refreshed = (await source.read())!;
  expect(refreshed.policy).toEqual(old.policy);
  expect(refreshed).not.toBe(old);
  expect(source.isFresh(refreshed)).toBe(true);
  expect(source.isFresh(old)).toBe(false);
  expect(old.expiresAt).toBe(30_000);
});

it("retains one ignored-abort transport while callers time out and discards its late result", async () => {
  vi.useFakeTimers();
  let resolve!: (catalog: c.ProviderConnectionCapabilitiesV3) => void;
  const load = vi
    .fn<(signal: AbortSignal) => Promise<c.ProviderConnectionCapabilitiesV3>>()
    .mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(catalogue());
  const source = createNativeGatewayRelayPolicySource(env, { load })!;
  const pending = source.read();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await pending).toBeUndefined();
  expect(load.mock.calls[0]![0].aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(
    await Promise.all(Array.from({ length: 100 }, () => source.read())),
  ).toEqual(Array(100).fill(undefined));
  expect(load).toHaveBeenCalledTimes(1);
  resolve(catalogue());
  await vi.advanceTimersByTimeAsync(0);
  expect(
    (await source.read())?.policy.profiles[0]?.profile.nativeContext,
  ).toBeDefined();
  expect(load).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["disabled", "removed", "provider", "product"])(
  "refuses fresh inference for a %s native identity without expanding local allowances",
  async (change) => {
    let now = 0;
    const original = catalogue();
    const changed = catalogue();
    if (change === "disabled")
      changed.capabilities[0]!.availability =
        "deployment_configuration_required";
    if (change === "removed") changed.capabilities = [];
    if (change === "provider")
      changed.capabilities[0]!.provider.id = "replacement-provider";
    if (change === "product")
      changed.capabilities[0]!.product.id = "replacement-product";
    const unconfigured = {
      ...original.capabilities[0]!,
      profileId: "unconfigured-profile",
    };
    changed.capabilities.push(unconfigured);
    const load = vi
      .fn()
      .mockResolvedValueOnce(original)
      .mockResolvedValue(changed);
    const source = createNativeGatewayRelayPolicySource(env, {
      load,
      now: () => now,
    })!;
    const captured = (await source.read())!.policy.profiles[0]!.profile
      .nativeContext;
    now = 30_000;
    const current = (await source.read())!;
    expect(current.policy.profiles).toHaveLength(1);
    expect(current.policy.profiles[0]!.outputTokens).toBe(4096);
    expect(current.policy.maxInFlight).toBe(2);
    expect(
      gatewayProfileMatchesCapturedNativeContext(
        current.policy.profiles[0]!.profile,
        captured,
      ),
    ).toBe(false);
  },
);

it("preserves static policy and rejects invalid native origin configuration before any request", () => {
  const staticRaw = JSON.stringify({
    ...JSON.parse(raw),
    contract: undefined,
    profiles: [
      {
        profile: {
          profileId: "legacy-profile",
          protocol: "openai-responses",
          modelIds: ["model-1"],
          authKinds: ["api_key"],
        },
        outputTokens: 4096,
      },
    ],
  });
  expect(
    createNativeGatewayRelayPolicySource({
      ...env,
      REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY: staticRaw,
    }),
  ).toBeUndefined();
  expect(
    qualifiedGatewayRelayPolicy(staticRaw).profiles[0]?.profile.modelIds,
  ).toEqual(["model-1"]);
  expect(() =>
    createNativeGatewayRelayPolicySource({
      ...env,
      REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: "https://different.example",
    }),
  ).toThrow("review_run_native_catalog_origin_mismatch");
});

it("recovers through the actual SDK HTTP boundary without rebuilding the process source", async () => {
  let healthy = false;
  let reads = 0;
  let now = 0;
  const server = createServer((request, response) => {
    expect(request.url).toBe("/v3/provider-connection-capabilities");
    expect(request.headers.authorization).toBe("Bearer consumer-test-bearer");
    reads++;
    response.writeHead(healthy ? 200 : 503, {
      "content-type": "application/json",
    });
    response.end(
      JSON.stringify(
        healthy
          ? catalogue()
          : {
              code: "unavailable",
              effect: "not_dispatched",
              traceRef: "catalog-test",
              retry: { kind: "never" },
            },
      ),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const source = createNativeGatewayRelayPolicySource(
      {
        ...env,
        REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN: origin,
        REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN: origin,
      },
      { now: () => now },
    )!;
    expect(await source.read()).toBeUndefined();
    healthy = true;
    now = 1000;
    const recovered = await Promise.all(
      Array.from({ length: 50 }, () => source.read()),
    );
    expect(recovered.every((entry) => entry === recovered[0])).toBe(true);
    expect(
      recovered[0]?.policy.profiles[0]?.profile.nativeContext?.providerId,
    ).toBe("native-provider");
    expect(reads).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
