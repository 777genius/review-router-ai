"use client";

import { useId, useMemo, useState, type FocusEvent } from "react";
import { Checkbox, SelectField } from "@reviewrouter/ui";
import {
  codexModelSupportsFastMode,
  codexModelSupportsReasoningEffort,
  providerKindForAuthMode,
  type ProviderAuthMode,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";
import type { AccountConnectionView } from "../../../src/features/account-gateway/connection-capabilities";
import {
  gatewayModelDefaultReasoningEffort,
  gatewayModelSupportsFastMode,
  gatewayModelSupportsReasoningEffort,
} from "../../../src/features/account-gateway/review-reasoning-capabilities";
import type { ProviderSelectionSettings } from "../../../src/features/provider-setup/provider-setup-model";
import type { GatewayAgentProfileOption } from "../../../src/server/gateway-agent-profile-options";

type ReviewReasoningEffort = NonNullable<
  ProviderSelectionSettings["reasoningEffort"]
>;

const reasoningEfforts = [
  { value: "minimal", label: "Minimal", description: "Least reasoning." },
  { value: "low", label: "Low", description: "Fastest and cheapest." },
  { value: "medium", label: "Medium", description: "Balanced." },
  { value: "high", label: "High", description: "Deeper review." },
  { value: "xhigh", label: "Extra high", description: "Deeper still." },
  { value: "max", label: "Max", description: "Very deep review." },
  { value: "ultra", label: "Ultra", description: "Deepest available." },
] as const satisfies readonly {
  readonly value: ReviewReasoningEffort;
  readonly label: string;
  readonly description: string;
}[];

/** Reasoning and fast controls; file reading is an independent runtime feature. */
export function providerHasReviewTuning(authMode: ProviderAuthMode): boolean {
  return (
    providerKindForAuthMode(authMode) === "codex" ||
    authMode === "mimo_token_plan_api_key"
  );
}

function reasoningSupported(
  authMode: ProviderAuthMode,
  model: string,
  effort: ReviewReasoningEffort | undefined,
  connection: AccountConnectionView | undefined,
  gatewayProfileRef?: string,
): boolean {
  if (authMode === "mimo_token_plan_api_key")
    return effort === "low" || effort === "medium" || effort === "high";
  return authMode === "codex_account_gateway"
    ? gatewayModelSupportsReasoningEffort(
        model,
        effort,
        connection,
        gatewayProfileRef,
      )
    : effort !== undefined &&
        effort !== "minimal" &&
        codexModelSupportsReasoningEffort(model, effort);
}

function fastSupported(
  authMode: ProviderAuthMode,
  model: string,
  connection: AccountConnectionView | undefined,
): boolean {
  if (authMode === "mimo_token_plan_api_key") return false;
  return authMode === "codex_account_gateway"
    ? gatewayModelSupportsFastMode(model, connection)
    : codexModelSupportsFastMode(model);
}

/**
 * Settings that fit the model: an unsupported reasoning depth falls back to
 * the model's default and fast mode turns off where the model has none.
 */
export function fitProviderSelectionSettings(input: {
  readonly authMode: ProviderAuthMode;
  readonly model: string;
  readonly settings: ProviderSelectionSettings;
  readonly connection?: AccountConnectionView | undefined;
  readonly gatewayProfileRef?: string | undefined;
}): ProviderSelectionSettings {
  const { authMode, model, connection, settings } = input;
  if (authMode === "kimi_code_api_key") {
    return { agenticContext: settings.agenticContext, fastMode: false };
  }
  const gateway = authMode === "codex_account_gateway";
  const effort = reasoningSupported(
    authMode,
    model,
    settings.reasoningEffort,
    connection,
    input.gatewayProfileRef,
  )
    ? settings.reasoningEffort
    : gateway
      ? gatewayModelDefaultReasoningEffort(model, connection)
      : authMode === "mimo_token_plan_api_key"
        ? "high"
        : "xhigh";
  return {
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
    agenticContext: settings.agenticContext,
    fastMode:
      providerHasReviewTuning(authMode) &&
      settings.fastMode &&
      fastSupported(authMode, model, connection),
    // An engine is chosen only for Account Gateway providers.
    ...(gateway && settings.agentProfileRef !== undefined
      ? { agentProfileRef: settings.agentProfileRef }
      : {}),
  };
}

/** Settings of a provider the user has not tuned yet. */
export function defaultProviderSelectionSettings(input: {
  readonly authMode: ProviderAuthMode;
  readonly model: string;
  readonly connection?: AccountConnectionView | undefined;
  readonly gatewayProfileRef?: string | undefined;
}): ProviderSelectionSettings {
  return fitProviderSelectionSettings({
    ...input,
    settings: {
      reasoningEffort:
        input.authMode === "codex_account_gateway" ? "high" : "xhigh",
      fastMode: false,
      agenticContext: true,
    },
  });
}

/** Confirmed incompatible settings require an explicit correction, not save-time coercion. */
export function providerSelectionSettingsNeedCorrection(
  input: Parameters<typeof fitProviderSelectionSettings>[0],
): boolean {
  const gatewayModel =
    input.authMode === "codex_account_gateway"
      ? input.connection?.modelSettings.find(
          (row) => row.modelId === input.model,
        )
      : undefined;
  if (input.authMode !== "mimo_token_plan_api_key" && !gatewayModel)
    return false;
  const fitted = fitProviderSelectionSettings(input);
  return (
    fitted.reasoningEffort !== input.settings.reasoningEffort ||
    fitted.fastMode !== input.settings.fastMode
  );
}

export type ProviderModelFieldsProps = Readonly<{
  authMode: ProviderAuthMode;
  model: string;
  /** Null shows the model as fixed, as for a provider that already exists. */
  onModelChange: ((model: string) => void) | null;
  /** Models the credential source offers. */
  modelOptions: readonly ReviewModelOption[];
  /** "list" allows only the listed models; "catalog" also a typed one. */
  modelChoice: "list" | "catalog";
  /** Gateway catalogs require an admitted option; API providers may use a typed id. */
  allowCustomModel?: boolean;
  settings: ProviderSelectionSettings;
  onSettingsChange: (settings: ProviderSelectionSettings) => void;
  connection?: AccountConnectionView | undefined;
  gatewayProfileRef?: string | undefined;
  agentProfileOptions: readonly GatewayAgentProfileOption[];
  disabled: boolean;
  /** New selections wait for a chosen model and resolved capabilities. */
  settingsReady?: boolean;
  hasSavedSettings?: boolean;
  hasEditedSettings?: boolean;
  emptyListPlaceholder?: string | undefined;
}>;

/**
 * The model and review settings of one provider. Shared by every place that
 * chooses a provider; the settings belong to the selection, not to the
 * provider, so the same provider can review differently per repository.
 */
export function ProviderModelFields({
  authMode,
  model,
  onModelChange,
  modelOptions,
  modelChoice,
  allowCustomModel = true,
  settings,
  onSettingsChange,
  connection,
  gatewayProfileRef,
  agentProfileOptions,
  disabled,
  settingsReady = true,
  hasSavedSettings,
  hasEditedSettings = false,
  emptyListPlaceholder,
}: ProviderModelFieldsProps): React.ReactElement {
  const tuning = providerHasReviewTuning(authMode);
  const gateway = authMode === "codex_account_gateway";
  const qualifiedModel = connection?.modelSettings.find(
    (row) => row.modelId === model,
  );
  const capabilitiesKnown = !gateway || qualifiedModel !== undefined;
  const savedSelection = hasSavedSettings ?? onModelChange === null;
  const explicitSelection = savedSelection || hasEditedSettings;
  const ready = settingsReady && model.trim().length > 0;
  // Repository context is an execution-engine choice. Upstream tool-call
  // metadata alone does not decide whether that engine can read related files.
  const relatedFilesSupported = gateway
    ? capabilitiesKnown
    : tuning ||
      authMode === "openrouter_api_key" ||
      authMode === "kimi_code_api_key";
  const showRelatedFiles =
    ready &&
    (relatedFilesSupported ||
      (gateway &&
        savedSelection &&
        (!capabilitiesKnown || settings.agenticContext)));
  const reasoningOptions = reasoningEfforts.filter(
    (option) =>
      capabilitiesKnown &&
      !(
        gatewayProfileRef === "openai-codex-oauth-responses-v1" &&
        option.value === "ultra" &&
        settings.reasoningEffort !== "ultra"
      ) &&
      reasoningSupported(
        authMode,
        model,
        option.value,
        connection,
        gatewayProfileRef,
      ),
  );
  const showReasoning =
    ready &&
    tuning &&
    (!gateway ||
      qualifiedModel?.reasoning != null ||
      (explicitSelection && settings.reasoningEffort !== undefined));
  const showFast =
    ready &&
    tuning &&
    ((capabilitiesKnown && fastSupported(authMode, model, connection)) ||
      (authMode === "mimo_token_plan_api_key" && settings.fastMode) ||
      (gateway && explicitSelection && settings.fastMode));
  const needsCorrection = providerSelectionSettingsNeedCorrection({
    authMode,
    model,
    settings,
    connection,
    gatewayProfileRef,
  });
  const savedDepthUnsupported =
    (authMode === "mimo_token_plan_api_key" ||
      (gateway && capabilitiesKnown)) &&
    settings.reasoningEffort !== undefined &&
    !reasoningOptions.some(
      (option) => option.value === settings.reasoningEffort,
    );
  const savedProfileUnavailable =
    settings.agentProfileRef !== undefined &&
    !agentProfileOptions.some(
      (option) => option.profileRef === settings.agentProfileRef,
    );
  const savedDepthUnavailable =
    gateway && !capabilitiesKnown && settings.reasoningEffort !== undefined;
  const accountDefaultAvailable =
    gateway &&
    capabilitiesKnown &&
    (qualifiedModel?.reasoning === null ||
      gatewayProfileRef === "openai-codex-oauth-responses-v1");
  const missingReasoningControl =
    gateway && qualifiedModel?.reasoning === null && savedDepthUnsupported;
  const missingFastControl =
    gateway && qualifiedModel?.fast === null && settings.fastMode;
  const correctionActions = [
    ...(savedDepthUnsupported
      ? [
          accountDefaultAvailable
            ? "choose Account default for review depth"
            : "choose an available review depth",
        ]
      : []),
    ...(settings.fastMode && !fastSupported(authMode, model, connection)
      ? ["turn off fast mode"]
      : []),
  ];
  const showEngine =
    ready &&
    gateway &&
    (capabilitiesKnown ||
      (savedSelection && settings.agentProfileRef !== undefined)) &&
    (agentProfileOptions.length > 0 || savedProfileUnavailable);
  const update = (next: Partial<ProviderSelectionSettings>) =>
    onSettingsChange({ ...settings, ...next });

  return (
    <div className="grid items-start gap-4 sm:grid-cols-2">
      <ProviderModelPicker
        model={model}
        onModelChange={onModelChange}
        modelOptions={modelOptions}
        modelChoice={modelChoice}
        allowCustomModel={allowCustomModel}
        disabled={disabled}
        emptyListPlaceholder={emptyListPlaceholder}
        className="sm:col-span-2"
      />
      {showReasoning ? (
        <SelectField
          className={showEngine ? "" : "sm:col-span-2"}
          label="Review depth"
          value={
            settings.reasoningEffort ??
            (accountDefaultAvailable ? modelDefault : "")
          }
          placeholder="Choose a depth"
          disabled={
            disabled ||
            (reasoningOptions.length === 0 && !accountDefaultAvailable)
          }
          options={[
            ...(accountDefaultAvailable
              ? [{ value: modelDefault, label: "Account default" }]
              : []),
            ...(savedDepthUnsupported || savedDepthUnavailable
              ? [
                  {
                    value: settings.reasoningEffort!,
                    label: `${settings.reasoningEffort} (${savedDepthUnavailable ? "saved; refresh account to edit" : `${savedSelection ? "saved" : "selected"}, ${missingReasoningControl ? "unavailable in ReviewRouter" : "unsupported"}`})`,
                    disabled: true,
                  },
                ]
              : []),
            ...reasoningOptions,
          ]}
          onValueChange={(value) => {
            if (value === modelDefault) {
              const { reasoningEffort: _previous, ...rest } = settings;
              void _previous;
              onSettingsChange(rest);
            } else update({ reasoningEffort: value as ReviewReasoningEffort });
          }}
          hint="Deeper reviews find more and take longer."
        />
      ) : null}
      {showEngine ? (
        <SelectField
          className={showReasoning ? "" : "sm:col-span-2"}
          label="Review engine"
          value={settings.agentProfileRef ?? defaultEngine}
          disabled={disabled || !capabilitiesKnown}
          options={[
            {
              value: defaultEngine,
              label: "Default",
              description: "The managed review engine ReviewRouter recommends.",
            },
            ...agentProfileOptions.map((option) => ({
              value: option.profileRef,
              label: option.label,
              description: option.description,
            })),
            ...(savedProfileUnavailable
              ? [
                  {
                    value: settings.agentProfileRef!,
                    label: "Saved engine unavailable",
                    description:
                      "It is no longer offered. Your saved choice stays until you change it.",
                    disabled: true,
                  },
                ]
              : []),
          ]}
          onValueChange={(value) => {
            const { agentProfileRef: _previous, ...rest } = settings;
            void _previous;
            onSettingsChange(
              value === defaultEngine
                ? rest
                : { ...rest, agentProfileRef: value },
            );
          }}
        />
      ) : null}
      {showFast || showRelatedFiles ? (
        <div className="grid gap-3 sm:col-span-2">
          {showFast ? (
            <CheckboxRow
              checked={settings.fastMode}
              disabled={disabled || !capabilitiesKnown}
              onChange={(fastMode) => update({ fastMode })}
              label="Fast mode"
              hint={
                capabilitiesKnown && !fastSupported(authMode, model, connection)
                  ? missingFastControl
                    ? "ReviewRouter does not offer this setting. Turn off fast mode to save these settings."
                    : "Turn off fast mode to save these settings."
                  : "Shorter, quicker review passes."
              }
            />
          ) : null}
          {showRelatedFiles ? (
            <CheckboxRow
              checked={settings.agenticContext}
              disabled={disabled || (gateway && !capabilitiesKnown)}
              onChange={(agenticContext) => update({ agenticContext })}
              label="Read related files"
              hint="The reviewer may open other files of the repository, read-only, instead of looking only at the change."
            />
          ) : null}
        </div>
      ) : null}
      {ready && gateway && savedSelection && !capabilitiesKnown ? (
        <p role="status" className="text-sm text-slate-400 sm:col-span-2">
          Review settings are shown. Refresh the account to load its available
          settings.
        </p>
      ) : null}
      {ready && needsCorrection ? (
        <p role="status" className="text-sm text-amber-100 sm:col-span-2">
          {missingReasoningControl || missingFastControl ? (
            <>
              ReviewRouter does not offer{" "}
              {missingReasoningControl && missingFastControl
                ? "review depth or fast mode settings"
                : missingReasoningControl
                  ? "a review depth setting"
                  : "a fast mode setting"}{" "}
              for this model. Before running reviews,{" "}
              {correctionActions.join(" and ")}.
            </>
          ) : (
            <>
              The {savedSelection ? "saved" : "selected"} review depth or fast
              mode is not supported. Choose an available setting before saving.
            </>
          )}
        </p>
      ) : null}
    </div>
  );
}

const defaultEngine = "__default__";
const modelDefault = "__model_default__";

/**
 * The model of one provider alone: a list for a credential that offers fixed
 * models, a catalog with free input otherwise, or the fixed model when it
 * cannot change here. Used inside `ProviderModelFields` and where only the
 * provider's model changes, such as a provider edit in the Providers list.
 */
export function ProviderModelPicker({
  model,
  onModelChange,
  modelOptions,
  modelChoice,
  allowCustomModel = true,
  disabled,
  emptyListPlaceholder = "Choose an account first",
  className,
}: Readonly<{
  model: string;
  /** Null shows the model as fixed. */
  onModelChange: ((model: string) => void) | null;
  modelOptions: readonly ReviewModelOption[];
  modelChoice: "list" | "catalog";
  allowCustomModel?: boolean;
  disabled: boolean;
  /** The list placeholder while the credential offers no model. */
  emptyListPlaceholder?: string | undefined;
  className?: string;
}>): React.ReactElement {
  if (!onModelChange)
    return (
      <div className={["grid gap-1", className].filter(Boolean).join(" ")}>
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Model
        </span>
        <span className="text-sm text-cyan-50">{model}</span>
      </div>
    );
  if (modelChoice === "list")
    return (
      <SelectField
        label="Model"
        value={model}
        placeholder={
          modelOptions.length === 0 ? emptyListPlaceholder : "Choose a model"
        }
        disabled={disabled || modelOptions.length === 0}
        options={[
          ...(model && !modelOptions.some((option) => option.value === model)
            ? [
                {
                  value: model,
                  label: `${model} (saved, unavailable)`,
                  disabled: true,
                },
              ]
            : []),
          ...modelOptions.map((option) => ({
            value: option.value,
            label: option.label,
            ...(option.disabled ? { disabled: true } : {}),
            ...(option.description ? { description: option.description } : {}),
            ...(option.badge
              ? {
                  icon: (
                    <span className="rounded-md border border-cyan-300/30 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase leading-none text-cyan-100">
                      {option.badge}
                    </span>
                  ),
                }
              : {}),
          })),
        ]}
        onValueChange={onModelChange}
        {...(className ? { className } : {})}
      />
    );
  return (
    <ProviderModelInput
      value={model}
      options={modelOptions}
      allowCustomModel={allowCustomModel}
      disabled={disabled}
      onValueChange={onModelChange}
      {...(className ? { className } : {})}
    />
  );
}

function CheckboxRow({
  checked,
  disabled,
  onChange,
  label,
  hint,
}: {
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly hint: string;
}): React.ReactElement {
  return (
    <label className="flex cursor-pointer items-start gap-3 text-sm has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5"
      />
      <span className="grid gap-0.5">
        <span className="font-semibold text-cyan-50">{label}</span>
        <span className="text-xs leading-5 text-slate-400">{hint}</span>
      </span>
    </label>
  );
}

/** A model name with suggestions from the catalog; any typed name is kept. */
function ProviderModelInput({
  value,
  options,
  allowCustomModel,
  disabled,
  onValueChange,
  className,
}: {
  readonly value: string;
  readonly options: readonly ReviewModelOption[];
  readonly allowCustomModel: boolean;
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
  readonly className?: string;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const listboxId = useId();
  const selected = options.find((option) => option.value === value);
  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query || selected) return options;
    return options.filter((option) =>
      [option.label, option.value, option.description ?? ""].some((text) =>
        text.toLowerCase().includes(query),
      ),
    );
  }, [options, selected, value]);

  function closeWhenFocusLeaves(event: FocusEvent<HTMLLabelElement>): void {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setOpen(false);
  }

  return (
    <label
      className={[
        "relative grid min-w-0 gap-2 text-sm text-slate-300",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      onBlur={closeWhenFocusLeaves}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        Model
      </span>
      <span className="relative block">
        <input
          value={value}
          role="combobox"
          disabled={disabled}
          onChange={(event) => {
            onValueChange(event.target.value);
            setActiveValue(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              const available = filtered.filter((option) => !option.disabled);
              const current = available.findIndex(
                (option) => option.value === activeValue,
              );
              const next =
                event.key === "ArrowDown"
                  ? (current + 1) % available.length
                  : current <= 0
                    ? available.length - 1
                    : current - 1;
              setActiveValue(available[next]?.value ?? null);
            } else if (event.key === "Enter" && open) {
              event.preventDefault();
              const active = filtered.find(
                (option) => option.value === activeValue && !option.disabled,
              );
              if (!active) return;
              onValueChange(active.value);
              setActiveValue(null);
              setOpen(false);
            }
          }}
          aria-controls={listboxId}
          aria-expanded={open}
          aria-activedescendant={
            open && activeValue
              ? `${listboxId}-${filtered.findIndex((option) => option.value === activeValue)}`
              : undefined
          }
          aria-autocomplete="list"
          aria-label="Model"
          autoComplete="off"
          spellCheck={false}
          className="min-h-11 w-full rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 pr-12 text-cyan-50 outline-none transition placeholder:text-slate-500 hover:border-cyan-200/30 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50"
        />
        <button
          type="button"
          disabled={disabled}
          aria-label="Show models"
          onClick={() => setOpen((current) => !current)}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-cyan-100/80 transition hover:bg-cyan-300/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span aria-hidden="true">⌄</span>
        </button>
      </span>
      {value && (!selected || selected.disabled) ? (
        <span className="text-xs text-slate-400">
          {selected?.disabled
            ? `${selected.description ?? "This model is unavailable for review."} Choose an available model from the catalog.`
            : allowCustomModel
              ? "Not in the list; this name is used as typed."
              : "Choose an available model from this account's catalog."}
        </span>
      ) : null}
      {open ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute left-0 right-0 top-full z-[70] mt-2 max-h-72 overflow-y-auto rounded-xl border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-1 shadow-[var(--rr-shadow-elevated)]"
        >
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-slate-400">
              {allowCustomModel
                ? "No listed model matches. The typed name is used."
                : "No listed model matches. Try another name or model id."}
            </div>
          ) : null}
          {filtered.map((option, index) => (
            <button
              key={option.value}
              type="button"
              role="option"
              id={`${listboxId}-${index}`}
              aria-label={option.label}
              aria-disabled={option.disabled || undefined}
              aria-selected={option.value === value}
              disabled={option.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onMouseMove={() =>
                setActiveValue(option.disabled ? null : option.value)
              }
              onClick={() => {
                if (option.disabled) return;
                onValueChange(option.value);
                setActiveValue(null);
                setOpen(false);
              }}
              className={[
                "grid w-full gap-0.5 rounded-lg px-3 py-2 text-left transition hover:bg-cyan-300/[0.08] disabled:cursor-not-allowed disabled:opacity-55",
                option.value === value || option.value === activeValue
                  ? "bg-cyan-300/[0.1] text-cyan-50"
                  : "text-slate-300",
              ].join(" ")}
            >
              <span className="flex min-w-0 items-center justify-between gap-3 text-sm font-semibold">
                <span className="min-w-0 truncate">{option.label}</span>
                {option.badge ? (
                  <span className="rounded-md border border-cyan-300/30 px-1.5 py-0.5 text-[0.62rem] font-bold uppercase leading-none text-cyan-100">
                    {option.badge}
                  </span>
                ) : null}
              </span>
              <span className="text-xs text-slate-500">{option.value}</span>
              {option.description ? (
                <span className="text-xs leading-5 text-slate-400">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </label>
  );
}
