// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountConnectionView } from "../../../src/features/account-gateway/connection-capabilities";
import {
  defaultProviderSelectionSettings,
  fitProviderSelectionSettings,
  ProviderModelFields,
} from "./provider-model-fields";

beforeEach(() =>
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  ),
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("direct API key review settings", () => {
  it("defaults MiMo to qualified high depth and omits Kimi tuning", () => {
    expect(
      defaultProviderSelectionSettings({
        authMode: "mimo_token_plan_api_key",
        model: "mimo-v2.6-pro",
      }),
    ).toEqual({
      reasoningEffort: "high",
      agenticContext: true,
      fastMode: false,
    });
    expect(
      fitProviderSelectionSettings({
        authMode: "kimi_code_api_key",
        model: "k3-256k",
        settings: {
          reasoningEffort: "xhigh",
          agenticContext: true,
          fastMode: true,
        },
      }),
    ).toEqual({ agenticContext: true, fastMode: false });
  });

  it.each(["low", "medium", "high"] as const)(
    "preserves qualified MiMo depth %s",
    (reasoningEffort) => {
      expect(
        fitProviderSelectionSettings({
          authMode: "mimo_token_plan_api_key",
          model: "mimo-v2.6-pro",
          settings: { reasoningEffort, agenticContext: false, fastMode: true },
        }),
      ).toEqual({ reasoningEffort, agenticContext: false, fastMode: false });
    },
  );

  it("offers only qualified MiMo depths and no fast mode", () => {
    render(
      <ProviderModelFields
        authMode="mimo_token_plan_api_key"
        model="mimo-v2.6-pro"
        onModelChange={null}
        modelOptions={[]}
        modelChoice="list"
        settings={{
          reasoningEffort: "high",
          agenticContext: true,
          fastMode: false,
        }}
        onSettingsChange={() => {}}
        agentProfileOptions={[]}
        disabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: /^Review depth/ }));
    expect(screen.getAllByRole("option")).toHaveLength(3);
    for (const name of [/^Low/, /^Medium/, /^High/])
      expect(screen.getByRole("option", { name })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: "Fast mode" })).toBeNull();
  });
});

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
