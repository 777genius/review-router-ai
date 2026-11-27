import { z } from "zod";
import * as c from "@agent-teams/account-gateway/contracts";
import { createConsumerControlClient } from "@agent-teams/account-gateway/http";
import {
  readReviewRunGatewayRelayPolicy,
  relayResourceLimits,
  type ReviewRunGatewayRelayPolicy,
} from "./review-run-gateway-relay";

const nativePolicy = z.strictObject({
  contract: z.literal("native-profiles/v1"),
  profiles: z
    .array(
      z.strictObject({
        profileId: c.reference,
        outputTokens: c.limits.shape.tokens,
      }),
    )
    .min(1)
    .max(128)
    .refine(
      (rows) => new Set(rows.map((row) => row.profileId)).size === rows.length,
    ),
  ...relayResourceLimits,
});

function decode(raw: string): unknown {
  if (Buffer.byteLength(raw) > 65536)
    throw new Error("review_run_gateway_relay_policy_invalid");
  return JSON.parse(raw);
}
function isNative(value: unknown): boolean {
  return (
    !!value &&
    typeof value === "object" &&
    "contract" in value &&
    value.contract === "native-profiles/v1"
  );
}

function nativeCatalogLoader(
  env: Readonly<Record<string, string | undefined>>,
) {
  if (env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED !== "1") return undefined;
  const raw = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY;
  if (!raw || !isNative(decode(raw))) return undefined;
  nativePolicy.parse(decode(raw));
  const origin = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_ORIGIN;
  const token = env.REVIEW_ROUTER_ACCOUNT_GATEWAY_PERSONAL_CONTROL_TOKEN;
  if (!origin || !token)
    throw new Error("review_run_native_catalog_consumer_control_missing");
  const executionOrigin =
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ??
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN;
  if (
    !executionOrigin ||
    new URL(executionOrigin).origin !== new URL(origin).origin
  )
    throw new Error("review_run_native_catalog_origin_mismatch");
  const client = createConsumerControlClient({
    role: "consumer-control",
    origin,
    token,
    timeoutMs: 10000,
    responseBytes: 1024 * 1024,
  });
  return {
    raw,
    load: (signal?: AbortSignal) =>
      client.getProviderConnectionCapabilitiesV3(
        signal ? { signal } : undefined,
      ),
  };
}

/** Explicit version selection. A discovery failure never falls back to old semantics. */
export async function loadNativeGatewayCatalog(
  env: Readonly<Record<string, string | undefined>>,
): Promise<c.ProviderConnectionCapabilitiesV3 | undefined> {
  const loader = nativeCatalogLoader(env);
  if (!loader) return undefined;
  try {
    return c.providerConnectionCapabilitiesV3.parse(await loader.load());
  } catch {
    // Recovery services still start. No current native declaration means no new model admission.
    return undefined;
  }
}

export type NativeGatewayRelayPolicyObservation = Readonly<{
  policy: ReviewRunGatewayRelayPolicy;
  expiresAt: number;
}>;
export type NativeGatewayRelayPolicySource = Readonly<{
  read(): Promise<NativeGatewayRelayPolicyObservation | undefined>;
  isFresh(observation: NativeGatewayRelayPolicyObservation): boolean;
}>;

/** One process owner, refreshed on demand. No discovery runs inside admission
 * transactions, and an expired observation never admits a new operation. */
export function createNativeGatewayRelayPolicySource(
  env: Readonly<Record<string, string | undefined>>,
  options: {
    initialCatalog?: c.ProviderConnectionCapabilitiesV3;
    now?: () => number;
    load?: (signal: AbortSignal) => Promise<c.ProviderConnectionCapabilitiesV3>;
  } = {},
): NativeGatewayRelayPolicySource | undefined {
  const loader = nativeCatalogLoader(env);
  if (!loader) return undefined;
  const now = options.now ?? Date.now;
  const load = options.load ?? loader.load;
  function observe(catalog: c.ProviderConnectionCapabilitiesV3) {
    const policy = qualifiedGatewayRelayPolicy(loader!.raw, catalog);
    for (const entry of policy.profiles) {
      Object.freeze(entry.profile.modelIds);
      Object.freeze(entry.profile.authKinds);
      Object.freeze(entry.profile.modelPolicy);
      Object.freeze(entry.profile.nativeContext);
      Object.freeze(entry.profile);
      Object.freeze(entry);
    }
    Object.freeze(policy.profiles);
    return Object.freeze({
      policy: Object.freeze(policy),
      expiresAt: now() + 30_000,
    });
  }
  let current = options.initialCatalog
    ? observe(options.initialCatalog)
    : undefined;
  let retryAt = 0;
  // Retain ownership until the actual transport settles, even if it ignores
  // cancellation. Callers time out; another attempt cannot overlap that owner.
  let inFlight:
    | Promise<NativeGatewayRelayPolicyObservation | undefined>
    | undefined;
  const isFresh = (observation: NativeGatewayRelayPolicyObservation) =>
    now() < observation.expiresAt;
  return {
    isFresh,
    read() {
      if (current && isFresh(current)) return Promise.resolve(current);
      if (inFlight) return inFlight;
      if (now() < retryAt) return Promise.resolve(undefined);
      current = undefined;
      const controller = new AbortController();
      let timedOut!: () => void;
      const timeout = new Promise<undefined>((resolve) => {
        timedOut = () => {
          retryAt = now() + 1000;
          controller.abort();
          resolve(undefined);
        };
      });
      const timer = setTimeout(timedOut, 10_000);
      timer.unref?.();
      const owned = Promise.resolve()
        .then(() => load(controller.signal))
        .then((catalog) => {
          if (controller.signal.aborted) return undefined;
          current = observe(catalog);
          return current;
        })
        .catch(() => {
          retryAt = now() + 1000;
          return undefined;
        })
        .finally(() => {
          clearTimeout(timer);
          inFlight = undefined;
        });
      inFlight = Promise.race([owned, timeout]);
      return inFlight;
    },
  };
}

/** Pure qualification. Local allowances never come from discovery. */
export function qualifiedGatewayRelayPolicy(
  raw: string,
  catalog?: c.ProviderConnectionCapabilitiesV3,
): ReviewRunGatewayRelayPolicy {
  const decoded = decode(raw);
  if (!isNative(decoded)) return readReviewRunGatewayRelayPolicy(raw);
  const {
    contract: _contract,
    profiles,
    ...limits
  } = nativePolicy.parse(decoded);
  void _contract;
  const native = catalog
    ? c.providerConnectionCapabilitiesV3.parse(catalog)
    : undefined;
  return {
    ...limits,
    profiles: profiles.map((entry) => {
      const profile = native?.capabilities.find(
        (row) => row.profileId === entry.profileId,
      );
      if (!profile || profile.availability !== "enabled")
        return {
          outputTokens: entry.outputTokens,
          profile: {
            profileId: entry.profileId,
            protocol: "openai-responses",
            modelIds: [],
            authKinds: [],
          },
        };
      return {
        outputTokens: entry.outputTokens,
        profile: {
          profileId: profile.profileId,
          protocol: profile.protocol,
          modelIds: profile.models.map((model) => model.modelId),
          authKinds: [],
          modelPolicy: { ...profile.modelPolicy },
          nativeContext: {
            schemaVersion: 1,
            profileId: profile.profileId,
            providerId: profile.provider.id,
            productId: profile.product.id,
          },
        },
      };
    }),
  };
}
