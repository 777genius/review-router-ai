import { ProviderAuthLogoFrame } from "./provider-auth-logo";

export function AccountProviderLogo({
  profileLabel,
}: {
  profileLabel?: string | undefined;
}) {
  const name = profileLabel?.toLowerCase() ?? "";
  const authMode =
    name.includes("codex") || name.includes("openai")
      ? "codex_account_gateway"
      : name.includes("openrouter")
        ? "openrouter_api_key"
        : name.includes("claude") || name.includes("anthropic")
          ? "claude_code_oauth"
          : null;
  return authMode ? <ProviderAuthLogoFrame authMode={authMode} /> : null;
}

export function AccountIdentity({
  label,
  profileLabel,
  authKind,
}: {
  label: string;
  profileLabel?: string;
  authKind?: string | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AccountProviderLogo profileLabel={profileLabel} />
      <div className="min-w-0">
        <p className="break-words font-medium text-cyan-50">{label}</p>
        <p className="mt-1 text-sm text-slate-400">
          {profileLabel ?? "Connection details unavailable"}
          {authKind ? ` · ${authKind === "oauth" ? "OAuth" : "API key"}` : ""}
        </p>
      </div>
    </div>
  );
}
