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

/** Explicit version selection. A discovery failure never falls back to old semantics. */
export async function loadNativeGatewayCatalog(
  env: Readonly<Record<string, string | undefined>>,
): Promise<c.ProviderConnectionCapabilitiesV3 | undefined> {
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
  try {
    return c.providerConnectionCapabilitiesV3.parse(
      await client.getProviderConnectionCapabilitiesV3(),
    );
  } catch {
    // Recovery services still start. No current native declaration means no new model admission.
    return undefined;
  }
}

/** Runs before composition/transactions. Local allowances never come from discovery. */
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
