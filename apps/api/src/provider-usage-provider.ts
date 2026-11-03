import { accountModelDiscoveryProfile } from "@agent-teams/account-gateway/contracts";

/** Normalize configured provider identity independently from its runtime engine. */
export function providerUsageConfiguredProvider(lane: {
  kind: string;
  model: string;
  authMode?: string | undefined;
  gatewayProfileRef?: string | undefined;
}) {
  const provider =
    lane.authMode === "codex_account_gateway"
      ? (accountModelDiscoveryProfile(lane.gatewayProfileRef ?? "")?.source ??
        "unknown")
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
