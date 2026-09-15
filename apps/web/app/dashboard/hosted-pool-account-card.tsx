import { Badge } from "@reviewrouter/ui";
import { MonitorSmartphone } from "lucide-react";
import type { HostedPoolDashboardView } from "../../src/server/hosted-pool-dashboard";
import { FormSubmitButton } from "../form-submit-button";
import {
  DashboardActionForm,
  type DashboardActionFormAction,
} from "./dashboard-action-form";

type HostedAccountCardModel = HostedPoolDashboardView["accounts"][number];

export function HostedPoolAccountCards({
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
  const primaryAccountId = primaryAccount(accounts)?.id;
  return (
    <ul className="grid gap-3">
      {accounts.map((account) => (
        <li key={String(account.id)}>
          <HostedPoolAccountCard
            workspaceId={workspaceId}
            account={account}
            primary={account.id === primaryAccountId}
            setAccountState={setAccountState}
            mutationsEnabled={mutationsEnabled}
          />
        </li>
      ))}
    </ul>
  );
}

function HostedPoolAccountCard({
  workspaceId,
  account,
  primary,
  setAccountState,
  mutationsEnabled,
}: {
  readonly workspaceId: string;
  readonly account: HostedAccountCardModel;
  readonly primary: boolean;
  readonly setAccountState: DashboardActionFormAction;
  readonly mutationsEnabled: boolean;
}): React.ReactElement {
  const state = account.availability.status;
  const paused = state === "paused";
  const canTogglePause = state === "healthy" || state === "paused";
  const reason = availabilityReasonText(account.availability);
  const needsAttention = accountNeedsAttention(account);
  return (
    <article
      className={[
        "rounded-2xl border p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        cardSurfaceClass(account, primary),
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-cyan-200/15 bg-cyan-300/[0.08] text-cyan-100"
        >
          <MonitorSmartphone className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-mono text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-slate-400">
            ChatGPT session
          </p>
          <h4 className="mt-1 truncate text-base font-semibold text-cyan-50">
            {account.label}
          </h4>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {primary && state === "healthy" ? (
              <Badge
                size="xs"
                tone="accent"
                className="border-cyan-200/45 bg-cyan-300/15 px-2.5 py-1 text-[0.62rem] tracking-[0.14em] text-cyan-50"
              >
                Used first
              </Badge>
            ) : null}
            <Badge
              size="xs"
              tone={accountStatusTone(state)}
              className={accountStatusBadgeClass(state)}
            >
              {safeAccountStateLabel(state)}
            </Badge>
          </div>
        </div>
      </div>

      {needsAttention ? (
        <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/[0.06] px-3 py-2 text-xs leading-5 text-amber-100">
          {attentionCopy(account, reason)}
        </p>
      ) : reason ? (
        <p className="mt-3 text-sm leading-5 text-slate-200">{reason}</p>
      ) : null}

      <dl className="mt-3 grid gap-1 text-xs text-slate-400 sm:grid-cols-2">
        <div>
          <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Last validated
          </dt>
          <dd className="mt-0.5 text-slate-300">
            {formatSafeTimestamp(account.validatedAt)}
          </dd>
        </div>
        {account.credentialExpiresAt ? (
          <div>
            <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Session expires
            </dt>
            <dd className="mt-0.5 text-slate-300">
              {formatSafeTimestamp(account.credentialExpiresAt)}
            </dd>
          </div>
        ) : null}
        {account.availability.status === "cooldown" ? (
          <div>
            <dt className="font-mono text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-slate-500">
              Available again
            </dt>
            <dd className="mt-0.5 text-slate-300">
              {formatSafeTimestamp(account.availability.until)}
            </dd>
          </div>
        ) : null}
      </dl>

      {canTogglePause ? (
        <div className="mt-4">
          <DashboardActionForm
            action={setAccountState}
            fallbackParams={{
              error: "hosted_pool_action_failed",
              workspace: workspaceId,
              section: "setup",
            }}
          >
            <input type="hidden" name="workspaceId" value={workspaceId} />
            <input type="hidden" name="accountId" value={String(account.id)} />
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
              variant="outline"
              size="sm"
              disabled={!mutationsEnabled}
              idleLabel={
                paused ? "Use for reviews again" : "Stop using for reviews"
              }
              pendingLabel="Saving..."
            />
          </DashboardActionForm>
        </div>
      ) : null}
    </article>
  );
}

function primaryAccount(
  accounts: HostedPoolDashboardView["accounts"],
): HostedAccountCardModel | undefined {
  return accounts.reduce<HostedAccountCardModel | undefined>(
    (current, account) => {
      if (!current || account.priority < current.priority) return account;
      return current;
    },
    undefined,
  );
}

function accountNeedsAttention(account: HostedAccountCardModel): boolean {
  return (
    account.refreshDue ||
    account.availability.status === "cooldown" ||
    account.availability.status === "quarantined"
  );
}

function safeAccountStateLabel(status: string): string {
  switch (status) {
    case "healthy":
      return "Ready";
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

function accountStatusBadgeClass(status: string): string {
  switch (status) {
    case "healthy":
      return "border-lime-300/45 bg-lime-300/15 px-2.5 py-1 text-[0.62rem] tracking-[0.14em] text-lime-50";
    case "paused":
      return "border-amber-300/45 bg-amber-300/15 px-2.5 py-1 text-[0.62rem] tracking-[0.14em] text-amber-50";
    case "quarantined":
      return "border-red-300/45 bg-red-300/15 px-2.5 py-1 text-[0.62rem] tracking-[0.14em] text-red-50";
    default:
      return "border-amber-300/40 bg-amber-300/12 px-2.5 py-1 text-[0.62rem] tracking-[0.14em] text-amber-50";
  }
}

function accountStatusTone(
  status: string,
): "success" | "neutral" | "warning" | "danger" {
  switch (status) {
    case "healthy":
      return "success";
    case "paused":
      return "warning";
    case "quarantined":
      return "danger";
    default:
      return "warning";
  }
}

function cardSurfaceClass(
  account: HostedAccountCardModel,
  primary: boolean,
): string {
  if (account.availability.status === "quarantined") {
    return "border-red-300/25 bg-slate-950/70";
  }
  if (account.refreshDue || account.availability.status === "cooldown") {
    return "border-amber-300/25 bg-slate-950/70";
  }
  if (account.availability.status === "paused") {
    return "border-amber-300/25 bg-slate-950/55";
  }
  if (primary) {
    return "border-cyan-300/35 bg-cyan-300/[0.045]";
  }
  return "border-cyan-200/15 bg-slate-950/55";
}

function attentionCopy(
  account: HostedAccountCardModel,
  reason: string | null,
): string {
  if (account.refreshDue && account.availability.status === "healthy") {
    return "Session needs attention. Refresh is due for this ChatGPT session.";
  }
  if (account.availability.status === "quarantined") {
    return reason
      ? `Session needs attention. ${reason} Sign in with ChatGPT again if you need a replacement session.`
      : "Session needs attention. Sign in with ChatGPT again if you need a replacement session.";
  }
  if (account.availability.status === "cooldown") {
    return reason
      ? `Session needs attention. ${reason}`
      : "Session needs attention. This session is cooling down.";
  }
  return reason
    ? `Session needs attention. ${reason}`
    : "Session needs attention.";
}

function availabilityReasonText(
  availability: HostedAccountCardModel["availability"],
): string | null {
  if (availability.status === "healthy") return null;
  if (isUnsafeReason(availability.reason)) return null;
  switch (availability.reason) {
    case "operator":
    case "Operator":
    case "operator_paused":
    case "paused":
      return "Paused by an operator.";
    case "real_401":
      return "ChatGPT rejected this session.";
    case "expiry":
      return "The ChatGPT session expired.";
    case "rate_limited":
      return "Temporarily rate limited.";
    case "provider_cooldown":
      return "Waiting out a provider cooldown.";
    default:
      return humanizeReason(availability.reason);
  }
}

function isUnsafeReason(reason: string): boolean {
  return /token|fingerprint|credentialRef|eyJ/iu.test(reason);
}

function humanizeReason(reason: string): string | null {
  if (reason.startsWith("provider_state_")) {
    return "This session is unavailable.";
  }
  const cleaned = reason.replaceAll("_", " ").trim();
  if (!cleaned) return null;
  const sentence = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return sentence.endsWith(".") ? sentence : `${sentence}.`;
}

function formatSafeTimestamp(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}
