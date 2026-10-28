import { describe, expect, it } from "vitest";
import {
  codexModelSupportsReasoningEffort,
  codexModelSupportsFastMode,
  listStaticReviewModelOptions,
} from "../index";

describe("Codex model capabilities", () => {
  it("exposes the exact MiMo public-engine provider model", () => {
    expect(listStaticReviewModelOptions()).toContainEqual({
      value: "mimo-v2.6-pro",
      label: "mimo-v2.6-pro",
      provider: "codex-mimo",
      description: "MiMo Token Plan public engine model.",
    });
  });

  it("does not grant fast mode to newly discovered models", () => {
    expect(codexModelSupportsFastMode("gpt-5.6-sol")).toBe(true);
    expect(codexModelSupportsFastMode("gpt-5.4")).toBe(true);
    expect(codexModelSupportsFastMode("future-public-model")).toBe(false);
  });

  it.each(["max", "ultra"] as const)(
    "supports %s only on gpt-5.6-sol",
    (effort) => {
      expect(codexModelSupportsReasoningEffort("gpt-5.6-sol", effort)).toBe(
        true,
      );
      expect(codexModelSupportsReasoningEffort(" gpt-5.6-sol ", effort)).toBe(
        true,
      );
      expect(codexModelSupportsReasoningEffort("gpt-5.5", effort)).toBe(false);
    },
  );

  it.each(["low", "medium", "high", "xhigh"] as const)(
    "keeps %s available to other Codex models",
    (effort) => {
      expect(codexModelSupportsReasoningEffort("gpt-5.5", effort)).toBe(true);
    },
  );
});
