"use client";

import type { ContextConnectionMetadata } from "@reviewrouter/features-review-context-tools";
import type {
  RepositoryReviewSettings,
  WorkspaceReviewSettings,
} from "@reviewrouter/features-review-config/review-policy-document";
import type { ProviderAuthMode } from "@reviewrouter/features-review-providers";
import { Button, Dialog } from "@reviewrouter/ui";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as RadixSelect from "@radix-ui/react-select";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ActionToast } from "../action-toast";
import { FormSubmitButton } from "../form-submit-button";
import {
  clearRepositoryReviewConfigClientAction,
  saveRepositoryReviewConfigClientAction,
  saveWorkspaceReviewConfigClientAction,
} from "./actions";
import { ContextToolsSelectionField } from "./context-tools/context-tools-selection-field";
import { dashboardErrorText } from "./dashboard-copy";
import { repositoryPolicyFormFields } from "./review-policy-form-contract";

/**
 * Review settings besides the provider: blocking, limits, language, context
 * tools and rollout. The provider and its reasoning/fast/agentic settings are
 * chosen in the provider dialog; these forms never submit them, so a form
 * opened before a provider change cannot revert it.
 */

type DashboardFormAction = (formData: FormData) => void | Promise<void>;

type RepositoryPolicyEditorRepository = {
  readonly id: string;
  readonly fullName: string;
  readonly selected: boolean;
  readonly archived: boolean;
};

type ReviewConfigActionParams = Record<string, string>;
type ReviewConfigActionResult = {
  readonly params: ReviewConfigActionParams;
};
type ReviewConfigActionToast = {
  readonly key: number;
  readonly tone: "success" | "warning" | "danger" | "accent";
  readonly title: string;
  readonly body: string;
};

type OverrideField = (typeof repositoryPolicyFormFields)[number];

type DashboardSelectOption = {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
};

const failOnSeverityOptions = [
  { value: "off", label: "Off", description: "Never fail the check." },
  {
    value: "critical",
    label: "Critical",
    description: "Block only critical findings.",
  },
  { value: "major", label: "Major", description: "Block major and critical." },
] as const;

const fieldHelp = {
  failOnSeverity:
    "Controls which finding severity makes the GitHub check fail.",
  providerMaxParallel:
    "Maximum number of selected providers ReviewRouter may run at the same time.",
  inlineMinAgreement:
    "Number of providers that should agree before an inline finding is treated as agreed.",
  updatePrDescription:
    "Adds an AI-generated summary through a supported review runtime while preserving the author's text.",
  reviewLanguage:
    "Natural language for inline comments and the main reviewer summary (free text, e.g. Russian). Leave empty to inherit the workspace default, which is English.",
} as const;

/** Execution limits only matter where more than one provider is selected. */
const executionFields = new Set<string>([
  "execution.providerMaxParallel",
  "execution.inlineMinAgreement",
]);

function overrideCount(overrides: RepositoryReviewSettings): number {
  return repositoryPolicyFormFields.filter((field) =>
    isOverridden(overrides, field),
  ).length;
}

function isOverridden(
  overrides: RepositoryReviewSettings | undefined,
  field: OverrideField,
): boolean {
  if (!overrides) return false;
  const [root, leaf] = field;
  const value = overrides[root];
  return leaf === undefined
    ? Object.hasOwn(overrides, root)
    : value != null && typeof value === "object" && Object.hasOwn(value, leaf);
}

function repositorySettingsSummary(input: {
  readonly overrides: RepositoryReviewSettings | null;
  readonly legacy: boolean;
}): string {
  if (input.legacy) return "retired format";
  const count = input.overrides ? overrideCount(input.overrides) : 0;
  return count === 0
    ? "inherits workspace"
    : `${count} ${count === 1 ? "option" : "options"} overridden`;
}

