import {
  accountProviderIdentity,
  type ProviderIdentity,
} from "../../src/features/provider-setup/provider-identity";
import type {
  AccountOperationView,
  AccountProfileView,
} from "../../src/server/account-gateway-accounts";

export type OAuthCompletionPresentation = {
  label: string;
  providerId?: ProviderIdentity | undefined;
  inputKind: "callback_url" | "authorization_code";
};

/** Legacy profiles have an explicit grammar; new profiles must declare theirs. */
export function oauthCompletionPresentation(
  profile: AccountProfileView | undefined,
): OAuthCompletionPresentation | undefined {
  if (!profile || profile.authKind !== "oauth") return undefined;
  const inputKind =
    profile.connection?.completionInputKind ??
    (profile.id === "anthropic-claude-oauth-messages-v1"
      ? "authorization_code"
      : profile.id === "openai-codex-oauth-responses-v1"
        ? "callback_url"
        : "none");
  if (inputKind === "none") return undefined;
  return {
    label: profile.label,
    providerId: accountProviderIdentity(profile),
    inputKind,
  };
}

export function operationStateText(
  state: AccountOperationView["state"] | "unresolved",
) {
  return state === "pending"
    ? "Waiting for completion"
    : state === "applied"
      ? "Completed"
      : state === "rejected"
        ? "Declined"
        : state === "unresolved"
          ? "Checking status"
          : "Status unavailable";
}
export function validAuthorizationURL(
  value: string | undefined,
): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.host) &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}
