// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { AccountConnectionView } from "../../../src/features/account-gateway/connection-capabilities";
import {
  fitProviderSelectionSettings,
  ProviderModelFields,
} from "./provider-model-fields";

afterEach(cleanup);
it("renders and preserves legacy Ultra without silently choosing a new saved effort", () => {
  const settings = {
    reasoningEffort: "ultra" as const,
    agenticContext: true,
    fastMode: false,
  };
  const connection: AccountConnectionView = {
    provider: "openai",
    planLabel: "Codex",
    regionLabel: "Global",
    completionInputKind: "none",
    personalOnly: false,
    limitsContract: "none",
    modelSettings: [
      {
        modelId: "dynamic-model",
        reasoning: { allowed: ["high", "max"], default: "high" },
        fast: { allowed: ["balanced"], default: "balanced" },
        tools: { allowed: ["function"], default: "function" },
      },
    ],
  };
  const onSettingsChange = vi.fn();
  const props = {
    authMode: "codex_account_gateway" as const,
    model: "dynamic-model",
    onModelChange: null,
    modelOptions: [],
    modelChoice: "list" as const,
    settings,
    onSettingsChange,
    connection,
    gatewayProfileRef: "openai-codex-oauth-responses-v1",
    agentProfileOptions: [],
    disabled: false,
  };
  const view = render(<ProviderModelFields {...props} />);
  expect(
    screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
  ).toContain("Ultra");
  view.rerender(<ProviderModelFields {...props} />);
  expect(onSettingsChange).not.toHaveBeenCalled();
  expect(fitProviderSelectionSettings(props).reasoningEffort).toBe("ultra");
  expect(
    fitProviderSelectionSettings({
      ...props,
      settings: { agenticContext: true, fastMode: false },
    }).reasoningEffort,
  ).toBeUndefined();
});
