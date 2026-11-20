"use client";

import { useId, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Badge, Button, SelectField } from "@reviewrouter/ui";
import type { ReviewModelOption } from "@reviewrouter/features-review-providers";
import {
  defaultReviewProviderMode,
  type ReviewProviderMode,
} from "@reviewrouter/features-review-config/review-configuration";
import type { ReviewProviderSelection } from "@reviewrouter/features-review-config/review-policy-document";
import type {
  ProviderRosterSaveRequest,
  ProviderSetupAssignmentResult,
} from "../provider-setup-actions";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import type { GatewayAgentProfileOption } from "../../../src/server/gateway-agent-profile-options";
import { gatewayProviderModelOptions } from "../../../src/features/provider-setup/provider-model-options";
import {
  providerSetupDenialText,
  reviewerNames,
  type ProviderSetupView,
} from "../../../src/features/provider-setup/provider-setup-model";
import { soleReviewerHasDailyLimit } from "../../../src/features/provider-setup/daily-request-limit";
import { useGatewayModelAccounts } from "../gateway-model-account-options";
import { GatewayModelCatalogStatus } from "../gateway-model-catalog-status";
import {
  GatewayAccountListStatus,
  GatewayBindingStatus,
} from "./gateway-account-status";
import { getGatewaySetupAccounts } from "../../../src/server/dashboard-provider-setup-readiness";
import { dashboardErrorText } from "../dashboard-copy";
import { GatewayAccountLoadMore } from "./gateway-account-load-more";
import { GatewayReviewerRowStatus } from "./gateway-reviewer-row-status";
import { DailyLimitNotice } from "./daily-limit-notice";
import {
  defaultProviderSelectionSettings,
  ProviderModelFields,
  providerSelectionSettingsNeedCorrection,
} from "./provider-model-fields";
import { saveProviderRoster } from "./provider-setup-api";
import type { ProviderSetupDialogTarget } from "./provider-setup-dialog";

type Row = {
  id: string;
  profileId?: string | undefined;
  bindingId: string;
  profileRef: string;
  model: string;
  settings: Omit<ReviewProviderSelection, "profileId">;
  savedSettings?: boolean;
  editedSettings?: boolean;
};
type Patch = NonNullable<ProviderRosterSaveRequest["executionPatch"]>;

const providerModeOptions = [
  {
    value: "parallel",
    label: "Together, in parallel",
    hint: "Every reviewer checks each pull request and their findings are combined.",
  },
  {
    value: "fallback",
    label: "Fallback in order",
    // Admission runs this only on a runtime that declares the ordered plan
    // (ai-docs/architecture/67-provider-interaction-mode.md).
    hint: "Reviewers run one at a time, top to bottom. The next one starts only when the one above it can't finish the review because of quota, sign-in, a timeout or an unavailable model.",
  },
] as const satisfies readonly {
  value: ReviewProviderMode;
  label: string;
  hint: string;
}[];

/**
 * The mode of the roster the editor opens with: the workspace default, or a
 * repository's own roster or the workspace roster it inherits. A bulk
 * assignment starts an empty roster with the default mode.
 */
function storedMode(
  view: ProviderSetupView,
  target: ProviderSetupDialogTarget,
): ReviewProviderMode {
  if (target.kind === "repositories") return defaultReviewProviderMode;
  const repository =
    target.kind === "repository"
      ? view.repositories.find((row) => row.id === target.repository.id)
      : null;
  const ownSelections = Boolean(
    repository?.selections?.length || repository?.selection,
  );
  return (
    (ownSelections ? repository?.providerMode : view.providerMode) ??
    defaultReviewProviderMode
  );
}

function workspaceDefaultSelections(
  view: ProviderSetupView,
): readonly ReviewProviderSelection[] {
  return (
    view.defaultSelections ??
    (view.defaultSelection ? [view.defaultSelection] : [])
  );
}

