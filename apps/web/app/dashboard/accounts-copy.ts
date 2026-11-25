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
  ownDescription:
    "Connections you own, including those used in other workspaces. Choose Access to manage where each connection can be used.",
  listDescription:
    "Connections this workspace can use, plus your own connections that you can add to it.",
  usedHere: "Used in this workspace",
  notAddedHere: "Not added to this workspace",
  addHere: "Add to this workspace",
  addHereAdminsOnly:
    "Only workspace owners and admins can add connections here.",
  noConnections:
    "No connections yet. Connect an account to use it for reviews.",
  access: "Access",
  add: "Add account",
  connect: "Connect account",
  chooseForReviews: "Choose for reviews",
  personal: "Personal",
  notShared: "Not shared",
  ownerUnavailable: "Owner unavailable",
  privacy: "Has access with limited visibility",
} as const;

export type ConnectionOwnerKind =
  | "viewer"
  | "member"
  | "organization"
  | "operator"
  | "unknown";

// Confirmation of "Remove from this workspace": what changes and who can undo it.
export const removeFromWorkspaceCopy = {
  confirm: "Remove",
  done: "Removed from this workspace.",
  pending: "Removed from this workspace. Waiting for the gateway to confirm.",
  unconfirmed: "Removal could not be confirmed. Check the original request.",
  description: {
    organization:
      "Reviews in this workspace stop using this connection. It stays in this list, and you can add it back once the gateway confirms the change.",
    member:
      "Reviews in this workspace stop using this connection. Only its owner can add it back.",
    viewer:
      "Reviews in this workspace stop using this connection. You can add it back from your connections.",
    operator:
      "Reviews in this workspace stop using this ReviewRouter connection. Only ReviewRouter can add it back.",
    unknown: "Reviews in this workspace stop using this connection.",
  } satisfies Record<ConnectionOwnerKind, string>,
} as const;

/** The receipt of a removal: done, or still waiting for the gateway. */
export function removedFromWorkspaceText(
  remoteFenceDelivery: "remote_pending" | "remote_applied" | "not_required",
): string {
  return remoteFenceDelivery === "remote_pending"
    ? removeFromWorkspaceCopy.pending
    : removeFromWorkspaceCopy.done;
}

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

// Status texts not read from the account state itself: local lifecycle
// activity, changes in progress, and rows whose state could not be established.
const pendingStatusCopy = {
  removing: "Removing…",
  confirming: "Confirming change",
  unknown: "Status unknown",
  refreshFailed: "Details could not be refreshed",
} as const;

function accountStatusInfo(
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

/**
 * The one status order of a Connections row: a failed read, then removal, then
 * a change in progress, then the account's own status.
 */
export function connectionRowStatus({
  account,
  refreshFailed = false,
  localAction,
  pendingChange = false,
}: {
  readonly account?:
    | Pick<AccountView, "state" | "readiness" | "lifecycle">
    | undefined;
  readonly refreshFailed?: boolean | undefined;
  /** A lifecycle action this page started and has not settled yet. */
  readonly localAction?:
    | NonNullable<AccountView["lifecycle"]>["action"]
    | "unknown"
    | undefined;
  /** A change the server reports as in progress (an operation or a fence). */
  readonly pendingChange?: boolean | undefined;
}): AccountStatusInfo {
  if (refreshFailed)
    return { kind: "unknown", text: pendingStatusCopy.refreshFailed };
  if (
    localAction === "delete" ||
    (account?.lifecycle?.status === "pending" &&
      account.lifecycle.action === "delete")
  )
    return { kind: "removing", text: pendingStatusCopy.removing };
  if (localAction !== undefined || pendingChange)
    return { kind: "confirming", text: pendingStatusCopy.confirming };
  return account
    ? accountStatusInfo(account)
    : { kind: "unknown", text: pendingStatusCopy.unknown };
}
