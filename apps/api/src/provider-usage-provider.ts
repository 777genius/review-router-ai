import { gatewayProfileUsageProvider } from "@reviewrouter/features-provider-usage";

/** Normalize configured provider identity independently from its runtime engine. */
export function providerUsageConfiguredProvider(lane: {
  kind: string;
  model: string;
  authMode?: string | undefined;
  gatewayProfileRef?: string | undefined;
}) {
  // A Gateway lane's kind is its engine; the SDK names the profile's vendor.
  const provider =
    lane.authMode === "codex_account_gateway"
      ? (gatewayProfileUsageProvider(lane.gatewayProfileRef ?? "") ?? "unknown")
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
