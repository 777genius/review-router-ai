import type { ProviderKind } from "@reviewrouter/features-review-providers";
import type { AccountConnectionView } from "../../src/features/account-gateway/connection-capabilities";
import {
  accountProviderIdentity,
  type ProviderIdentity,
} from "../../src/features/provider-setup/provider-identity";
import { ProviderLogo } from "./provider-logo";

export function AccountProviderLogo({
  providerId,
  connection,
  provider,
}: {
  /** Legacy callers may carry this display text; it never selects a mark. */
  profileLabel?: string | undefined;
  providerId?: ProviderIdentity | undefined;
  connection?: AccountConnectionView | undefined;
  provider?: ProviderKind | undefined;
}) {
  return (
    <ProviderLogo
      providerId={
        providerId ?? accountProviderIdentity({ connection, provider })
      }
    />
  );
}

export function AccountIdentity({
  label,
  profileLabel,
  provider,
  authKind,
  connection,
}: {
  label: string;
  profileLabel?: string;
  provider?: ProviderKind | undefined;
  authKind?: string | undefined;
  connection?: AccountConnectionView | undefined;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <AccountProviderLogo connection={connection} provider={provider} />
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
