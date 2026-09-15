import { Badge, SelectField } from "@reviewrouter/ui";
import type {
  HostedPoolDashboardView,
  HostedPoolRepositoryView,
} from "../../src/server/hosted-pool-dashboard";
import { FormSubmitButton } from "../form-submit-button";
import {
  DashboardActionForm,
  type DashboardActionFormAction,
} from "./dashboard-action-form";
import {
  HostedPoolDeviceLogin,
  type HostedPoolDeviceLoginPollResult,
  type HostedPoolDeviceLoginStartResult,
} from "./hosted-pool-device-login";

type HostedPoolSettingsActions = Readonly<{
  importAccount: DashboardActionFormAction;
  startDeviceLogin: (
    formData: FormData,
  ) => Promise<HostedPoolDeviceLoginStartResult>;
  pollDeviceLogin: (
    formData: FormData,
  ) => Promise<HostedPoolDeviceLoginPollResult>;
  setAccountState: DashboardActionFormAction;
  setRepositorySource: DashboardActionFormAction;
}>;

const fieldClassName =
  "min-h-11 rounded-xl border border-cyan-200/15 bg-slate-950/80 px-3 text-cyan-50 outline-none focus:border-cyan-200/40";

export function HostedPoolSettingsPanel({
  workspaceId,
  view,
  actions,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly view: HostedPoolDashboardView;
  readonly actions: HostedPoolSettingsActions;
  readonly mutationsEnabled: boolean;
}): React.ReactElement | null {
  if (view.gate === "feature_disabled") return null;
  if (view.gate === "entitlement_denied") {
    return (
      <section className="border-t border-cyan-200/10 pt-5">
        <Badge tone="neutral">Hosted Codex pool</Badge>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Hosted session custody is not enabled for this workspace plan.
          Repository-owned GitHub secrets remain unchanged.
        </p>
      </section>
    );
  }

  const healthy = view.pool?.healthyAccountCount ?? 0;
  const total = view.pool?.accountCount ?? view.accounts.length;
  const enrolled = view.accounts.length > 0;
  const hasHealthyAccount =
    healthy > 0 ||
    view.accounts.some((account) => account.availability.status === "healthy");
  return (
    <section className="border-t border-cyan-200/10 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={hasHealthyAccount ? "success" : "warning"}>
              Hosted Codex pool
            </Badge>
            <Badge tone="neutral">
              {healthy} healthy / {total} total
            </Badge>
          </div>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-300">
            {enrolled ? (
              <>
                This workspace pool is enrolled for explicitly opted-in GitHub
                repositories. Add another ChatGPT session if you need more
                capacity. ReviewRouter stores the session and transiently relays
                model prompts, tool results, and responses. Credentials stay on
                the server and never go to the browser.
              </>
            ) : (
              <>
                Add workspace-owned Codex sessions for explicitly opted-in
                GitHub repositories. Sign in with ChatGPT here. Upload a local
                <span className="font-mono"> auth.json</span> only as a
                fallback. ReviewRouter stores the session and transiently relays
                model prompts, tool results, and responses. ChatGPT credentials
                never go to the browser.
              </>
            )}
          </p>
        </div>
      </div>

      {enrolled ? (
        <HostedPoolEnrolledAccounts
          workspaceId={workspaceId}
          accounts={view.accounts}
          setAccountState={actions.setAccountState}
          mutationsEnabled={mutationsEnabled}
        />
      ) : null}

      <HostedPoolDeviceLogin
        workspaceId={workspaceId}
        mutationsEnabled={mutationsEnabled}
        hasHealthyAccount={hasHealthyAccount}
        startAction={actions.startDeviceLogin}
        pollAction={actions.pollDeviceLogin}
      />

      {!enrolled ? (
        <p className="mt-4 text-sm text-slate-400">
          No hosted accounts yet. No repository can activate hosted mode until a
          healthy account is available.
        </p>
      ) : null}

      <HostedPoolAuthJsonFallback
        workspaceId={workspaceId}
        importAccount={actions.importAccount}
        mutationsEnabled={mutationsEnabled}
      />
    </section>
  );
}

