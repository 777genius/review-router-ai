import type { AccountConnectionView } from "../../src/features/account-gateway/connection-capabilities";
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
  if (authMode) return <ProviderAuthLogoFrame authMode={authMode} />;
  const badge = name.includes("kimi")
    ? "K"
    : name.includes("glm")
      ? "GLM"
      : name.includes("minimax")
        ? "M"
        : name.includes("grok")
          ? "G"
          : null;
  return badge ? (
    <span
      aria-hidden="true"
      className="inline-flex size-9 shrink-0 items-center justify-center rounded-full border border-cyan-200/15 text-xs font-semibold text-cyan-100"
    >
      {badge}
    </span>
  ) : null;
}

export function AccountIdentity({
  label,
  profileLabel,
  authKind,
  connection,
}: {
  label: string;
  profileLabel?: string;
  authKind?: string | undefined;
  connection?: AccountConnectionView | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AccountProviderLogo profileLabel={profileLabel} />
      <div className="min-w-0">
        <p className="break-words font-medium text-cyan-50">{label}</p>
        <p className="mt-1 text-sm text-slate-400">
          {profileLabel ?? "Connection details unavailable"}
          {connection?.planLabel &&
          !profileLabel
            ?.toLowerCase()
            .includes(connection.planLabel.toLowerCase())
            ? ` · ${connection.planLabel}`
            : ""}
          {authKind
            ? ` · ${authKind === "oauth" ? "OAuth" : connection && ["kimi", "glm", "minimax"].includes(connection.provider) ? "Subscription key" : "API key"}`
            : ""}
        </p>
      </div>
    </div>
  );
}