function storedRows(
  view: ProviderSetupView,
  target: ProviderSetupDialogTarget,
  prefix: string,
  initialProfileId?: string,
): Row[] {
  const repository =
    target.kind === "repository"
      ? view.repositories.find((row) => row.id === target.repository.id)
      : null;
  const own =
    repository?.selections ??
    (repository?.selection ? [repository.selection] : []);
  const defaults = workspaceDefaultSelections(view);
  const selections =
    target.kind === "workspace"
      ? defaults
      : target.kind === "repository"
        ? own.length
          ? own
          : defaults
        : [];
  const rows = selections.map((selection, index): Row => {
    const profile = view.profiles.find((row) => row.id === selection.profileId);
    const { profileId, ...settings } = selection;
    return {
      id: `${prefix}-${index}`,
      profileId,
      bindingId: profile?.gatewayBindingId ?? "",
      profileRef: profile?.gatewayProfileRef ?? "",
      model: profile?.model ?? "",
      settings,
      savedSettings: true,
    };
  });
  const initial = initialProfileId
    ? view.profiles.find((row) => row.id === initialProfileId)
    : null;
  if (
    initial?.authMode === "codex_account_gateway" &&
    !rows.some((row) => row.profileId === initial.id)
  )
    rows.push({
      id: `${prefix}-initial`,
      profileId: initial.id,
      bindingId: initial.gatewayBindingId ?? "",
      profileRef: initial.gatewayProfileRef ?? "",
      model: initial.model,
      settings: {
        ...defaultProviderSelectionSettings({
          authMode: initial.authMode,
          model: initial.model,
        }),
        requiredHealthy: true,
      },
    });
  return rows;
}

