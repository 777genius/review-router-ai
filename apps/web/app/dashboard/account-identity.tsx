import type { ProviderKind } from "@reviewrouter/features-review-providers";
import type { AccountConnectionView } from "../../src/features/account-gateway/connection-capabilities";
import {
  accountProviderIdentity,
  type ProviderIdentity,
} from "../../src/features/provider-setup/provider-identity";
import { ProviderLogo } from "./provider-logo";
import { AccountMetadataLine } from "./account-metadata-line";
import type { AccountMetadataView } from "@reviewrouter/features-provider-accounts";
import type { NativeCredentialAttestation } from "../../src/features/account-gateway/domain/native-connection";

const credentialLabels: Record<
  NativeCredentialAttestation["credentialPolicy"],
  string
> = {
  provider_key: "Provider key",
  subscription_session: "Subscription session",
  cloud_identity: "Cloud identity",
  delegated_identity: "Delegated identity",
};

export function AccountProviderLogo({
  providerId,
  connection,
  provider,
}: {
  /** Legacy callers may carry this display text; it never selects a mark. */
  profileLabel?: string | undefined;
  providerId?: ProviderIdentity | undefined;
  connection?: AccountConnectionView | undefined;
  provider?: ProviderKind | "nvidia" | undefined;
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
  nativeCredential,
  connection,
  metadata,
}: {
  label: string;
  profileLabel?: string;
  provider?: ProviderKind | "nvidia" | undefined;
  authKind?: string | undefined;
  nativeCredential?: NativeCredentialAttestation | undefined;
  connection?: AccountConnectionView | undefined;
  metadata?: AccountMetadataView | undefined;
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
          {nativeCredential
            ? ` · ${credentialLabels[nativeCredential.credentialPolicy]}`
            : authKind === "oauth"
              ? " · OAuth"
              : authKind === "api_key"
                ? " · API key"
                : ""}
        </p>
        <AccountMetadataLine metadata={metadata} />
      </div>
    </div>
  );
}
