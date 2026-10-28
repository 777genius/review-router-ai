import type { AccountView } from "../../src/server/account-gateway-accounts";

export const accountsCopy = {
  rename: "Rename",
  reconnectKey: "Update API key",
  connectKey: "Connect with API key",
  reconnectOAuth: "Refresh Codex sign-in",
  connectOAuth: "Connect Codex OAuth",
  suspend: "Disable",
  resume: "Enable",
  deleteConnection: "Remove connection…",
  detach: "Remove from this workspace",
  own: "My connections",
  available: "Available in this workspace",
  access: "Access",
  add: "Add account",
  connect: "Connect account",
  personal: "Personal",
  ownerUnavailable: "Owner unavailable",
  privacy: "Has access with limited visibility",
} as const;

export type AccountStatusKind =
  | "ready"
  | "confirming"
  | "removing"
  | "disabled"
  | "retired"
  | "attention"
  | "unknown"
  | "unavailable";

export type AccountStatusInfo = {
  readonly kind: AccountStatusKind;
  readonly text: string;
};

// Status texts for transitions driven outside the account row itself (local
// lifecycle activity, pending source operations, rows without a loaded account).
export const pendingStatusCopy = {
  removing: "Removing…",
  confirming: "Confirming change",
  unknown: "Outcome not confirmed yet",
} as const;

export function accountStatusInfo(
  account: Pick<AccountView, "state" | "readiness" | "lifecycle">,
): AccountStatusInfo {
  if (
    account.lifecycle?.status === "pending" &&
    account.lifecycle.action === "delete"
  )
    return { kind: "removing", text: pendingStatusCopy.removing };
  if (account.readiness === "unknown")
    return { kind: "unknown", text: pendingStatusCopy.unknown };
  if (account.readiness === "pending")
    return { kind: "confirming", text: pendingStatusCopy.confirming };
  if (account.state === "disabled" || account.state === "tombstoned")
    return { kind: "retired", text: "Retired" };
  if (account.state === "suspended")
    return { kind: "disabled", text: "Disabled" };
  if (account.state === "quarantined")
    return { kind: "attention", text: "Needs attention" };
  if (account.state === "staging")
    return { kind: "confirming", text: "Confirming connection" };
  if (account.readiness === "unavailable")
    return { kind: "unavailable", text: "Unavailable" };
  return account.state === "active"
    ? { kind: "ready", text: "Ready" }
    : { kind: "unavailable", text: "Unavailable" };
}

export function accountStatus(
  account: Pick<AccountView, "state" | "readiness" | "lifecycle">,
): string {
  return accountStatusInfo(account).text;
}
