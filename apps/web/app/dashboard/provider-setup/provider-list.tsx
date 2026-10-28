"use client";

import { useState, type ReactNode } from "react";
import {
  providerKindForAuthMode,
  type ReviewModelOption,
} from "@reviewrouter/features-review-providers";
import {
  Badge,
  Button,
  DialogBackdrop,
  DialogCloseButton,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogRoot,
  DialogTitle,
  DialogTrigger,
  TextField,
} from "@reviewrouter/ui";
import {
  managedKeyAuthModeOf,
  providerCreatorText,
  providerListDenialText,
  providerListWideReasons,
  providerUsageText,
  type ProviderListDecision,
  type ProviderListDenialReason,
  type ProviderListRow,
  type ProviderListUsage,
  type ProviderListView,
} from "../../../src/features/provider-setup/provider-list-model";
import { sourceTitle } from "../../../src/features/provider-setup/provider-setup-model";
import {
  apiKeySetupHref,
  apiKeyStorageLabel,
} from "../../../src/features/provider-setup/api-key-storage";
import {
  getSetupProvider,
  setupProviderForDirectAuthMode,
  setupProviderForGatewayProfile,
} from "../../../src/features/provider-setup/setup-provider";
import { gatewayProviderModelOptions } from "../../../src/features/provider-setup/provider-model-options";
import type {
  AccountsPage,
  AccountsResult,
} from "../../../src/server/account-gateway-accounts";
import { getReadyGatewayAccounts } from "../../../src/server/dashboard-provider-setup-readiness";
import type { GatewayAgentProfileOption } from "../../../src/server/gateway-agent-profile-options";
import { dashboardErrorText } from "../dashboard-copy";
import { useGatewayModelAccounts } from "../gateway-model-account-options";
import { GatewayModelCatalogStatus } from "../gateway-model-catalog-status";
import { ProviderAuthLogoFrame } from "../provider-auth-logo";
import {
  ProviderModelCatalogStatus,
  useProviderModelCatalogs,
} from "../provider-model-catalog";
import type { ProviderProfileActionResult } from "../provider-setup-actions";
import { ManagedKeyRotationDialog } from "./managed-key-rotation-dialog";
import { ProviderModelPicker } from "./provider-model-fields";
import {
  archiveProviderProfile,
  clearWorkspaceDefaultProvider,
  updateProviderProfile,
  useProviderSetupCompletion,
} from "./provider-setup-api";
import { ProviderSetupDialog } from "./provider-setup-dialog";

export type ProviderListProps = Readonly<{
  view: ProviderListView;
  mutationsEnabled: boolean;
  modelOptions: readonly ReviewModelOption[];
  gatewayAccounts: AccountsResult<AccountsPage> | undefined;
  agentProfileOptions: readonly GatewayAgentProfileOption[];
  /** Where Access rights are changed. */
  accessRightsHref: string;
}>;

const changesOff: ProviderListDecision = {
  allowed: false,
  reason: "workspace_admin_required",
};

/**
 * Reasons stated once above the list instead of on every row; an action
 * refused for one of them is left out of its row rather than shown disabled
 * again and again.
 */
const listExplainedReasons: ReadonlySet<ProviderListDenialReason> = new Set([
  ...providerListWideReasons,
  "profile_creator_required",
]);

/** Whether a row shows the action: allowed, or refused for its own reason. */
function shown(
  decision: ProviderListDecision | null,
): decision is ProviderListDecision {
  return (
    decision !== null &&
    (decision.allowed || !listExplainedReasons.has(decision.reason))
  );
}

/**
 * The workspace's providers: one row per credential and model, the default
 * first, with what uses each and who added it. Every action is decided on the
 * server by the provider management policy; one the viewer cannot take stays
 * visible, disabled, with its reason.
 */
