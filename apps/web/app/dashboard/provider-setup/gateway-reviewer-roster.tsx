"use client";

import { useId, useState } from "react";
import { Badge, Button, SelectField } from "@reviewrouter/ui";
import type { ReviewModelOption } from "@reviewrouter/features-review-providers";
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
  type ProviderSetupView,
} from "../../../src/features/provider-setup/provider-setup-model";
import { useGatewayModelAccounts } from "../gateway-model-account-options";
import { GatewayModelCatalogStatus } from "../gateway-model-catalog-status";
import { getGatewaySetupAccounts } from "../../../src/server/dashboard-provider-setup-readiness";
import { dashboardErrorText } from "../dashboard-copy";
import { GatewayAccountLoadMore } from "./gateway-account-load-more";
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
  const defaults =
    view.defaultSelections ??
    (view.defaultSelection ? [view.defaultSelection] : []);
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
            Each reviewer keeps its own model and settings. The first handles
            pull request description updates when enabled.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={blocked || rows.length >= 16}
          onClick={() => {
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
          }}
        >
          Add reviewer
        </Button>
      </div>
      {repository?.source === "workspace" ? (
        <p className="text-sm text-slate-300">
          Using all workspace reviewers. Saving creates a complete repository
          roster.
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
              <li key={row.id} className="py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="break-words font-medium text-cyan-50">
                      {index + 1}. {row.model || "Choose a model"}{" "}
                      {index === 0 ? (
                        <Badge tone="neutral">Primary</Badge>
                      ) : null}{" "}
                    </p>
                    <p className="break-words text-xs leading-5 text-slate-400">
                      {account?.label ?? existing?.label ?? "Choose an account"}
                    </p>
                    {row.bindingId && !account && !options.loading ? (
                      <p className="text-xs leading-5 text-amber-100">
                        This account is unavailable. Edit this reviewer or
                        refresh accounts.
                      </p>
                    ) : profile &&
                      row.model &&
                      !profile.models.includes(row.model) ? (
                      <p className="text-xs leading-5 text-amber-100">
                        {account?.modelCatalog?.status === "snapshot"
                          ? "This model is unavailable for this account. Edit this reviewer to choose another model."
                          : account?.modelCatalog?.status === "unknown" ||
                              account?.modelCatalog?.status === "unavailable"
                            ? "Model availability could not be checked. Edit this reviewer to refresh account models. Your saved selection is unchanged."
                            : "This model is not in the configured choices for this account. Edit this reviewer to check its connection."}
                      </p>
                    ) : profile &&
                      providerSelectionSettingsNeedCorrection({
                        authMode: "codex_account_gateway",
                        model: row.model,
                        settings: settingsFor(row),
                        connection: profile.connection,
                        gatewayProfileRef: profile.id,
                      }) ? (
                      <p className="text-xs leading-5 text-amber-100">
                        Review settings need updating for this model.
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
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
                      modelOptions={gatewayProviderModelOptions(
                        modelOptions,
                        profile,
                        {
                          catalog: account?.modelCatalog,
                          requiresTools: row.settings.agenticContext,
                        },
                      )}
                      modelChoice="list"
                      allowCustomModel={false}
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
                    {account ? (
                      <GatewayModelCatalogStatus
                        account={account}
                        loading={options.loading}
                        canRefresh={options.canRefresh}
                        onRefresh={() => options.refreshModels(row.bindingId)}
                      />
                    ) : null}
                    {denied ? (
                      <p className="text-xs text-amber-100">
                        {providerSetupDenialText(denied)}
                      </p>
                    ) : null}
                    {row.bindingId && !account ? (
                      <p role="status" className="text-xs text-amber-100">
                        This account is unavailable. Refresh accounts or choose
                        another account.
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <div className="flex flex-wrap gap-3">
        <GatewayAccountLoadMore
          canLoadMore={options.canLoadMore}
          loading={options.loading}
          onLoadMore={options.loadMore}
        />
        {options.canRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={blocked || options.loading}
            onClick={options.refresh}
          >
            Refresh accounts
          </Button>
        ) : null}
      </div>
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
        <div className="flex flex-wrap gap-2">
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
          {target.kind === "repository" &&
          repository?.source === "repository" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                blocked || stale || repository.useDefault.allowed === false
              }
              onClick={() => void save(true)}
            >
              Use workspace reviewers
            </Button>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          disabled={blocked || !ready || stale}
          aria-busy={pending}
          onClick={() => void save()}
        >
          {pending ? "Saving…" : "Save reviewers"}
        </Button>
      </div>
    </div>
  );
}
