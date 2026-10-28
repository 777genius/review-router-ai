// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountConnectionView } from "../../../src/features/account-gateway/connection-capabilities";
import {
  defaultProviderSelectionSettings,
  fitProviderSelectionSettings,
  ProviderModelFields,
  ProviderModelPicker,
  providerSelectionSettingsNeedCorrection,
  type ProviderModelFieldsProps,
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

describe("independent review controls and unresolved account capabilities", () => {
  const props: ProviderModelFieldsProps = {
    authMode: "openrouter_api_key",
    model: "vendor/model",
    onModelChange: null,
    modelOptions: [],
    modelChoice: "catalog",
    settings: {
      reasoningEffort: "xhigh",
      agenticContext: true,
      fastMode: false,
    },
    onSettingsChange: () => {},
    agentProfileOptions: [],
    disabled: false,
  };

  it.each(["openrouter_api_key", "kimi_code_api_key"] as const)(
    "exposes file reading for %s without inventing reasoning, fast or engine controls",
    (authMode) => {
      const onSettingsChange = vi.fn();
      const settings =
        authMode === "kimi_code_api_key"
          ? { agenticContext: true, fastMode: false }
          : props.settings;
      render(
        <ProviderModelFields
          {...props}
          authMode={authMode}
          settings={settings}
          onSettingsChange={onSettingsChange}
        />,
      );
      expect(
        screen.queryByRole("combobox", { name: /^Review depth/ }),
      ).toBeNull();
      expect(
        screen.queryByRole("combobox", { name: /^Review engine/ }),
      ).toBeNull();
      expect(screen.queryByRole("checkbox", { name: /^Fast mode/ })).toBeNull();
      fireEvent.click(
        screen.getByRole("checkbox", { name: /^Read related files/ }),
      );
      expect(onSettingsChange).toHaveBeenCalledWith({
        ...settings,
        agenticContext: false,
      });
    },
  );

  it("keeps the model picker visible while new review settings wait for readiness", () => {
    render(
      <ProviderModelFields
        {...props}
        onModelChange={() => {}}
        settingsReady={false}
      />,
    );
    expect(screen.getByLabelText("Model", { exact: true })).toBeTruthy();
    expect(
      screen.queryByRole("checkbox", { name: /^Read related files/ }),
    ).toBeNull();
  });

  it("shows saved gateway settings without offering invented options during a catalog outage", () => {
    const onSettingsChange = vi.fn();
    render(
      <ProviderModelFields
        {...props}
        authMode="codex_account_gateway"
        onSettingsChange={onSettingsChange}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: /^Review depth/ }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("combobox", { name: /^Review depth/ }).textContent,
    ).toContain("saved; refresh account to edit");
    expect(
      screen.getByRole("checkbox", { name: /^Read related files/ }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/Review settings are shown/)).toBeTruthy();
    expect(screen.queryByText(/saved, unsupported/)).toBeNull();
    expect(onSettingsChange).not.toHaveBeenCalled();
  });

  it("preserves the current direct OpenRouter default while changing its file-reading preference", () => {
    expect(
      defaultProviderSelectionSettings({
        authMode: "openrouter_api_key",
        model: "vendor/model",
      }),
    ).toEqual({
      reasoningEffort: "xhigh",
      agenticContext: true,
      fastMode: false,
    });
    expect(
      fitProviderSelectionSettings({
        authMode: "openrouter_api_key",
        model: "vendor/model",
        settings: { ...props.settings, agenticContext: false },
      }),
    ).toEqual({ ...props.settings, agenticContext: false });
  });
});

