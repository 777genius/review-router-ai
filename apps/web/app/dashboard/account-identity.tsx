import type { AccountConnectionView } from "../../src/features/account-gateway/connection-capabilities";
import { ProviderAuthLogoFrame } from "./provider-auth-logo";

const GROK =
  "M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815";
const KIMI =
  "M21.765.351C22.998.351 24 1.353 24 2.586S22.998 4.82 21.765 4.82h-1.974c-.15 0-.26-.12-.26-.26V2.586A2.237 2.237 0 0 1 21.765.35M9.41 13.388l8.447-8.377c.16-.16.07-.471-.14-.471h-4.55s-.1.02-.14.06l-9.099 9.029c-.14.14-.35.02-.35-.21V4.81c0-.15-.1-.27-.221-.27H.22c-.12 0-.22.12-.22.27v18.57c0 .15.1.27.22.27h3.137c.12 0 .22-.12.22-.27v-3.79c0-.08.03-.16.08-.21l2.826-2.796c.07-.07.16-.08.241-.03l7.546 5.551a8.9 8.9 0 0 0 4.018 1.493c.12.01.23-.11.23-.27V19.76c0-.14-.08-.25-.19-.26a5.8 5.8 0 0 1-2.355-.942l-6.533-4.73c-.14-.09-.15-.32-.03-.441";

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
  if (name.includes("grok") || name.includes("kimi")) {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-900/70 text-cyan-100 ring-1 ring-cyan-100/15">
        <svg
          aria-hidden="true"
          className="size-4"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          {/* Reuse the provider marks from sub2api's PlatformIcon. */}
          <path d={name.includes("grok") ? GROK : KIMI} />
        </svg>
      </span>
    );
  }
  const badge = name.includes("glm")
    ? "GLM"
    : name.includes("minimax")
      ? "M"
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