function HostedPoolEnrolledAccounts({
  workspaceId,
  accounts,
  setAccountState,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly accounts: HostedPoolDashboardView["accounts"];
  readonly setAccountState: DashboardActionFormAction;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  return (
    <div className="mt-5">
      <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
        Enrolled accounts
      </h3>
      <ul className="mt-3 divide-y divide-cyan-200/10 overflow-hidden rounded-2xl border border-cyan-200/15 bg-slate-950/50">
        {accounts.map((account) => {
          const state = account.availability.status;
          const paused = state === "paused";
          return (
            <li
              key={String(account.id)}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-4"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-cyan-50">
                  {account.label}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  Priority {account.priority}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  tone={
                    state === "healthy"
                      ? "success"
                      : state === "paused"
                        ? "neutral"
                        : "warning"
                  }
                >
                  {safeAccountStateLabel(state)}
                </Badge>
                {(state === "healthy" || state === "paused") && (
                  <DashboardActionForm
                    action={setAccountState}
                    fallbackParams={{
                      error: "hosted_pool_action_failed",
                      workspace: workspaceId,
                      section: "setup",
                    }}
                  >
                    <input
                      type="hidden"
                      name="workspaceId"
                      value={workspaceId}
                    />
                    <input
                      type="hidden"
                      name="accountId"
                      value={String(account.id)}
                    />
                    <input
                      type="hidden"
                      name="expectedVersion"
                      value={account.healthVersion}
                    />
                    <input
                      type="hidden"
                      name="state"
                      value={paused ? "healthy" : "paused"}
                    />
                    <FormSubmitButton
                      variant="ghost"
                      size="sm"
                      disabled={!mutationsEnabled}
                      idleLabel={paused ? "Resume" : "Pause"}
                      pendingLabel="Saving..."
                    />
                  </DashboardActionForm>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function HostedPoolAuthJsonFallback({
  workspaceId,
  importAccount,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly importAccount: DashboardActionFormAction;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  return (
    <details className="mt-4 rounded-xl border border-cyan-200/10 bg-slate-950/30 p-4">
      <summary className="cursor-pointer list-none text-sm text-slate-300">
        <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
          Upload auth.json fallback
        </span>
        <p className="mt-1 text-xs leading-5 text-slate-500">
          Optional. Use only if ChatGPT sign-in is unavailable.
        </p>
      </summary>
      <p className="mt-3 text-xs leading-5 text-slate-400">
        Run <span className="font-mono">codex login</span> locally, then upload{" "}
        <span className="font-mono">~/.codex/auth.json</span>. Credentials never
        go to the browser.
      </p>
      <DashboardActionForm
        action={importAccount}
        fallbackParams={{
          error: "hosted_pool_action_failed",
          workspace: workspaceId,
          section: "setup",
        }}
        className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,1.1fr)_8rem_auto] sm:items-end"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <label className="grid min-w-0 gap-2 text-sm text-slate-300">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Fallback label
          </span>
          <input
            name="label"
            required
            maxLength={80}
            autoComplete="off"
            placeholder="Fallback session"
            className={fieldClassName}
          />
        </label>
        <label className="grid min-w-0 gap-2 text-sm text-slate-300">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            auth.json
          </span>
          <input
            name="authJson"
            type="file"
            required
            accept="application/json,.json"
            className="block min-h-11 min-w-0 overflow-hidden rounded-xl border border-cyan-200/15 bg-slate-950/80 px-2 py-1.5 text-xs text-slate-400 file:mr-2 file:inline-flex file:h-8 file:shrink-0 file:items-center file:rounded-lg file:border file:border-cyan-200/20 file:bg-cyan-300/10 file:px-3 file:text-cyan-50"
          />
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          <span className="font-mono text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">
            Priority
          </span>
          <input
            name="priority"
            type="number"
            min={0}
            defaultValue={100}
            required
            className={fieldClassName}
          />
        </label>
        <FormSubmitButton
          variant="outline"
          size="sm"
          className="min-h-11 whitespace-nowrap"
          disabled={!mutationsEnabled}
          idleLabel="Add account"
          pendingLabel="Importing..."
        />
      </DashboardActionForm>
    </details>
  );
}

export function RepositorySessionSourceSelector({
  workspaceId,
  repository,
  action,
  mutationsEnabled,
  hostedPoolReady,
}: {
  readonly workspaceId: string;
  readonly repository: HostedPoolRepositoryView;
  readonly action: DashboardActionFormAction;
  readonly mutationsEnabled: boolean;
  readonly hostedPoolReady: boolean;
}): React.ReactElement {
  const canChooseHosted =
    repository.source === "hosted_workspace_pool" ||
    (repository.eligible && hostedPoolReady);
  return (
    <div className="border-t border-cyan-200/10 pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-cyan-50">
          Codex session source
        </p>
        {repository.activation === "pending" ? (
          <Badge tone="warning">Pending workflow activation</Badge>
        ) : null}
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">
        Repository-owned GitHub Secret is the default. Hosted workspace pool is
        opt-in and means ReviewRouter custodizes the session and relays model
        traffic for this repository.
      </p>
      <DashboardActionForm
        action={action}
        fallbackParams={{
          error: "hosted_pool_action_failed",
          workspace: workspaceId,
          section: "repositories",
        }}
        className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
      >
        <input type="hidden" name="workspaceId" value={workspaceId} />
        <input type="hidden" name="repositoryId" value={repository.id} />
        <input
          type="hidden"
          name="expectedVersion"
          value={repository.bindingVersion}
        />
        <SelectField
          name="source"
          label="Source"
          defaultValue={repository.source}
          className="flex-1"
          disabled={!mutationsEnabled}
          options={[
            {
              value: "repository_secret",
              label: "Repository-owned GitHub Secret",
              description:
                "Current/default mode. ReviewRouter does not custody the session.",
            },
            ...(canChooseHosted
              ? [
                  {
                    value: "hosted_workspace_pool",
                    label: "Hosted workspace pool",
                    description:
                      "Selected GitHub repositories. Activates after the exact workflow update.",
                  },
                ]
              : []),
          ]}
        />
        <FormSubmitButton
          variant="outline"
          size="sm"
          disabled={!mutationsEnabled}
          idleLabel="Save source"
          pendingLabel="Saving..."
        />
      </DashboardActionForm>
      {!repository.eligible ? (
        <p className="mt-2 text-xs text-amber-200/80">
          This repository is not eligible for the hosted pool.
        </p>
      ) : !hostedPoolReady ? (
        <p className="mt-2 text-xs text-amber-200/80">
          Add a healthy hosted account before opting in this repository.
        </p>
      ) : null}
    </div>
  );
}

function safeAccountStateLabel(status: string): string {
  switch (status) {
    case "healthy":
      return "Healthy";
    case "paused":
      return "Paused";
    case "cooldown":
      return "Cooling down";
    case "quarantined":
      return "Needs reconnect";
    default:
      return "Unavailable";
  }
}