function RemoveRepositoryOverrides({
  action,
  workspaceId,
  repositoryId,
  repositoryName,
  legacy,
  expectedVersion,
  disabled,
}: {
  readonly action: (formData: FormData) => Promise<boolean>;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly repositoryName: string;
  readonly legacy: boolean;
  readonly expectedVersion: number | null;
  readonly disabled: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [resetVersion, setResetVersion] = useState(expectedVersion);
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setResetVersion(expectedVersion);
          setOpen(true);
        }}
      >
        {legacy
          ? "Replace retired settings with the workspace settings"
          : "Remove all repository overrides…"}
      </Button>
      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Backdrop />
          <Dialog.Popup initialFocus={cancelRef}>
            <Dialog.Title>Remove all repository overrides?</Dialog.Title>
            <Dialog.Description>
              {legacy
                ? `${repositoryName} will use the workspace review settings and the workspace default provider.`
                : `${repositoryName} will use the workspace review settings: blocking, limits, language, context tools and rollout. Its provider does not change.`}
            </Dialog.Description>
            <form
              action={async (formData) => {
                if (await action(formData)) setOpen(false);
              }}
              className="mt-4 flex gap-2"
            >
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="repositoryId" value={repositoryId} />
              <input
                type="hidden"
                name="policyExpectedVersion"
                value={String(resetVersion ?? "none")}
              />
              <Button
                ref={cancelRef}
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <FormSubmitButton
                variant="solid"
                disabled={disabled}
                idleLabel="Remove all overrides"
                pendingLabel="Removing..."
              />
            </form>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

