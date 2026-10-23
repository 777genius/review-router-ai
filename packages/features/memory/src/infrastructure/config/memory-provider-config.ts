export const HINDSIGHT_MEMORY_PROFILE = "hindsight-v1.1.0-chunks-v1" as const;

export type MemoryProviderConfig =
  | { readonly kind: "disabled"; readonly generation: string }
  | {
      readonly kind: "hindsight";
      readonly generation: string;
      readonly profileVersion: typeof HINDSIGHT_MEMORY_PROFILE;
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly namespace: string;
    };

/** Parsing is local. An unavailable memory server cannot prevent a host starting. */
export function parseMemoryProviderConfig(
  env: Readonly<Record<string, string | undefined>>,
): MemoryProviderConfig {
  const kind = env.REVIEW_ROUTER_MEMORY_PROVIDER?.trim() || "disabled";
  const generation = env.REVIEW_ROUTER_MEMORY_GENERATION?.trim() || "memory-v1";
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(generation)) {
    throw new Error("memory_provider_generation_invalid");
  }
  if (kind === "disabled") return { kind, generation };
  if (kind !== "hindsight") throw new Error("memory_provider_invalid");
  const baseUrl = env.REVIEW_ROUTER_MEMORY_HINDSIGHT_URL?.trim();
  const apiKey = env.REVIEW_ROUTER_MEMORY_HINDSIGHT_API_KEY?.trim();
  const namespace = env.REVIEW_ROUTER_MEMORY_NAMESPACE?.trim();
  let parsed: URL;
  try {
    parsed = new URL(baseUrl || "");
  } catch {
    throw new Error("memory_provider_url_invalid");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username || parsed.password || parsed.search || parsed.hash
  ) throw new Error("memory_provider_url_invalid");
  if (!apiKey || apiKey.length > 8_192 || /\s/.test(apiKey)) {
    throw new Error("memory_provider_key_invalid");
  }
  if (!namespace || !/^[a-zA-Z0-9_-]{1,100}$/.test(namespace)) {
    throw new Error("memory_provider_namespace_invalid");
  }
  if (env.REVIEW_ROUTER_MEMORY_PROVIDER_PROFILE !== HINDSIGHT_MEMORY_PROFILE) {
    throw new Error("memory_provider_profile_unqualified");
  }
  return {
    kind,
    generation,
    profileVersion: HINDSIGHT_MEMORY_PROFILE,
    baseUrl: parsed.toString().replace(/\/+$/, ""),
    apiKey,
    namespace,
  };
}
