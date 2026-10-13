// Match the qualified Action's admitted MiMo model, without changing Codex or
// OpenRouter model policies. Callers apply this only to Gateway selections.
export const defaultGatewayMiMoReasoningEffort = "high" as const;

export function isGatewayMiMoModel(model: string): boolean {
  return model.trim() === "mimo-v2.6-pro";
}

export function gatewayModelSupportsReasoningEffort(
  model: string,
  effort: string,
): boolean {
  return (
    !isGatewayMiMoModel(model) ||
    effort === "low" ||
    effort === "medium" ||
    effort === "high"
  );
}