/** The "Edit settings" disclosure of one repository row. */
export function RepositoryPolicyEditor({
  workspaceId,
  repository,
  settings,
  overrides,
  legacy,
  expectedVersion,
  providerCount,
  primaryAuthMode,
  contextConnections = [],
  mutationsEnabled,
  editDisabledReason,
  compact = false,
}: {
  readonly workspaceId: string;
  readonly repository: RepositoryPolicyEditorRepository;
  /** What the repository reviews with: workspace settings and its overrides. */
  readonly settings: WorkspaceReviewSettings;
  /** Its stored overrides; null when it has no settings of its own. */
  readonly overrides: RepositoryReviewSettings | null;
  /** Its stored document cannot be read in the current format. */
  readonly legacy: boolean;
  readonly expectedVersion: number | null;
  readonly providerCount: number;
  readonly primaryAuthMode?: ProviderAuthMode | undefined;
  readonly contextConnections?:
    | readonly ContextConnectionMetadata[]
    | undefined;
  readonly mutationsEnabled: boolean;
  readonly editDisabledReason?: string | undefined;
  readonly compact?: boolean;
}): React.ReactElement {
  const reviewConfigAction = useReviewConfigActionToast();
  const [open, setOpen] = useState(false);
  const canEdit =
    mutationsEnabled && repository.selected && !repository.archived;
  const panelId = `repo-settings-${repository.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const hasOverrides =
    legacy || (overrides !== null && overrideCount(overrides) > 0);

  async function saveRepositorySettings(formData: FormData): Promise<void> {
    await reviewConfigAction.run(
      () => saveRepositoryReviewConfigClientAction(formData),
      {
        error: "dashboard_action_stale",
        workspace: workspaceId,
        section: "repositories",
      },
    );
  }

  async function clearRepositorySettings(formData: FormData): Promise<boolean> {
    return reviewConfigAction.run(
      () => clearRepositoryReviewConfigClientAction(formData),
      {
        error: "dashboard_action_stale",
        workspace: workspaceId,
        section: "repositories",
      },
    );
  }

  return (
    <div
      className={
        compact
          ? "grid gap-3 justify-items-end"
          : "grid w-full justify-items-end"
      }
    >
      {reviewConfigAction.toast}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className={[
          "inline-flex max-w-full min-w-0 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl border border-cyan-300/25 px-4 py-3 text-xs font-semibold text-cyan-100 transition duration-200 ease-out hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-cyan-300/[0.06] hover:saturate-125 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200",
          compact ? "px-3 sm:px-4" : "",
        ].join(" ")}
      >
        <span className="font-mono uppercase tracking-[0.14em]">
          Edit settings
        </span>
        <span className="inline-flex min-w-0 items-center gap-2 text-right text-slate-300">
          <span className={compact ? "hidden truncate sm:inline" : "truncate"}>
            {repositorySettingsSummary({ overrides, legacy })}
          </span>
          <ChevronIcon open={open} />
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          className={[
            "mt-4 grid w-full justify-self-stretch gap-4 px-1 pb-1 sm:px-2",
            compact ? "col-span-full w-full flex-[1_0_100%]" : "",
          ].join(" ")}
        >
          {legacy ? (
            <p role="alert" className="text-sm leading-6 text-amber-100">
              The saved settings of this repository use a retired format and are
              not applied, so its reviews are stopped. Save the settings below
              to replace them.
            </p>
          ) : null}
          <ReviewSettingsForm
            key={String(expectedVersion ?? "none")}
            action={saveRepositorySettings}
            settings={settings}
            overrides={overrides ?? {}}
            providerCount={providerCount}
            primaryAuthMode={primaryAuthMode}
            contextConnections={contextConnections}
            repositoryTarget={{ workspaceId, repositoryId: repository.id }}
            hiddenFields={[
              { name: "workspaceId", value: workspaceId },
              { name: "repositoryId", value: repository.id },
              {
                name: "policyExpectedVersion",
                value: String(expectedVersion ?? "none"),
              },
            ]}
            mutationsEnabled={canEdit}
            submitLabel={
              legacy ? "Replace retired settings" : "Save repo settings"
            }
          />
          {!canEdit && editDisabledReason ? (
            <p className="text-xs leading-5 text-amber-100/85">
              {editDisabledReason}
            </p>
          ) : null}

          {hasOverrides ? (
            <RemoveRepositoryOverrides
              action={clearRepositorySettings}
              workspaceId={workspaceId}
              repositoryId={repository.id}
              repositoryName={repository.fullName}
              legacy={legacy}
              expectedVersion={expectedVersion}
              disabled={!canEdit}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** The workspace review settings of the Models section. */
export function WorkspaceReviewSettingsForm({
  workspaceId,
  expectedVersion,
  settings,
  providerCount,
  primaryAuthMode,
  contextConnections = [],
  mutationsEnabled,
  submitLabel = "Save workspace settings",
}: {
  readonly workspaceId: string;
  /** The stored workspace version; null when the workspace has none yet. */
  readonly expectedVersion: number | null;
  readonly settings: WorkspaceReviewSettings;
  readonly providerCount: number;
  readonly primaryAuthMode?: ProviderAuthMode | undefined;
  readonly contextConnections?:
    | readonly ContextConnectionMetadata[]
    | undefined;
  readonly mutationsEnabled: boolean;
  readonly submitLabel?: string | undefined;
}): React.ReactElement {
  const reviewConfigAction = useReviewConfigActionToast();

  async function saveWorkspaceSettings(formData: FormData): Promise<void> {
    await reviewConfigAction.run(
      () => saveWorkspaceReviewConfigClientAction(formData),
      {
        error: "dashboard_action_stale",
        workspace: workspaceId,
        section: "policy",
      },
    );
  }

  return (
    <>
      {reviewConfigAction.toast}
      <ReviewSettingsForm
        key={String(expectedVersion ?? "none")}
        action={saveWorkspaceSettings}
        settings={settings}
        providerCount={providerCount}
        primaryAuthMode={primaryAuthMode}
        contextConnections={contextConnections}
        hiddenFields={[
          { name: "workspaceId", value: workspaceId },
          {
            name: "policyExpectedVersion",
            value: expectedVersion === null ? "none" : String(expectedVersion),
          },
        ]}
        mutationsEnabled={mutationsEnabled}
        submitLabel={submitLabel}
      />
    </>
  );
}

/**
 * The settings form of the workspace or, with `overrides`, of one repository
 * where each field either inherits the workspace or overrides it.
 */
export function ReviewSettingsForm({
  action,
  settings,
  overrides,
  providerCount,
  primaryAuthMode,
  contextConnections = [],
  repositoryTarget,
  hiddenFields,
  mutationsEnabled,
  submitLabel,
}: {
  readonly action: DashboardFormAction;
  readonly settings: WorkspaceReviewSettings;
  /** Present for a repository: its stored overrides. */
  readonly overrides?: RepositoryReviewSettings;
  readonly providerCount: number;
  readonly primaryAuthMode?: ProviderAuthMode | undefined;
  readonly contextConnections?:
    | readonly ContextConnectionMetadata[]
    | undefined;
  readonly repositoryTarget?:
    | { readonly workspaceId: string; readonly repositoryId: string }
    | undefined;
  readonly hiddenFields: readonly {
    readonly name: string;
    readonly value: string;
  }[];
  readonly mutationsEnabled: boolean;
  readonly submitLabel: string;
}): React.ReactElement {
  const repositoryMode = overrides !== undefined;
  const [overrideModes, setOverrideModes] = useState<Record<string, string>>(
    () =>
      Object.fromEntries(
        repositoryPolicyFormFields.map((field) => [
          field.join("."),
          isOverridden(overrides, field) ? "override" : "inherit",
        ]),
      ),
  );
  const [updatePrDescription, setUpdatePrDescription] = useState(
    settings.updatePrDescription !== false,
  );
  const limit = Math.max(providerCount, 1);
  const [providerMaxParallel, setProviderMaxParallel] = useState(
    Math.min(settings.execution.providerMaxParallel, limit),
  );
  const [inlineMinAgreement, setInlineMinAgreement] = useState(
    Math.min(settings.execution.inlineMinAgreement, limit),
  );
  const showExecution = providerCount > 1;
  const inherits = (name: string) =>
    repositoryMode && overrideModes[name] !== "override";
  const addableOverrideFields = repositoryPolicyFormFields.filter(
    (field) =>
      overrideModes[field.join(".")] !== "override" &&
      (showExecution || !executionFields.has(field.join("."))),
  );
  const aiPrDescriptionUnavailable =
    primaryAuthMode !== undefined &&
    primaryAuthMode !== "codex_account_gateway" &&
    primaryAuthMode !== "openrouter_api_key";

  return (
    <Tooltip.Provider delayDuration={180} skipDelayDuration={80}>
      <form action={action} className="grid gap-5">
        {hiddenFields.map((field) => (
          <input
            key={`${field.name}:${field.value}`}
            type="hidden"
            name={field.name}
            value={field.value}
          />
        ))}
        {repositoryMode ? (
          <fieldset className="grid gap-2 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-medium">
              Repository overrides
            </legend>
            {repositoryPolicyFormFields.map((field) => {
              const name = field.join(".");
              if (overrideModes[name] !== "override") {
                return (
                  <input
                    key={name}
                    type="hidden"
                    name={`policyMode.${name}`}
                    value="inherit"
                  />
                );
              }
              return (
                <label
                  key={name}
                  className="flex items-center justify-between gap-2 text-xs"
                >
                  <span>{overrideFieldLabel(field)}</span>
                  <select
                    name={`policyMode.${name}`}
                    value={overrideModes[name]}
                    disabled={!mutationsEnabled}
                    onChange={(event) =>
                      setOverrideModes((previous) => ({
                        ...previous,
                        [name]: event.target.value,
                      }))
                    }
                  >
                    <option value="inherit">Inherit workspace</option>
                    <option value="override">Override</option>
                  </select>
                </label>
              );
            })}
            {addableOverrideFields.length > 0 ? (
              <AddOverrideFieldMenu
                disabled={!mutationsEnabled}
                fields={addableOverrideFields}
                onAdd={(name) =>
                  setOverrideModes((previous) => ({
                    ...previous,
                    [name]: "override",
                  }))
                }
              />
            ) : null}
          </fieldset>
        ) : null}
        <input
          type="hidden"
          name="inlineMaxComments"
          value={settings.limits.inlineMaxComments}
        />
        <input
          type="hidden"
          name="targetTokensPerBatch"
          value={settings.limits.targetTokensPerBatch}
        />
        {Object.entries(settings.investigationRollout).map(
          ([name, enabled]) => (
            <input
              key={name}
              type="hidden"
              name={`investigationRollout.${name}`}
              value={String(enabled)}
            />
          ),
        )}
        {showExecution ? null : (
          <>
            <input
              type="hidden"
              name="providerMaxParallel"
              value={settings.execution.providerMaxParallel}
            />
            <input
              type="hidden"
              name="inlineMinAgreement"
              value={settings.execution.inlineMinAgreement}
            />
          </>
        )}

        <section className="grid gap-3">
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Checks
          </div>
          <div className="grid gap-4 md:grid-cols-3 md:gap-x-8">
            {showExecution ? (
              <>
                <DashboardNumberField
                  name="providerMaxParallel"
                  label="Max parallel providers"
                  helpText={fieldHelp.providerMaxParallel}
                  value={providerMaxParallel}
                  min={1}
                  max={limit}
                  disabled={
                    !mutationsEnabled ||
                    inherits("execution.providerMaxParallel")
                  }
                  onValueChange={setProviderMaxParallel}
                />
                <DashboardNumberField
                  name="inlineMinAgreement"
                  label="Inline agreement"
                  helpText={fieldHelp.inlineMinAgreement}
                  value={inlineMinAgreement}
                  min={1}
                  max={limit}
                  disabled={
                    !mutationsEnabled ||
                    inherits("execution.inlineMinAgreement")
                  }
                  onValueChange={setInlineMinAgreement}
                />
              </>
            ) : null}
            <DashboardSelectField
              name="failOnSeverity"
              label="Fail on severity"
              helpText={fieldHelp.failOnSeverity}
              value={settings.blockingPolicy.failOnSeverity}
              disabled={
                !mutationsEnabled || inherits("blockingPolicy.failOnSeverity")
              }
              options={failOnSeverityOptions}
            />
          </div>
        </section>

        <section className="grid gap-3">
          <div className="font-mono text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">
            Output
          </div>
          <div className="grid gap-4 md:grid-cols-3 md:gap-x-8">
            <DashboardSwitchField
              name="updatePrDescription"
              label="Update PR description"
              helpText={fieldHelp.updatePrDescription}
              checked={updatePrDescription}
              disabled={!mutationsEnabled || inherits("updatePrDescription")}
              onCheckedChange={setUpdatePrDescription}
            />
            <DashboardReviewLanguageField
              defaultValue={settings.reviewLanguage ?? ""}
              disabled={!mutationsEnabled || inherits("reviewLanguage")}
            />
          </div>
          {aiPrDescriptionUnavailable ? (
            <p className="text-sm leading-6 text-slate-400">
              AI PR descriptions are unavailable for this provider. Reviews
              continue normally.
            </p>
          ) : null}
        </section>

        <ContextToolsSelectionField
          value={settings.contextTools}
          repositoryTarget={repositoryTarget}
          connections={contextConnections}
          disabled={!mutationsEnabled || inherits("contextTools")}
        />

        <div className="flex min-w-0 items-end border-t border-cyan-200/10 pt-4">
          <FormSubmitButton
            variant="solid"
            className="w-full sm:w-auto sm:min-w-64"
            disabled={!mutationsEnabled}
            idleLabel={submitLabel}
            pendingLabel="Saving..."
          />
        </div>
      </form>
    </Tooltip.Provider>
  );
}

function useReviewConfigActionToast(): {
  readonly toast: React.ReactElement | null;
  readonly run: (
    action: () => Promise<ReviewConfigActionResult>,
    fallbackParams: ReviewConfigActionParams,
  ) => Promise<boolean>;
} {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [toast, setToast] = useState<ReviewConfigActionToast | null>(null);

  return {
    toast: toast ? (
      <ActionToast
        key={toast.key}
        tone={toast.tone}
        title={toast.title}
        body={toast.body}
      />
    ) : null,
    run: async (action, fallbackParams) => {
      let params: ReviewConfigActionParams;
      try {
        ({ params } = await action());
      } catch {
        params = fallbackParams;
      }

      replaceDashboardContextUrl(params);
      setToast((current) => ({
        ...reviewConfigActionToast(params),
        key: (current?.key ?? 0) + 1,
      }));
      if (!params.error) startTransition(() => router.refresh());
      return !params.error;
    },
  };
}

function replaceDashboardContextUrl(params: ReviewConfigActionParams): void {
  const url = new URL(window.location.href);
  let changed = false;

  for (const key of ["notice", "error", "pr", "version"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  for (const key of ["workspace", "section"] as const) {
    const value = params[key];
    if (value && url.searchParams.get(key) !== value) {
      url.searchParams.set(key, value);
      changed = true;
    }
  }

  if (!changed) return;

  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${search ? `?${search}` : ""}${url.hash}`,
  );
}

