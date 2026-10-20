import { ProviderAuthLogoFrame } from "./provider-auth-logo";

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
      {profileLabel?.toLowerCase().includes("codex") ? (
        <ProviderAuthLogoFrame authMode="codex_account_gateway" />
      ) : null}
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
