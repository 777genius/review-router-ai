import type { AccountView } from "../../src/server/account-gateway-accounts";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { accountsCopy, type ConnectionOwnerKind } from "./accounts-copy";

/** Who owns a Connections row, from the safe owner fact or, without it, its origin. */
export function connectionOwnerKind(
  account: Pick<AccountView, "owner" | "origin">,
): ConnectionOwnerKind {
  const owner = account.owner;
  if (owner?.kind === "personal") return owner.isViewer ? "viewer" : "member";
  if (owner) return owner.kind;
  return account.origin === "personal"
    ? "member"
    : (account.origin ?? "unknown");
}

/** Owner cell of a Connections row: "You", a member handle, or the workspace. */
export function AccountOwner({
  account,
}: {
  account: Pick<AccountView, "owner" | "origin">;
}) {
  const owner = account.owner;
  const avatarUrl =
    owner?.kind === "personal" || owner?.kind === "organization"
      ? owner.avatarUrl
      : null;
  const avatarLabel =
    owner?.kind === "personal"
      ? (owner.handle ?? "Owner")
      : owner?.kind === "organization"
        ? owner.label
        : "Owner";
  const kind = connectionOwnerKind(account);
  const text =
    kind === "viewer"
      ? "You"
      : owner?.kind === "personal" && owner.handle
        ? `@${owner.handle}`
        : owner?.kind === "organization" || owner?.kind === "operator"
          ? owner.label
          : kind === "organization"
            ? "This workspace"
            : kind === "operator"
              ? "ReviewRouter"
              : accountsCopy.ownerUnavailable;
  return (
    <p className="mt-2 flex min-w-0 items-center gap-2 text-xs text-slate-400">
      {avatarUrl ? (
        <GitHubAccountAvatar
          avatarUrl={avatarUrl}
          login={avatarLabel}
          altText=""
          size="sm"
        />
      ) : null}
      <span className="truncate">{text}</span>
    </p>
  );
}
