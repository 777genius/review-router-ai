/** Normalize configured provider identity independently from its runtime engine. */
export function providerUsageConfiguredProvider(lane: {
  kind: string;
  model: string;
}) {
  const provider = lane.kind === "codex-mimo" ? "mimo" : lane.kind;
  return {
    provider,
    requestedModel:
      provider === "openrouter" && lane.model === "free"
        ? "openrouter/free"
        : lane.model,
  };
}
