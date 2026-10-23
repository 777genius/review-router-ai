import { describe, expect, it } from "vitest";
import {
  gatewayModelSupportsReasoningEffort,
  gatewayModelSupportsFastMode,
} from "./review-reasoning-capabilities";
import type { AccountConnectionView } from "./connection-capabilities";
const connection: AccountConnectionView = {
  provider: "kimi",
  planLabel: "Kimi Code",
  regionLabel: "Global",
  completionInputKind: "none",
  personalOnly: false,
  limitsContract: "account-limits/v2",
  modelSettings: [
    {
      modelId: "k3-256k",
      reasoning: null,
      fast: null,
      tools: {
        allowed: ["function_and_custom"],
        default: "function_and_custom",
      },
    },
  ],
};
describe("qualified Gateway settings", () => {
  it("accepts omission and rejects every invented reasoning/fast setting", () => {
    expect(
      gatewayModelSupportsReasoningEffort("k3-256k", undefined, connection),
    ).toBe(true);
    for (const effort of ["low", "medium", "high", "xhigh", "max", "ultra"])
      expect(
        gatewayModelSupportsReasoningEffort("k3-256k", effort, connection),
      ).toBe(false);
    expect(gatewayModelSupportsFastMode("k3-256k", connection)).toBe(false);
    expect(
      gatewayModelSupportsReasoningEffort("unknown", undefined, connection),
    ).toBe(false);
  });
  it("preserves legacy MiMo and Codex controls without a capability projection", () => {
    expect(gatewayModelSupportsReasoningEffort("mimo-v2.6-pro", "high")).toBe(
      true,
    );
    expect(gatewayModelSupportsReasoningEffort("mimo-v2.6-pro", "xhigh")).toBe(
      false,
    );
    expect(gatewayModelSupportsReasoningEffort("gpt-5.5", "xhigh")).toBe(true);
  });
});
