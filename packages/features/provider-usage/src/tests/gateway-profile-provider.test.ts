import { describe, expect, it } from "vitest";
import {
  gatewayProfileUsageProvider,
  gatewaySubscriptionUsageProviders,
} from "../infrastructure/gateway-profile-provider";

describe("Gateway profile usage providers", () => {
  it("labels only vendors whose every Gateway profile is a flat plan as subscription", () => {
    // NVIDIA (trial), OpenRouter (credits) and MiMo (plan unknown) stay unpriced.
    expect(gatewaySubscriptionUsageProviders).toEqual([
      "claude",
      "codex",
      "glm",
      "grok",
      "kimi",
      "minimax",
    ]);
    expect(gatewayProfileUsageProvider("openai-codex-oauth-responses-v1")).toBe(
      "codex",
    );
    expect(gatewayProfileUsageProvider("unqualified-profile")).toBeUndefined();
  });
});