/** The same complete roster editor serves workspace defaults and repository replacement. */
export function GatewayReviewerRoster({
  workspaceId,
  target,
  view,
  initialProfileId,
  gatewayAccounts,
  modelOptions,
  agentProfileOptions,
  mutationsEnabled,
  readUnavailable,
  onLockedChange,
  onSaved,
  onRefresh,
  onChooseOther,
}: {
  workspaceId: string;
  target: ProviderSetupDialogTarget;
  view: ProviderSetupView;
  initialProfileId?: string | undefined;
  gatewayAccounts: AccountsResult<AccountsPage> | undefined;
  modelOptions: readonly ReviewModelOption[];
  agentProfileOptions: readonly GatewayAgentProfileOption[];
  mutationsEnabled: boolean;
  readUnavailable: boolean;
  onLockedChange: (locked: boolean) => void;
  onSaved: (results: readonly ProviderSetupAssignmentResult[]) => Promise<void>;
  onRefresh: () => Promise<ProviderSetupView | undefined>;
  onChooseOther: () => void;
}): React.ReactElement {
  const prefix = useId();
  const [observed, setObserved] = useState(view);
  const [rows, setRows] = useState(() =>
    storedRows(view, target, prefix, initialProfileId),
  );
  const [mode, setMode] = useState(() => storedMode(view, target));
  const [nextRow, setNextRow] = useState(0);
  const [editing, setEditing] = useState<string | null>(
    () => rows.find((row) => row.profileId === initialProfileId)?.id ?? null,
  );
  const [patch, setPatch] = useState<Patch>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [results, setResults] = useState<
    readonly ProviderSetupAssignmentResult[]
  >([]);
  const options = useGatewayModelAccounts(
    gatewayAccounts,
    rows.map((row) => row.bindingId),
  );
  const accounts = getGatewaySetupAccounts(options.accounts);
  const repository =
    target.kind === "repository"
      ? observed.repositories.find((row) => row.id === target.repository.id)
      : null;
  const defaults = observed.execution ?? {
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  };
  const source = observed.sources.find((row) => row.key === "gateway_binding");
  const blocked = pending || !mutationsEnabled || readUnavailable;
  const settingsFor = (row: Row) => {
    if (row.savedSettings || row.editedSettings) return row.settings;
    const account = accounts.find(
      (candidate) => candidate.binding?.id === row.bindingId,
    );
    const profile = options.profileFor(account);
    return {
      ...defaultProviderSelectionSettings({
        authMode: "codex_account_gateway",
        model: row.model,
        connection: profile?.connection,
        gatewayProfileRef: profile?.id,
      }),
      requiredHealthy: row.settings.requiredHealthy,
    };
  };

  const rowModelOptions = (
    row: Row,
    account: (typeof accounts)[number] | undefined,
    profile: ReturnType<typeof options.profileFor>,
  ) =>
    gatewayProviderModelOptions(modelOptions, profile, {
      catalog: account?.modelCatalog,
      requiresTools: row.settings.agenticContext,
    });

  const identities = rows.map((row) =>
    JSON.stringify([
      row.bindingId,
      row.profileRef,
      row.model,
      settingsFor(row).agentProfileRef ?? null,
    ]),
  );
  const duplicate = new Set(identities).size !== identities.length;
  const ready =
    rows.length > 0 &&
    !duplicate &&
    rows.every((row) => {
      const account = accounts.find(
        (candidate) => candidate.binding?.id === row.bindingId,
      );
      const profile = options.profileFor(account);
      const existing = row.profileId
        ? observed.profiles.find((candidate) => candidate.id === row.profileId)
        : null;
      const decision =
        existing?.decision ??
        (account?.origin === "personal"
          ? source?.personalAccountDecision
          : source?.decision);
      return (
        decision?.allowed === true &&
        account?.state === "active" &&
        account.binding?.state === "active" &&
        !account.binding.fencePending &&
        profile?.id === row.profileRef &&
        profile.models.includes(row.model) &&
        // A new or changed reviewer needs a model the picker offers as usable,
        // as in the setup dialog; a typed name cannot pick a disabled option.
        (row.profileId !== undefined ||
          rowModelOptions(row, account, profile).some(
            (option) => option.value === row.model && !option.disabled,
          )) &&
        (row.savedSettings === true ||
          profile.connection?.modelSettings.some(
            (model) => model.modelId === row.model,
          ) === true) &&
        !providerSelectionSettingsNeedCorrection({
          authMode: "codex_account_gateway",
          model: row.model,
          settings: settingsFor(row),
          connection: profile.connection,
          gatewayProfileRef: profile.id,
        })
      );
    });
  const update = (id: string, change: Partial<Row>) =>
    setRows((current) =>
      current.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );
  const move = (index: number, offset: -1 | 1) =>
    setRows((current) => {
      const next = [...current];
      const [row] = next.splice(index, 1);
      next.splice(index + offset, 0, row!);
      return next;
    });
  const addReviewer = () => {
    const id = `${prefix}-new-${nextRow}`;
    setNextRow((value) => value + 1);
    setRows((current) => [
      ...current,
      {
        id,
        bindingId: "",
        profileRef: "",
        model: "",
        settings: {
          agenticContext: true,
          fastMode: false,
          requiredHealthy: true,
        },
      },
    ]);
    setEditing(id);
  };
  const fallback = mode === "fallback";
  // How several reviewers work together means nothing for one reviewer: its
  // mode stays as saved and the server fits the limits to the count.
  const several = rows.length > 1;
  const inherited = repository?.source === "workspace";
  const ownRoster = repository?.source === "repository";
  const workspaceDefaults = workspaceDefaultSelections(observed);
  const executionValue = (
    field: "providerMaxParallel" | "inlineMinAgreement",
  ): string => {
    if (Object.hasOwn(patch, field))
      return patch[field] === null
        ? "inherit"
        : String(Math.min(patch[field] ?? 1, rows.length || 1));
    return target.kind === "workspace"
      ? String(Math.min(defaults[field], rows.length || 1))
      : repository?.execution?.[field] === undefined
        ? "inherit"
        : String(Math.min(repository.execution[field] ?? 1, rows.length || 1));
  };
  async function save(inherit = false) {
    if (blocked || stale || (!inherit && !ready)) return;
    setPending(true);
    onLockedChange(true);
    setError(null);
    try {
      const result = await saveProviderRoster({
        workspaceId,
        expectedWorkspaceVersion: observed.workspaceVersion ?? null,
        target:
          target.kind === "workspace"
            ? { kind: "workspace" }
            : {
                kind: "repositories",
                repositories: observed.repositories.map((row) => ({
                  repositoryId: row.id,
                  expectedVersion: row.version ?? null,
                })),
              },
        reviewers: inherit
          ? null
          : rows.map((row) => ({
              provider: row.profileId
                ? { kind: "profile", profileId: row.profileId }
                : {
                    kind: "new",
                    credential: {
                      kind: "gateway_binding",
                      bindingId: row.bindingId,
                      gatewayProfileRef: row.profileRef,
                    },
                    model: row.model,
                  },
              settings: settingsFor(row),
            })),
        ...(inherit ? {} : { providerMode: mode }),
        ...(Object.keys(patch).length ? { executionPatch: patch } : {}),
      });
      if (result.status === "error") {
        setStale(result.error === "dashboard_action_stale");
        setError(dashboardErrorText(result.error));
        return;
      }
      const failed = result.results.filter((row) => row.status !== "applied");
      setResults(result.results);
      if (failed.length) {
        setStale(failed.some((row) => row.status === "conflict"));
        setError(
          failed.some((row) => row.status === "conflict")
            ? "These settings changed while this editor was open. Your draft is kept. Reload the saved roster to review the changes."
            : failed
                .map(
                  (row) =>
                    `${row.fullName}: ${row.reason ? providerSetupDenialText(row.reason) : dashboardErrorText(row.error ?? "dashboard_action_failed")}`,
                )
                .join(" "),
        );
        return;
      }
      await onSaved(result.results);
    } catch {
      setError(dashboardErrorText("dashboard_action_failed"));
    } finally {
      setPending(false);
      onLockedChange(false);
    }
  }
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-cyan-50">Reviewers</h3>
          <p className="text-xs leading-5 text-slate-400">
            Each reviewer keeps its own model and settings. The first reviewer
            is the primary: it also updates the pull request description (when
            enabled) and re-checks whether earlier findings were fixed.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked || rows.length >= 16}
          onClick={addReviewer}
        >
          Add reviewer
        </Button>
      </div>
      {several ? (
        <SelectField
          label="How reviewers work together"
          value={mode}
          disabled={blocked}
          options={providerModeOptions.map(({ value, label }) => ({
            value,
            label,
          }))}
          hint={
            providerModeOptions.find((option) => option.value === mode)!.hint
          }
          onValueChange={(value) => setMode(value as ReviewProviderMode)}
        />
      ) : null}
      {inherited ? (
        <p className="text-sm leading-6 text-slate-300">
          This repository uses the workspace default reviewers below. Saving
          gives it its own copy; later changes to the workspace default
          won&apos;t apply here until you choose Use workspace reviewers.
        </p>
      ) : null}
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">
          Add a reviewer and choose a connected account and model.
        </p>
      ) : (
        <ol className="divide-y divide-cyan-200/10 border-y border-cyan-200/10">
          {rows.map((row, index) => {
            const account = accounts.find(
              (candidate) => candidate.binding?.id === row.bindingId,
            );
            const profile = options.profileFor(account);
            const existing = observed.profiles.find(
              (candidate) => candidate.id === row.profileId,
            );
            const expanded = editing === row.id;
            const denied =
              existing?.decision.allowed === false
                ? existing.decision.reason
                : null;
            return (
              <li
                key={row.id}
                // The reviewer being edited carries the accent edge of the
                // active dashboard section, so its fields read as its own. An
                // inset edge leaves the list's dividers untouched; other rows
                // stay aligned with the Reviewers heading.
                className={
                  expanded
                    ? "bg-cyan-300/[0.05] px-3 py-4 shadow-[inset_2px_0_0_var(--color-cyan-200)]"
                    : "py-4"
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="break-words font-medium text-cyan-50">
                      {index + 1}. {row.model || "Choose a model"}{" "}
                      {index === 0 ? (
                        <Badge tone="neutral">Primary</Badge>
                      ) : fallback ? (
                        <Badge tone="neutral">Fallback</Badge>
                      ) : null}{" "}
                    </p>
                    <p className="break-words text-xs leading-5 text-slate-400">
                      {account?.label ?? existing?.label ?? "Choose an account"}
                    </p>
                    <GatewayReviewerRowStatus
                      bindingId={row.bindingId}
                      model={row.model}
                      account={account}
                      profile={profile}
                      accounts={options}
                      settings={settingsFor(row)}
                      showDailyLimit={several}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    {several ? (
                      <>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="px-3"
                          disabled={blocked || index === 0}
                          aria-label={`Move reviewer ${index + 1} up`}
                          title="Move up"
                          onClick={() => move(index, -1)}
                        >
                          <ArrowUp aria-hidden className="size-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="px-3"
                          disabled={blocked || index === rows.length - 1}
                          aria-label={`Move reviewer ${index + 1} down`}
                          title="Move down"
                          onClick={() => move(index, 1)}
                        >
                          <ArrowDown aria-hidden className="size-4" />
                        </Button>
                      </>
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={blocked}
                      aria-expanded={expanded}
                      aria-controls={`${row.id}-settings`}
                      onClick={() => setEditing(expanded ? null : row.id)}
                    >
                      {expanded ? "Done" : "Edit"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={blocked || rows.length === 1}
                      title={
                        rows.length === 1
                          ? "Keep at least one reviewer"
                          : undefined
                      }
                      onClick={() => {
                        setRows((current) =>
                          current.filter(
                            (candidate) => candidate.id !== row.id,
                          ),
                        );
                        setEditing(null);
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                {expanded ? (
                  <div id={`${row.id}-settings`} className="mt-4 grid gap-4">
                    <SelectField
                      label={`Account for reviewer ${index + 1}`}
                      value={row.bindingId}
                      placeholder="Choose an account"
                      hint={
                        accounts.length === 0 && !options.loading
                          ? "Connect and activate an account in Accounts first."
                          : undefined
                      }
                      disabled={blocked}
                      options={accounts.map((candidate) => ({
                        value: candidate.binding!.id,
                        label: candidate.label,
                        description: candidate.profileLabel,
                        disabled:
                          candidate.origin === "personal"
                            ? source?.personalAccountDecision?.allowed === false
                            : source?.decision.allowed === false,
                      }))}
                      onValueChange={(bindingId) => {
                        const selected = accounts.find(
                          (candidate) => candidate.binding?.id === bindingId,
                        );
                        const next = options.profileFor(selected);
                        update(row.id, {
                          profileId: undefined,
                          savedSettings: false,
                          editedSettings: false,
                          bindingId,
                          profileRef: selected?.profileId ?? "",
                          model: "",
                          settings: {
                            ...defaultProviderSelectionSettings({
                              authMode: "codex_account_gateway",
                              model: "",
                              connection: next?.connection,
                              gatewayProfileRef: next?.id,
                            }),
                            requiredHealthy: row.settings.requiredHealthy,
                          },
                        });
                      }}
                    />
                    <h4 className="text-sm font-semibold text-cyan-50">
                      Model and review settings
                    </h4>
                    <ProviderModelFields
                      authMode="codex_account_gateway"
                      model={row.model}
                      onModelChange={(model) =>
                        update(row.id, {
                          profileId: undefined,
                          savedSettings: false,
                          editedSettings: false,
                          model,
                          settings: {
                            ...defaultProviderSelectionSettings({
                              authMode: "codex_account_gateway",
                              model,
                              connection: profile?.connection,
                              gatewayProfileRef: profile?.id,
                            }),
                            ...(row.settings.agentProfileRef
                              ? {
                                  agentProfileRef: row.settings.agentProfileRef,
                                }
                              : {}),
                            requiredHealthy: row.settings.requiredHealthy,
                          },
                        })
                      }
                      modelOptions={rowModelOptions(row, account, profile)}
                      modelChoice="catalog"
                      allowCustomModel={false}
                      modelStatus={
                        <GatewayModelCatalogStatus
                          account={account}
                          profile={profile}
                          accounts={options}
                          bindingId={row.bindingId}
                        />
                      }
                      settings={settingsFor(row)}
                      onSettingsChange={(settings) =>
                        update(row.id, {
                          editedSettings: true,
                          settings: {
                            ...settings,
                            requiredHealthy: row.settings.requiredHealthy,
                          },
                        })
                      }
                      connection={profile?.connection}
                      gatewayProfileRef={profile?.id}
                      agentProfileOptions={agentProfileOptions}
                      disabled={blocked}
                      settingsReady={
                        row.savedSettings === true ||
                        profile?.connection?.modelSettings.some(
                          (model) => model.modelId === row.model,
                        ) === true
                      }
                      hasSavedSettings={row.savedSettings === true}
                      hasEditedSettings
                    />
                    {denied ? (
                      <p className="text-xs text-amber-100">
                        {providerSetupDenialText(denied)}
                      </p>
                    ) : null}
                    {row.bindingId && !account ? (
                      <GatewayBindingStatus
                        accounts={options}
                        bindingId={row.bindingId}
                        busy={blocked}
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {soleReviewerHasDailyLimit(
        rows.map((row) => ({
          provider: options.profileFor(
            accounts.find(
              (candidate) => candidate.binding?.id === row.bindingId,
            ),
          )?.connection?.provider,
          model: row.model,
        })),
      ) ? (
        <DailyLimitNotice onAddReviewer={addReviewer} disabled={blocked} />
      ) : null}
      <div className="flex flex-wrap gap-3">
        <GatewayAccountLoadMore
          canLoadMore={options.canLoadMore}
          loading={options.loading}
          onLoadMore={options.loadMore}
        />
        <GatewayAccountListStatus accounts={options} busy={blocked} />
      </div>
      {fallback || !several ? null : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(["providerMaxParallel", "inlineMinAgreement"] as const).map(
            (field) => (
              <SelectField
                key={field}
                label={
                  field === "providerMaxParallel"
                    ? "Max parallel providers"
                    : "Inline agreement"
                }
                value={executionValue(field)}
                disabled={blocked}
                options={[
                  ...(target.kind === "workspace"
                    ? []
                    : [
                        {
                          value: "inherit",
                          label: `Workspace default (${Math.min(defaults[field], rows.length || 1)})`,
                        },
                      ]),
                  ...Array.from(
                    {
                      length: Math.max(
                        rows.length,
                        Number(executionValue(field)) || 1,
                      ),
                    },
                    (_, index) => ({
                      value: String(index + 1),
                      label: String(index + 1),
                    }),
                  ),
                ]}
                onValueChange={(value) =>
                  setPatch((current) => ({
                    ...current,
                    [field]: value === "inherit" ? null : Number(value),
                  }))
                }
              />
            ),
          )}
        </div>
      )}
      {duplicate ? (
        <p role="status" className="text-sm text-amber-100">
          Choose a different account, model, or review engine for each reviewer.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {error}
        </p>
      ) : null}
      {stale ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit"
          disabled={blocked}
          onClick={async () => {
            const latest = await onRefresh();
            if (!latest) return;
            setObserved(latest);
            setRows(storedRows(latest, target, prefix));
            setMode(storedMode(latest, target));
            setPatch({});
            setStale(false);
            setError(null);
            setResults([]);
          }}
        >
          Reload saved roster
        </Button>
      ) : null}
      {results.some((row) => row.status === "applied") && error ? (
        <p role="status" className="text-xs text-slate-300">
          Saved for{" "}
          {results
            .filter((row) => row.status === "applied")
            .map((row) => row.fullName)
            .join(", ")}
          .
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cyan-200/10 pt-4">
        {/* Grows beside Save, so its full-width caption keeps Save on the right. */}
        <div className="flex flex-wrap gap-2 sm:min-w-0 sm:flex-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="max-w-full whitespace-normal"
            disabled={blocked}
            onClick={onChooseOther}
          >
            Choose another provider
          </Button>
          {ownRoster ? (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  blocked || stale || repository?.useDefault.allowed === false
                }
                aria-describedby={`${prefix}-workspace-default`}
                onClick={() => void save(true)}
              >
                Use workspace reviewers
              </Button>
              <p
                id={`${prefix}-workspace-default`}
                className="w-full break-words text-xs leading-5 text-slate-400"
              >
                {workspaceDefaults.length
                  ? `Workspace default: ${reviewerNames(
                      workspaceDefaults.map((selection) => {
                        const profile = observed.profiles.find(
                          (candidate) => candidate.id === selection.profileId,
                        );
                        return profile
                          ? { label: profile.label, model: profile.model }
                          : null;
                      }),
                    )}.`
                  : "Choosing Use workspace reviewers stops reviews here: the workspace has no default reviewers."}
              </p>
            </>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={blocked || !ready || stale}
          aria-busy={pending}
          onClick={() => void save()}
        >
          {pending
            ? "Saving…"
            : inherited
              ? "Save for this repository"
              : "Save reviewers"}
        </Button>
      </div>
    </div>
  );
}