it("preserves an omitted Codex account default and only corrects confirmed incompatible settings", () => {
  const input = {
    authMode: "codex_account_gateway" as const,
    model: "account-model",
    gatewayProfileRef: "openai-codex-oauth-responses-v1",
    settings: { agenticContext: true, fastMode: false },
    connection: {
      provider: "openai" as const,
      planLabel: "Codex",
      regionLabel: "Global",
      completionInputKind: "none" as const,
      personalOnly: false,
      limitsContract: "none" as const,
      modelSettings: [
        {
          modelId: "account-model",
          reasoning: { allowed: ["high"], default: "high" },
          fast: null,
          tools: {
            allowed: ["function" as const],
            default: "function" as const,
          },
        },
      ],
    },
  };
  expect(providerSelectionSettingsNeedCorrection(input)).toBe(false);
  expect(
    providerSelectionSettingsNeedCorrection({
      ...input,
      settings: { ...input.settings, fastMode: true },
    }),
  ).toBe(true);
  const { connection: _connection, ...unresolved } = input;
  void _connection;
  expect(
    providerSelectionSettingsNeedCorrection({
      ...unresolved,
      settings: { ...input.settings, fastMode: true },
    }),
  ).toBe(false);
});

it("keeps Gateway file reading an explicit engine choice when upstream tool metadata is none", () => {
  const settings = {
    reasoningEffort: "high" as const,
    agenticContext: true,
    fastMode: false,
  };
  const connection: AccountConnectionView = {
    provider: "openrouter",
    planLabel: "API",
    regionLabel: "Global",
    completionInputKind: "none",
    personalOnly: false,
    limitsContract: "none",
    modelSettings: [
      {
        modelId: "tool-free-model",
        reasoning: { allowed: ["high"], default: "high" },
        fast: null,
        tools: { allowed: ["none"], default: "none" },
      },
    ],
  };
  const onSettingsChange = vi.fn();
  const props: ProviderModelFieldsProps = {
    authMode: "codex_account_gateway",
    model: "tool-free-model",
    onModelChange: () => {},
    modelOptions: [],
    modelChoice: "list",
    settings,
    onSettingsChange,
    connection,
    agentProfileOptions: [],
    disabled: false,
  };
  render(<ProviderModelFields {...props} />);
  const control = screen.getByRole("checkbox", { name: /^Read related files/ });
  expect(control).toHaveProperty("disabled", false);
  expect(control).toHaveProperty("checked", true);
  fireEvent.click(control);
  expect(onSettingsChange).toHaveBeenCalledWith({
    ...settings,
    agenticContext: false,
  });
  expect(
    fitProviderSelectionSettings({
      ...props,
      settings: { ...settings, agenticContext: false },
    }).agenticContext,
  ).toBe(false);
  expect(fitProviderSelectionSettings(props).agenticContext).toBe(true);
});

it("closes model suggestions with Escape without closing the surrounding dialog", () => {
  const onDialogKey = vi.fn();
  render(
    <div onKeyDown={onDialogKey}>
      <ProviderModelFields
        authMode="openrouter_api_key"
        model="vendor/model"
        onModelChange={() => {}}
        modelOptions={[]}
        modelChoice="catalog"
        settings={{ agenticContext: true, fastMode: false }}
        onSettingsChange={() => {}}
        agentProfileOptions={[]}
        disabled={false}
      />
    </div>,
  );
  const input = screen.getByLabelText("Model", { exact: true });
  fireEvent.focus(input);
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onDialogKey).not.toHaveBeenCalled();
});

it("searchable account models skip disabled choices during keyboard selection", () => {
  const onModelChange = vi.fn();
  render(
    <ProviderModelPicker
      model=""
      onModelChange={onModelChange}
      modelChoice="catalog"
      allowCustomModel={false}
      disabled={false}
      modelOptions={[
        {
          provider: "openrouter",
          value: "unsupported/model",
          label: "Unsupported",
          disabled: true,
        },
        {
          provider: "openrouter",
          value: "available/model",
          label: "Available",
          description: "128K context",
        },
      ]}
    />,
  );
  const input = screen.getByRole("combobox", { name: "Model" });
  fireEvent.focus(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onModelChange).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(onModelChange).toHaveBeenCalledExactlyOnceWith("available/model");
  expect(screen.queryByRole("listbox")).toBeNull();
});
