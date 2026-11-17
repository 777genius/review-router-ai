import type { AccountView } from "../../src/server/account-gateway-accounts";
import { GitHubAccountAvatar } from "../github-account-avatar";
import { accountsCopy } from "./accounts-copy";

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
  const text =
    owner?.kind === "personal"
      ? owner.isViewer
        ? "You"
        : owner.handle
          ? `@${owner.handle}`
          : accountsCopy.ownerUnavailable
      : owner?.kind === "organization"
        ? owner.label
        : owner?.kind === "operator"
          ? owner.label
          : account.origin === "organization"
            ? "This workspace"
            : account.origin === "operator"
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
