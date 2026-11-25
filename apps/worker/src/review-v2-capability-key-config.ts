// Strict capability-key configuration, kept out of worker runtime composition.
import {
  ConfiguredCapabilityKeyRing,
  type ConfiguredCapabilityVerificationKey,
} from "@reviewrouter/platform-signed-capabilities";

export const reviewV2CapabilityActiveKeyIdEnv =
  "REVIEW_ROUTER_REVIEW_V2_CAPABILITY_ACTIVE_KEY_ID";
export const reviewV2CapabilityKeysEnv =
  "REVIEW_ROUTER_REVIEW_V2_CAPABILITY_KEYS_JSON";

export function positiveInteger(
  raw: string | undefined,
  fallback: number,
  code: string,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function requiredEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`review_v2_worker_config_missing:${name}`);
  return value;
}

export function readCapabilityKeyRing(
  env: Readonly<Record<string, string | undefined>>,
): ConfiguredCapabilityKeyRing {
  const activeKeyId = requiredEnv(env, reviewV2CapabilityActiveKeyIdEnv);
  let parsed: unknown;
  try {
    parsed = JSON.parse(requiredEnv(env, reviewV2CapabilityKeysEnv));
  } catch {
    throw new Error("review_v2_capability_keys_invalid");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 10) {
    throw new Error("review_v2_capability_keys_invalid");
  }
  return new ConfiguredCapabilityKeyRing({
    activeKeyId,
    keys: parsed.map(parseCapabilityKey),
  });
}

function parseCapabilityKey(
  value: unknown,
): ConfiguredCapabilityVerificationKey {
  if (!isExactRecord(value, ["keyId", "secretBase64", "verifyUntil"])) {
    throw new Error("review_v2_capability_key_invalid");
  }
  if (
    typeof value.keyId !== "string" ||
    typeof value.secretBase64 !== "string" ||
    (value.verifyUntil !== null && typeof value.verifyUntil !== "string")
  ) {
    throw new Error("review_v2_capability_key_invalid");
  }
  const secret = Buffer.from(value.secretBase64, "base64");
  if (
    secret.byteLength < 32 ||
    secret.toString("base64") !== value.secretBase64
  ) {
    throw new Error("review_v2_capability_key_invalid");
  }
  const verifyUntil =
    value.verifyUntil === null ? null : new Date(value.verifyUntil);
  if (
    verifyUntil !== null &&
    (!Number.isFinite(verifyUntil.getTime()) ||
      verifyUntil.toISOString() !== value.verifyUntil)
  ) {
    throw new Error("review_v2_capability_key_invalid");
  }
  return {
    keyId: value.keyId,
    secret: new Uint8Array(secret),
    verifyUntil,
  };
}

function isExactRecord(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}