function reviewConfigActionToast(
  params: ReviewConfigActionParams,
): Omit<ReviewConfigActionToast, "key"> {
  if (params.error) {
    return {
      tone: "danger",
      title: "Action needs attention",
      body: dashboardErrorText(params.error),
    };
  }

  switch (params.notice) {
    case "review_config_saved":
      return {
        tone: "success",
        title: "Review settings saved",
        body: "Workspace review settings were saved. Future review runs use them.",
      };
    case "repository_review_config_saved":
      return {
        tone: "success",
        title: "Review settings saved",
        body: params.repository
          ? `Review settings were saved for ${params.repository}.`
          : "Repository review settings were saved.",
      };
    case "repository_review_config_cleared":
      return {
        tone: "success",
        title: "Review settings saved",
        body: params.repository
          ? `${params.repository} now uses the workspace review settings.`
          : "Repository overrides were removed.",
      };
    default:
      return {
        tone: "success",
        title: "Action complete",
        body: "Dashboard settings were saved.",
      };
  }
}

function overrideFieldLabel(field: readonly string[]): string {
  return (field.at(-1) ?? "")
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (value) => value.toUpperCase());
}

function AddOverrideFieldMenu({
  disabled,
  fields,
  onAdd,
}: {
  readonly disabled: boolean;
  readonly fields: readonly (readonly string[])[];
  readonly onAdd: (name: string) => void;
}): React.ReactElement {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          disabled={disabled}
          className="inline-flex min-h-9 w-fit items-center gap-2 rounded-lg border border-cyan-300/35 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
        >
          + Add field to override
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[90] max-h-80 min-w-[14rem] overflow-hidden rounded-xl border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-1 text-cyan-50 shadow-[0_20px_70px_rgba(0,0,0,0.62)]"
        >
          {fields.map((field) => {
            const name = field.join(".");
            return (
              <DropdownMenu.Item
                key={name}
                onSelect={() => onAdd(name)}
                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-slate-300 outline-none transition data-[highlighted]:bg-cyan-300/[0.08] data-[highlighted]:text-cyan-50"
              >
                {overrideFieldLabel(field)}
              </DropdownMenu.Item>
            );
          })}
          <DropdownMenu.Arrow className="fill-[var(--rr-surface-menu)]" />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function DashboardFieldLabel({
  label,
  helpText,
}: {
  readonly label: string;
  readonly helpText: string;
}): React.ReactElement {
  return (
    <span className="relative block w-full min-w-0 pr-5">
      <span className="block min-w-0 truncate">{label}</span>
      <DashboardFieldHelp label={label} helpText={helpText} />
    </span>
  );
}

function DashboardFieldHelp({
  label,
  helpText,
}: {
  readonly label: string;
  readonly helpText: string;
}): React.ReactElement {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span
          role="button"
          tabIndex={0}
          aria-label={`${label} help`}
          onClick={(event) => event.stopPropagation()}
          className="absolute right-0 top-0 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border border-slate-600/55 text-[0.55rem] font-bold lowercase leading-none tracking-normal text-slate-500 transition hover:border-slate-400/70 hover:text-slate-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
        >
          i
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[80] max-w-72 rounded-lg border border-cyan-200/20 bg-[var(--rr-surface-menu)] px-3 py-2 text-xs font-medium normal-case leading-5 tracking-normal text-slate-200 shadow-[0_18px_60px_rgba(0,0,0,0.62),0_0_44px_-30px_rgba(103,232,249,0.8)]"
        >
          {helpText}
          <Tooltip.Arrow className="fill-[var(--rr-surface-menu)]" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const reviewLanguageSuggestions = [
  "English",
  "Russian",
  "Ukrainian",
  "Spanish",
  "Portuguese",
  "French",
  "German",
  "Italian",
  "Chinese",
  "Japanese",
  "Korean",
] as const;

function DashboardReviewLanguageField({
  defaultValue,
  disabled,
}: {
  readonly defaultValue: string;
  readonly disabled: boolean;
}): React.ReactElement {
  const [value, setValue] = useState(defaultValue);
  const listId = "review-language-suggestions";
  return (
    <label className="grid min-w-0 gap-2 text-sm text-slate-300">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        <DashboardFieldLabel
          label="Review language"
          helpText={fieldHelp.reviewLanguage}
        />
      </span>
      <input
        name="reviewLanguage"
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="English (default)"
        maxLength={40}
        autoComplete="off"
        spellCheck={false}
        list={listId}
        disabled={disabled}
        className={dashboardInputClassName}
      />
      <datalist id={listId}>
        {reviewLanguageSuggestions.map((language) => (
          <option key={language} value={language} />
        ))}
      </datalist>
    </label>
  );
}

function DashboardNumberField({
  name,
  label,
  helpText,
  value,
  min,
  max,
  disabled,
  onValueChange,
}: {
  readonly name: string;
  readonly label: string;
  readonly helpText: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly disabled: boolean;
  readonly onValueChange: (value: number) => void;
}): React.ReactElement {
  return (
    <label className="grid min-w-0 gap-2 text-sm text-slate-300">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        <DashboardFieldLabel label={label} helpText={helpText} />
      </span>
      <input
        name={name}
        type="number"
        min={min}
        max={max}
        value={Math.min(value, max)}
        disabled={disabled}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (Number.isFinite(parsed)) {
            onValueChange(Math.min(Math.max(parsed, min), max));
          }
        }}
        className={dashboardInputClassName}
      />
    </label>
  );
}

