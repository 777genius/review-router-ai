import { createHash } from "node:crypto";

export type MemorySearchConfigEnv = Readonly<
  Record<string, string | undefined>
>;

export type InfinityMemorySearchConfig = {
  readonly kind: "infinity";
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly spaceId: string;
  readonly memoryScopeId: string;
  readonly projectionGeneration: string;
  readonly profileId: string;
  readonly capabilityFingerprint: string;
  readonly requiredProviderLanes: readonly string[];
  /** Binds nonsecret deployment identity; rotating credentials preserves it. */
  readonly indexIdentity: string;
};

export type MemorySearchConfig =
  | { readonly kind: "prisma" }
  | InfinityMemorySearchConfig;

const infinityPrefix = "REVIEW_ROUTER_MEMORY_INFINITY_";

const infinityConfigurationErrorCodes = {
  BASE_URL: "memory_infinity_base_url_invalid",
  API_KEY: "memory_infinity_api_key_invalid",
  SPACE_ID: "memory_infinity_space_id_invalid",
  MEMORY_SCOPE_ID: "memory_infinity_memory_scope_id_invalid",
  PROJECTION_GENERATION: "memory_infinity_projection_generation_invalid",
  PROFILE_ID: "memory_infinity_profile_id_invalid",
  CAPABILITY_FINGERPRINT: "memory_infinity_capability_fingerprint_invalid",
  REQUIRED_PROVIDER_LANES: "memory_infinity_required_provider_lanes_invalid",
} as const;

type MemorySearchConfigurationErrorCode =
  | "memory_search_engine_invalid"
  | (typeof infinityConfigurationErrorCodes)[keyof typeof infinityConfigurationErrorCodes];

const safeConfigurationErrorCodes = new Set<string>([
  "memory_search_engine_invalid",
  ...Object.values(infinityConfigurationErrorCodes),
]);

/** Configuration diagnostics contain fixed codes, never configured values. */
export class MemorySearchConfigurationError extends Error {
  constructor(readonly code: MemorySearchConfigurationErrorCode) {
    super(code);
    this.name = "MemorySearchConfigurationError";
  }
}

/** Hosts classify feature-owned errors without knowing individual engine fields. */
export function safeMemorySearchConfigurationErrorCode(
  error: unknown,
): MemorySearchConfigurationErrorCode | null {
  if (!(error instanceof MemorySearchConfigurationError)) return null;
  const code = error.code;
  return safeConfigurationErrorCodes.has(code) ? code : null;
}

/** Parse configuration without constructing a client or performing external I/O. */
export function parseMemorySearchConfig(
  env: MemorySearchConfigEnv,
): MemorySearchConfig {
  const kind = env.REVIEW_ROUTER_MEMORY_SEARCH_ENGINE?.trim() || "prisma";
  if (kind === "prisma") return Object.freeze({ kind });
  if (kind !== "infinity") {
    throw new MemorySearchConfigurationError("memory_search_engine_invalid");
  }

  const baseUrl = normalizeBaseUrl(required(env, "BASE_URL", 2_048));
  const apiKey = required(env, "API_KEY", 8_192);
  if (/\s/u.test(apiKey)) {
    throw new MemorySearchConfigurationError(
      infinityConfigurationErrorCodes.API_KEY,
    );
  }
  // Exact-document reconciliation applies UTF-8 byte limits to these IDs.
  const spaceId = required(env, "SPACE_ID", 80, "utf8");
  const memoryScopeId = required(env, "MEMORY_SCOPE_ID", 80, "utf8");
  const projectionGeneration = required(
    env,
    "PROJECTION_GENERATION",
    256,
    "utf8",
  );
  const profileId = required(env, "PROFILE_ID", 256);
  const capabilityFingerprint = required(env, "CAPABILITY_FINGERPRINT", 64);
  if (!/^[0-9a-f]{64}$/u.test(capabilityFingerprint)) {
    throw new MemorySearchConfigurationError(
      infinityConfigurationErrorCodes.CAPABILITY_FINGERPRINT,
    );
  }
  const laneValues = required(env, "REQUIRED_PROVIDER_LANES", 4_096)
    .split(",")
    .map((lane) => lane.trim());
  if (
    laneValues.length < 1 ||
    laneValues.length > 4 ||
    new Set(laneValues).size !== laneValues.length ||
    laneValues.some((lane) => !isBoundedText(lane, 256))
  ) {
    throw new MemorySearchConfigurationError(
      infinityConfigurationErrorCodes.REQUIRED_PROVIDER_LANES,
    );
  }
  const requiredProviderLanes = Object.freeze(
    laneValues.sort((left, right) =>
      Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")),
    ),
  );
  const identity = JSON.stringify([
    "reviewrouter/memory-infinity/v1",
    baseUrl,
    spaceId,
    memoryScopeId,
    projectionGeneration,
    profileId,
    capabilityFingerprint,
    requiredProviderLanes,
  ]);

  return Object.freeze({
    kind,
    baseUrl,
    apiKey,
    spaceId,
    memoryScopeId,
    projectionGeneration,
    profileId,
    capabilityFingerprint,
    requiredProviderLanes,
    indexIdentity: `infinity:${createHash("sha256").update(identity).digest("hex")}`,
  });
}

function required(
  env: MemorySearchConfigEnv,
  name: keyof typeof infinityConfigurationErrorCodes,
  maximum: number,
  lengthUnit: "codepoints" | "utf8" = "codepoints",
): string {
  const value = env[`${infinityPrefix}${name}`]?.trim() ?? "";
  if (
    !isBoundedText(value, maximum) ||
    (lengthUnit === "utf8" && Buffer.byteLength(value, "utf8") > maximum)
  ) {
    throw new MemorySearchConfigurationError(
      infinityConfigurationErrorCodes[name],
    );
  }
  return value;
}

function isBoundedText(value: string, maximum: number): boolean {
  const points = [...value];
  return (
    points.length > 0 &&
    points.length <= maximum &&
    points.every((point) => {
      const codePoint = point.codePointAt(0)!;
      return (
        codePoint > 0x1f &&
        (codePoint < 0x7f || codePoint > 0x9f) &&
        (codePoint < 0xd800 || codePoint > 0xdfff)
      );
    })
  );
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MemorySearchConfigurationError(
      infinityConfigurationErrorCodes.BASE_URL,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new MemorySearchConfigurationError(
      infinityConfigurationErrorCodes.BASE_URL,
    );
  }
  return url.toString().replace(/\/+$/u, "");
}
