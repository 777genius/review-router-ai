import { accountModelDiscoveryProfile } from "@agent-teams/account-gateway/contracts";

/** Normalize configured provider identity independently from its runtime engine. */
export function providerUsageConfiguredProvider(lane: {
  kind: string;
  model: string;
  authMode?: string | undefined;
  gatewayProfileRef?: string | undefined;
}) {
  // native_catalog names who owns the model list, not the vendor: usage keeps
  // reporting such plans as "unknown" exactly as before the catalogue existed.
  const discoverySource = accountModelDiscoveryProfile(
    lane.gatewayProfileRef ?? "",
  )?.source;
  const provider =
    lane.authMode === "codex_account_gateway"
      ? discoverySource && discoverySource !== "native_catalog"
        ? discoverySource
        : "unknown"
      : lane.kind === "codex-mimo"
        ? "mimo"
        : lane.kind;
  return {
    provider,
    requestedModel:
      provider === "openrouter" && lane.model === "free"
        ? "openrouter/free"
        : lane.model,
  };
}
