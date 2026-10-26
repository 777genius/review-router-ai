import { effectiveGatewayReasoningEffort } from "@reviewrouter/features-review-providers";
import type { AccountConnectionView } from "./connection-capabilities";
// Match the qualified Action's admitted MiMo model, without changing Codex or
// OpenRouter model policies. Callers apply this only to Gateway selections.
export const defaultGatewayMiMoReasoningEffort = "high" as const;

export function isGatewayMiMoModel(model: string): boolean {
  return model.trim() === "mimo-v2.6-pro";
}

export function gatewayModelSupportsReasoningEffort(
  model: string,
  effort: string | undefined,
  connection?: AccountConnectionView,
  profileRef?: string,
): boolean {
  if (connection) {
    const qualified = connection.modelSettings.find(
      (row) => row.modelId === model,
    );
    if (!qualified) return false;
    return qualified.reasoning === null
      ? effort === undefined
      : (profileRef === "openai-codex-oauth-responses-v1" &&
          effort === undefined) ||
          (effort !== undefined &&
            qualified.reasoning.allowed.some(
              (allowed) =>
                effectiveGatewayReasoningEffort(profileRef, allowed) ===
                effectiveGatewayReasoningEffort(profileRef, effort),
            ));
  }
  return (
    effort !== undefined &&
    effort !== "minimal" &&
    (!isGatewayMiMoModel(model) ||
      effort === "low" ||
      effort === "medium" ||
      effort === "high")
  );
}

export function gatewayModelDefaultReasoningEffort(
  model: string,
  connection?: AccountConnectionView,
):
  | "minimal"
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra"
  | undefined {
  if (connection) {
    const value = connection.modelSettings.find((row) => row.modelId === model)
      ?.reasoning?.default;
    return value &&
      ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"].includes(
        value,
      )
      ? (value as
          | "minimal"
          | "low"
          | "medium"
          | "high"
          | "xhigh"
          | "max"
          | "ultra")
      : undefined;
  }
  return isGatewayMiMoModel(model) ? "high" : "xhigh";
}

export function gatewayModelSupportsFastMode(
  model: string,
  connection?: AccountConnectionView,
): boolean {
  return connection
    ? connection.modelSettings
        .find((row) => row.modelId === model)
        ?.fast?.allowed.includes("fast") === true
    : true;
}