export function ProviderList(props: ProviderListProps): React.ReactElement {
  const { view, mutationsEnabled } = props;
  const dialog = {
    workspaceId: view.workspaceId,
    mutationsEnabled,
    modelOptions: props.modelOptions,
    gatewayAccounts: props.gatewayAccounts,
    agentProfileOptions: props.agentProfileOptions,
  } as const;
  const add = mutationsEnabled ? view.add : changesOff;
  const wideReasons = new Set(
    view.rows.flatMap((row) =>
      rowDecisions(row).flatMap((decision) =>
        decision.allowed ? [] : [decision.reason],
      ),
    ),
  );
  return (
    <section className="grid gap-4" aria-label="Workspace providers">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-cyan-200/10 pb-4">
        <div className="grid min-w-0 gap-1">
          <p className="text-sm font-semibold text-cyan-50">
            {view.rows.length === 0
              ? "No providers yet"
              : `${view.rows.length} ${view.rows.length === 1 ? "provider" : "providers"}`}
          </p>
          <p className="max-w-2xl text-sm leading-6 text-slate-400">
            Repositories without a provider of their own inherit the default.
            Choose a provider and finish its connection and workflow setup from
            each repository's row in Repositories.
          </p>
          {view.rows.length > 0 && !view.hasDefault ? (
            <p className="text-xs leading-5 text-amber-100/85">
              No default provider: repositories without a provider of their own
              do not review until one is made the default.
            </p>
          ) : null}
          {!mutationsEnabled ? (
            <p className="text-xs leading-5 text-amber-100/85">
              Changes are turned off for this dashboard.
            </p>
          ) : view.accessRightsAdminOnly && !view.viewerIsAdmin ? (
            <p className="text-xs leading-5 text-amber-100/85">
              {providerListDenialText("access_rights_admin_only")}{" "}
              <a className="underline" href={props.accessRightsHref}>
                Access rights
              </a>
            </p>
          ) : view.accessRightsAdminOnly ? (
            <p className="text-xs leading-5 text-slate-400">
              <a className="underline" href={props.accessRightsHref}>
                Access rights
              </a>{" "}
              are on: other members cannot change providers.
            </p>
          ) : wideReasons.has("workspace_admin_required") ? (
            <p className="text-xs leading-5 text-slate-400">
              Only workspace owners and admins set the default and replace saved
              keys.
            </p>
          ) : null}
          {mutationsEnabled &&
          !(view.accessRightsAdminOnly && !view.viewerIsAdmin) &&
          wideReasons.has("profile_creator_required") ? (
            <p className="text-xs leading-5 text-slate-400">
              You can edit or remove the providers you added.
            </p>
          ) : null}
        </div>
        <div className="grid justify-items-start gap-1 sm:justify-items-end">
          <ProviderSetupDialog
            {...dialog}
            target={{ kind: "workspace" }}
            mode="add"
            triggerLabel="Add provider"
            triggerVariant={view.rows.length === 0 ? "solid" : "outline"}
            triggerSize="sm"
            triggerClassName="rounded-xl"
            triggerDisabled={!add.allowed}
          />
          {!add.allowed &&
          mutationsEnabled &&
          !providerListWideReasons.has(add.reason) ? (
            <p className="max-w-xs text-xs leading-5 text-slate-400 sm:text-right">
              {providerListDenialText(add.reason)}
            </p>
          ) : null}
        </div>
      </div>

      {view.rows.length === 0 ? (
        <p className="text-sm leading-6 text-slate-300">
          Add a provider, then finish setup for the repositories that will use
          it.
        </p>
      ) : (
        <ul className="grid divide-y divide-cyan-200/10">
          {view.rows.map((row) => (
            <ProviderListItem
              key={row.id}
              row={row}
              dialog={dialog}
              mutationsEnabled={mutationsEnabled}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

type DialogContext = Readonly<{
  workspaceId: string;
  mutationsEnabled: boolean;
  modelOptions: readonly ReviewModelOption[];
  gatewayAccounts: AccountsResult<AccountsPage> | undefined;
  agentProfileOptions: readonly GatewayAgentProfileOption[];
}>;

function ProviderListItem({
  row,
  dialog,
  mutationsEnabled,
}: {
  readonly row: ProviderListRow;
  readonly dialog: DialogContext;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  const actions = mutationsEnabled
    ? row.actions
    : {
        edit: changesOff,
        makeDefault: row.actions.makeDefault && changesOff,
        removeDefault: row.actions.removeDefault && changesOff,
        remove: changesOff,
        replaceKey: row.actions.replaceKey && changesOff,
      };
  // Reasons the list states once are not repeated on the row.
  const reasons = mutationsEnabled
    ? [
        ...new Set(
          rowDecisions(row).flatMap((decision) =>
            !decision.allowed && !listExplainedReasons.has(decision.reason)
              ? [providerListDenialText(decision.reason)]
              : [],
          ),
        ),
      ]
    : [];
  const managedAuthMode = managedKeyAuthModeOf(row);

  return (
    <li className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-6">
      <div className="flex min-w-0 items-start gap-3">
        <ProviderAuthLogoFrame
          authMode={row.authMode}
          providerId={row.providerId}
        />
        <div className="grid min-w-0 gap-1">
          <p className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words text-sm font-semibold text-cyan-50">
              {row.label}
            </span>
            {row.isDefault ? (
              <Badge tone="accent" size="xs">
                Default
              </Badge>
            ) : null}
            {row.account && !row.account.available ? (
              <Badge tone="warning" size="xs">
                Account unavailable
              </Badge>
            ) : null}
          </p>
          <p className="min-w-0 break-words text-xs leading-5 text-slate-300">
            {providerSourceText(row)} ·{" "}
            <span className="inline-block max-w-full align-bottom font-mono text-cyan-100 [overflow-wrap:anywhere]">
              {row.model}
            </span>
          </p>
          <p className="min-w-0 break-words text-xs leading-5 text-slate-400">
            <UsageText usage={row.usage} /> · {providerCreatorText(row.creator)}
          </p>
        </div>
      </div>
      <div className="grid gap-2 lg:justify-items-end">
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {shown(actions.edit) ? (
            <ProviderProfileEditDialog
              row={row}
              dialog={dialog}
              decision={actions.edit}
            />
          ) : null}
          {shown(actions.makeDefault) ? (
            <ProviderSetupDialog
              {...dialog}
              target={{ kind: "workspace" }}
              initialProfileId={row.id}
              triggerLabel="Make default"
              triggerVariant="outline"
              triggerSize="sm"
              triggerClassName="min-h-9 rounded-lg px-3"
              triggerDisabled={!actions.makeDefault.allowed}
            />
          ) : null}
          {shown(actions.removeDefault) ? (
            <ConfirmActionDialog
              triggerLabel="Remove as default"
              decision={actions.removeDefault}
              title={`Stop using ${row.label} as the default?`}
              body="Repositories without a provider of their own stop reviewing until you choose a new default. The provider stays in this list."
              confirmLabel="Remove as default"
              workspaceId={dialog.workspaceId}
              run={() =>
                clearWorkspaceDefaultProvider({
                  workspaceId: dialog.workspaceId,
                })
              }
            />
          ) : null}
          {managedAuthMode && shown(actions.replaceKey) ? (
            <ManagedKeyRotationDialog
              workspaceId={dialog.workspaceId}
              authMode={managedAuthMode}
              decision={actions.replaceKey}
            />
          ) : null}
          {shown(actions.remove) ? (
            <ConfirmActionDialog
              triggerLabel="Remove"
              tone="danger"
              decision={actions.remove}
              title={`Remove ${row.label}?`}
              body={`It leaves this workspace's providers, so repositories can no longer choose it. ${credentialKeptText(row)}`}
              confirmLabel="Remove provider"
              workspaceId={dialog.workspaceId}
              run={() =>
                archiveProviderProfile({
                  workspaceId: dialog.workspaceId,
                  profileId: row.id,
                })
              }
            />
          ) : null}
        </div>
        {reasons.length > 0 ? (
          <ul className="grid gap-0.5 text-xs leading-5 text-slate-400 lg:max-w-sm lg:text-right">
            {reasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

/** What happens to a removed provider's credential: nothing. */
function credentialKeptText(row: ProviderListRow): string {
  switch (row.credentialKind) {
    case "gateway_binding":
      return "The account stays in Accounts.";
    case "managed_api_key":
      return "The saved key stays for any other provider that uses it.";
    case "user_ci_secret":
      return "GitHub secrets in repositories stay as they are.";
    case "repository_rotating":
      return "The Codex connection of the repository stays as it is.";
    case "hosted_pool":
      return "The hosted Codex pool stays in Accounts.";
  }
}

function rowDecisions(row: ProviderListRow): readonly ProviderListDecision[] {
  const { edit, makeDefault, removeDefault, replaceKey, remove } = row.actions;
  return [edit, makeDefault, removeDefault, replaceKey, remove].filter(
    (decision): decision is ProviderListDecision => decision !== null,
  );
}

function UsageText({
  usage,
}: {
  readonly usage: ProviderListUsage;
}): React.ReactElement {
  const names = usage.repositories.map((repository) => repository.fullName);
  const shown = names.slice(0, 3);
  return (
    <>
      {providerUsageText(usage)}
      {shown.length > 0 ? (
        <>
          {": "}
          <span className="text-slate-300">{shown.join(", ")}</span>
          {names.length > shown.length
            ? ` and ${names.length - shown.length} more`
            : ""}
        </>
      ) : null}
    </>
  );
}

/** Where the credential comes from, naming the account or repository. */
export function providerSourceText(
  row: Pick<
    ProviderListRow,
    "credentialKind" | "authMode" | "account" | "rotatingRepositoryName"
  >,
): string {
  if (row.account)
    return row.account.personal
      ? "Personal account shared with this workspace"
      : row.account.name
        ? `Connected account: ${row.account.name}`
        : sourceTitle(row.credentialKind, row.authMode);
  if (
    row.credentialKind === "repository_rotating" &&
    row.rotatingRepositoryName
  )
    return `Codex subscription for ${row.rotatingRepositoryName}`;
  return sourceTitle(row.credentialKind, row.authMode);
}

function ProviderProfileEditDialog({
  row,
  dialog,
  decision,
}: {
  readonly row: ProviderListRow;
  readonly dialog: DialogContext;
  readonly decision: ProviderListDecision;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9 rounded-lg px-3"
            disabled={!decision.allowed}
          />
        }
      >
        Edit
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="w-[min(96vw,36rem)] p-0">
          <DialogCloseButton label="Close provider edit" disabled={pending} />
          {open ? (
            <ProviderProfileEditForm
              row={row}
              dialog={dialog}
              onPendingChange={setPending}
              onDone={() => setOpen(false)}
            />
          ) : null}
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

function ProviderProfileEditForm({
  row,
  dialog,
  onPendingChange,
  onDone,
}: {
  readonly row: ProviderListRow;
  readonly dialog: DialogContext;
  readonly onPendingChange: (pending: boolean) => void;
  readonly onDone: () => void;
}): React.ReactElement {
  const [label, setLabel] = useState(row.label);
  const [model, setModel] = useState(row.model);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completion = useProviderSetupCompletion(dialog.workspaceId);
  const gateway = row.credentialKind === "gateway_binding";
  const gatewayOptions = useGatewayModelAccounts(
    dialog.gatewayAccounts,
    gateway && row.gatewayBindingId ? [row.gatewayBindingId] : [],
  );
  const catalogs = useProviderModelCatalogs(dialog.modelOptions);
  const gatewayAccount = getReadyGatewayAccounts(gatewayOptions.accounts).find(
    (account) => account.binding?.id === row.gatewayBindingId,
  );
  const gatewayProfile =
    gatewayOptions.profileFor(gatewayAccount) ??
    (gatewayOptions.accounts?.status === "ok"
      ? gatewayOptions.accounts.value.profiles.find(
          (profile) => profile.id === row.gatewayProfileRef,
        )
      : undefined);
  const replacementProvider = gateway
    ? setupProviderForGatewayProfile(gatewayProfile)
    : setupProviderForDirectAuthMode(row.authMode);
  const storageLabel = replacementProvider
    ? apiKeyStorageLabel(row.credentialKind)
    : null;
  const catalogProvider = replacementProvider
    ? getSetupProvider(replacementProvider).publicCatalogProvider
    : providerKindForAuthMode(row.authMode);
  const publicModelOptions = catalogProvider
    ? catalogs.optionsFor(catalogProvider, true)
    : [];
  const modelOptions: readonly ReviewModelOption[] = gateway
    ? gatewayProviderModelOptions(publicModelOptions, gatewayProfile)
    : publicModelOptions;
  const trimmedLabel = label.trim();
  const trimmedModel = model.trim();
  const changes = {
    ...(trimmedLabel !== row.label ? { label: trimmedLabel } : {}),
    ...(trimmedModel !== row.model ? { model: trimmedModel } : {}),
  };
  const canSave =
    !pending &&
    trimmedLabel.length > 0 &&
    trimmedModel.length > 0 &&
    Object.keys(changes).length > 0 &&
    (trimmedModel === row.model ||
      modelOptions.find((option) => option.value === trimmedModel)?.disabled !==
        true) &&
    (!gateway ||
      trimmedModel === row.model ||
      (gatewayProfile?.models.includes(trimmedModel) === true &&
        modelOptions.some(
          (option) => option.value === trimmedModel && !option.disabled,
        )));

  async function save(): Promise<void> {
    if (!canSave) return;
    setPending(true);
    onPendingChange(true);
    setError(null);
    try {
      const result = await updateProviderProfile({
        workspaceId: dialog.workspaceId,
        profileId: row.id,
        ...changes,
      });
      if (result.status === "error") {
        setError(profileActionErrorText(result));
        return;
      }
      await completion.complete();
      onDone();
    } catch {
      setError(dashboardErrorText("dashboard_action_failed"));
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }

  return (
    <div className="grid gap-5 px-5 py-5 sm:px-6">
      <div>
        <DialogTitle className="pr-10 text-xl text-cyan-50">
          Edit {row.label}
        </DialogTitle>
        <DialogDescription className="text-sm leading-6 text-slate-300">
          {editImpactText(row.usage)}
        </DialogDescription>
      </div>
      <TextField
        label="Name"
        value={label}
        maxLength={80}
        disabled={pending}
        onChange={(event) => setLabel(event.target.value)}
      />
      <ProviderModelPicker
        model={model}
        onModelChange={setModel}
        modelOptions={modelOptions}
        modelChoice="catalog"
        allowCustomModel={!gateway}
        emptyListPlaceholder="The account lists no models right now"
        disabled={pending}
      />
      {gateway ? (
        <GatewayModelCatalogStatus
          account={gatewayAccount}
          loading={gatewayOptions.loading}
          canRefresh={gatewayOptions.canRefresh}
          onRefresh={() =>
            gatewayOptions.refreshModels(row.gatewayBindingId ?? "")
          }
        />
      ) : null}
      {catalogProvider ? (
        <ProviderModelCatalogStatus
          status={catalogs.status(catalogProvider)}
          publicSelection={!gateway}
        />
      ) : null}
      <div className="grid gap-1 border-t border-cyan-200/10 pt-4">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Credential
        </span>
        <span className="text-sm text-cyan-50">{providerSourceText(row)}</span>
        {storageLabel ? (
          <span className="text-sm text-slate-300">
            {replacementProvider &&
            getSetupProvider(replacementProvider).credentialKind ===
              "subscription"
              ? "Credential storage"
              : "Key storage"}
            : {storageLabel}
          </span>
        ) : null}
        <span className="text-xs leading-5 text-slate-400">
          The credential cannot change. To use a different one, add a new
          provider.
        </span>
        {replacementProvider ? (
          <a
            className="mt-1 w-fit text-sm text-cyan-200 underline"
            href={apiKeySetupHref("providers", {
              provider: replacementProvider,
              storage:
                row.credentialKind === "gateway_binding"
                  ? "github_secrets"
                  : "reviewrouter",
              workspaceId: dialog.workspaceId,
              repositoryIds: [],
            })}
          >
            Add with different storage
          </a>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm leading-6 text-red-100">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-3 border-t border-cyan-200/10 pt-4">
        <Button
          type="button"
          size="sm"
          disabled={!canSave}
          aria-busy={pending}
          onClick={() => void save()}
        >
          {pending ? "Saving..." : "Save changes"}
        </Button>
      </div>
    </div>
  );
}

function editImpactText(usage: ProviderListUsage): string {
  const count = usage.repositories.length;
  const repositories = `${count} ${count === 1 ? "repository" : "repositories"} that chose it`;
  if (usage.workspaceDefault && count > 0)
    return `A model change applies at once to the workspace default and ${repositories}.`;
  if (usage.workspaceDefault)
    return "A model change applies at once to the workspace default and every repository that follows it.";
  if (count > 0) return `A model change applies at once to ${repositories}.`;
  return "Nothing uses this provider yet.";
}

function ConfirmActionDialog({
  triggerLabel,
  tone,
  decision,
  title,
  body,
  confirmLabel,
  workspaceId,
  run,
}: {
  readonly triggerLabel: string;
  readonly tone?: "danger";
  readonly decision: ProviderListDecision;
  readonly title: string;
  readonly body: ReactNode;
  readonly confirmLabel: string;
  readonly workspaceId: string;
  readonly run: () => Promise<ProviderProfileActionResult>;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const completion = useProviderSetupCompletion(workspaceId);

  async function confirm(): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const result = await run();
      if (result.status === "error") {
        setError(profileActionErrorText(result));
        return;
      }
      await completion.complete();
      setOpen(false);
    } catch {
      setError(dashboardErrorText("dashboard_action_failed"));
    } finally {
      setPending(false);
    }
  }

  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) return;
        setOpen(next);
        if (next) setError(null);
      }}
    >
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            {...(tone ? { tone } : {})}
            className="min-h-9 rounded-lg px-3"
            disabled={!decision.allowed}
          />
        }
      >
        {triggerLabel}
      </DialogTrigger>
      <DialogPortal>
        <DialogBackdrop />
        <DialogPopup className="w-[min(94vw,30rem)]">
          <DialogTitle className="pr-8 text-cyan-50">{title}</DialogTitle>
          <DialogDescription className="text-sm leading-6 text-slate-300">
            {body}
          </DialogDescription>
          {error ? (
            <p role="alert" className="mt-3 text-sm leading-6 text-red-100">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              {...(tone ? { tone, variant: "outline" as const } : {})}
              aria-busy={pending}
              disabled={pending}
              onClick={() => void confirm()}
            >
              {pending ? "Working..." : confirmLabel}
            </Button>
          </div>
        </DialogPopup>
      </DialogPortal>
    </DialogRoot>
  );
}

/** A refusal of a list write, naming what blocks it when the server did. */
export function profileActionErrorText(
  result: Extract<ProviderProfileActionResult, { status: "error" }>,
): string {
  if (result.reason) return providerListDenialText(result.reason);
  const blocking = result.blocking;
  if (blocking && result.error === "provider_profile_in_use")
    return `This provider is still ${
      [
        ...(blocking.workspaceDefault ? ["the workspace default"] : []),
        ...(blocking.repositories.length
          ? [`used by ${repositoryNames(blocking.repositories)}`]
          : []),
      ].join(" and ") || "in use"
    }. Choose another provider there first.`;
  if (blocking && result.error === "provider_profile_model_incompatible")
    return `The new model does not support the review depth or fast mode used by ${
      [
        ...(blocking.workspaceDefault ? ["the workspace default"] : []),
        ...(blocking.repositories.length
          ? [repositoryNames(blocking.repositories)]
          : []),
      ].join(" and ") || "some repositories"
    }. Change their settings first, or keep the current model.`;
  return dashboardErrorText(result.error);
}

/** Up to five repository names, then how many more. */
function repositoryNames(repositories: readonly string[]): string {
  const names = repositories.slice(0, 5);
  const more = repositories.length - names.length;
  return `${names.join(", ")}${more > 0 ? ` and ${more} more` : ""}`;
}
