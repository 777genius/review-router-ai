import type { AccountProfileView } from "../../src/server/account-gateway-accounts";

export type OAuthCompletionPresentation = {
  label: string;
  inputKind: "callback_url" | "authorization_code";
  personalOnly?: boolean | undefined;
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
    inputKind,
    personalOnly: profile.connection?.personalOnly ?? false,
  };
}