function DashboardSelectField({
  name,
  label,
  helpText,
  value,
  disabled,
  options,
}: {
  readonly name: string;
  readonly label: string;
  readonly helpText: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly options: readonly DashboardSelectOption[];
}): React.ReactElement {
  const [currentValue, setCurrentValue] = useState(value);
  const selectedOption = options.find(
    (option) => option.value === currentValue,
  );

  return (
    <label className="grid min-w-0 gap-2 text-sm text-slate-300">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        <DashboardFieldLabel label={label} helpText={helpText} />
      </span>
      <RadixSelect.Root
        name={name}
        value={currentValue}
        disabled={disabled}
        onValueChange={setCurrentValue}
      >
        <RadixSelect.Trigger
          aria-label={label}
          className={[
            dashboardInputClassName,
            "flex items-center justify-between gap-3 text-left",
          ].join(" ")}
        >
          <RadixSelect.Value>
            <span className="min-w-0 truncate">
              {selectedOption?.label ?? currentValue}
            </span>
          </RadixSelect.Value>
          <RadixSelect.Icon className="grid h-7 w-7 shrink-0 place-items-center text-cyan-100/80">
            <ChevronIcon open={false} />
          </RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={8}
            collisionPadding={12}
            className="z-[90] max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-cyan-200/20 bg-[var(--rr-surface-menu)] p-1 text-cyan-50 shadow-[0_20px_70px_rgba(0,0,0,0.62),0_0_50px_-34px_rgba(103,232,249,0.8)]"
          >
            <RadixSelect.Viewport>
              {options.map((option) => (
                <RadixSelect.Item
                  key={option.value}
                  value={option.value}
                  textValue={option.label}
                  className="group flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-sm text-slate-300 outline-none transition data-[highlighted]:bg-cyan-300/[0.08] data-[highlighted]:text-cyan-50 data-[state=checked]:bg-cyan-300/[0.1]"
                >
                  <RadixSelect.ItemIndicator className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center text-emerald-300">
                    ✓
                  </RadixSelect.ItemIndicator>
                  <RadixSelect.ItemText>
                    <span className="block font-semibold">{option.label}</span>
                    {option.description ? (
                      <span className="mt-0.5 block text-xs leading-5 text-slate-400">
                        {option.description}
                      </span>
                    ) : null}
                  </RadixSelect.ItemText>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </label>
  );
}

function DashboardSwitchField({
  name,
  label,
  helpText,
  checked,
  disabled,
  onCheckedChange,
}: {
  readonly name: string;
  readonly label: string;
  readonly helpText: string;
  readonly checked: boolean;
  readonly disabled: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}): React.ReactElement {
  return (
    <label className="grid min-w-0 gap-2 text-sm text-slate-300">
      <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        <DashboardFieldLabel label={label} helpText={helpText} />
      </span>
      <span className="flex min-h-11 w-full min-w-0 items-center justify-between gap-4 rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition hover:border-cyan-200/30 has-[:focus-visible]:border-cyan-300/55 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-cyan-300/20 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50">
        <span className="min-w-0 truncate">
          {checked ? "Enabled" : "Disabled"}
        </span>
        <span className="relative shrink-0">
          <input
            className="peer sr-only"
            type="checkbox"
            name={name}
            aria-label={label}
            value="true"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onCheckedChange(event.target.checked)}
          />
          <input type="hidden" name={name} value="false" disabled={disabled} />
          <span
            aria-hidden="true"
            className="relative block h-7 w-12 rounded-full border border-cyan-200/20 bg-slate-900 transition after:absolute after:left-1 after:top-1 after:block after:h-5 after:w-5 after:translate-x-0 after:rounded-full after:bg-slate-600 after:shadow-[0_8px_22px_rgba(0,0,0,0.32)] after:transition peer-checked:border-cyan-200/60 peer-checked:bg-cyan-300/20 peer-checked:after:translate-x-5 peer-checked:after:bg-cyan-100"
          />
        </span>
      </span>
    </label>
  );
}

const dashboardInputClassName =
  "min-h-11 w-full rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 py-2 text-cyan-50 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] outline-none transition placeholder:text-slate-500 hover:border-cyan-200/30 focus:border-cyan-300/55 focus:ring-2 focus:ring-cyan-300/20 disabled:cursor-not-allowed disabled:opacity-50";

function ChevronIcon({ open }: { readonly open: boolean }): React.ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      className={[
        "h-4 w-4 shrink-0 text-cyan-100 transition",
        open ? "rotate-180" : "",
      ].join(" ")}
      fill="none"
    >
      <path
        d="m4 6 4 4 4-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
