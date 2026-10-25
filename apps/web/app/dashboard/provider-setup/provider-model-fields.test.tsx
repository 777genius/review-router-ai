// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
