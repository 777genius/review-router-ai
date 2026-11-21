import {
  nativeConnectionMethodAllowed,
  type NativeConnectionMethod,
  type NativeModelPolicy,
} from "./domain/native-connection";

/** Safe connection metadata. Upstream identity is independent of the review engine. */
export type AccountUpstreamProvider = string;

export type AccountModelSettings = {
  modelId: string;
  reasoning: { allowed: readonly string[]; default: string } | null;
  fast: { allowed: readonly string[]; default: string } | null;
  tools: {
    allowed: readonly ("none" | "function" | "function_and_custom")[];
    default: "none" | "function" | "function_and_custom";
  };
};

export type AccountConnectionView = {
  provider: AccountUpstreamProvider;
  providerLabel?: string;
  productId?: string;
  planLabel: string;
  regionLabel: string;
  completionInputKind: "none" | "callback_url" | "authorization_code";
  limitsContract: "account-limits/v1" | "account-limits/v2" | "account-limits/v3" | "none";
  modelSettings: readonly AccountModelSettings[];
  modelPolicy?: NativeModelPolicy;
  /** V3 uses native method identity; legacy methods are compatibility only. */
  nativeMethods?: readonly NativeConnectionMethod[];
  /** Qualified native methods. Missing only for compatible v1 catalogs. */
  methods?: readonly AccountConnectionMethod[];
};

/** Account-scoped discovery metadata; never contains Gateway identity/fences. */
export type AccountModelCatalogView = {
  status: "snapshot" | "unsupported" | "unavailable" | "unknown";
  source: string;
  fetchedAt?: string;
  expiresAt?: string;
  models: readonly string[];
};

/** Safe selection metadata only; imported bytes never enter this view. */
export type CredentialImportMethod = "refresh_token" | "oauth_auth_json";
export type AccountConnectionMethod =
  | {
      kind: "api_key" | "browser" | "device_code";
      create: boolean;
      reconnect: boolean;
    }
  | {
      kind: "credential_import";
      method: CredentialImportMethod;
      maxBytes: 65536;
      create: boolean;
      reconnect: boolean;
    };

type MethodProfile = {
  id?: string;
  authKind?: "api_key" | "oauth";
  availability?: "enabled" | "deployment_configuration_required" | undefined;
  canReconnect?: boolean;
  oauthMethods?: readonly ("browser" | "device_code")[];
  connection?: AccountConnectionView | undefined;
};
/** Product admission uses one declared method, never account display facts. */
export function connectionMethodAllowed(
  profile: MethodProfile,
  action: "create" | "reconnect",
  kind: "api_key" | "browser" | "device_code" | "credential_import",
  method?: CredentialImportMethod,
): boolean {
  if (profile.availability === "deployment_configuration_required")
    return false;
  if (action === "reconnect" && profile.canReconnect === false) return false;
  if (
    (kind === "browser" || kind === "device_code") &&
    profile.oauthMethods &&
    !profile.oauthMethods.includes(kind)
  )
    return false;
  if (
    kind === "credential_import" &&
    profile.id !== "openai-codex-oauth-responses-v1"
  )
    return false;
  if (profile.connection?.methods)
    return profile.connection.methods.some(
      (entry) =>
        entry.kind === kind &&
        entry[action] &&
        (entry.kind !== "credential_import" || entry.method === method),
    );
  if (kind === "credential_import") return false;
  if (action === "reconnect" && !profile.canReconnect) return false;
  return kind === "api_key"
    ? profile.authKind !== "oauth"
    : profile.authKind === "oauth" &&
        (profile.oauthMethods ?? ["browser", "device_code"]).includes(kind);
}
export function credentialImportMethods(
  profile: MethodProfile,
  action: "create" | "reconnect",
): CredentialImportMethod[] {
  return (["refresh_token", "oauth_auth_json"] as const).filter((method) =>
    connectionMethodAllowed(profile, action, "credential_import", method),
  );
}

/** Enrollment does not remove existing accounts when every create method is disabled. */
export function canCreateConnection(profile: MethodProfile): boolean {
  if (profile.connection?.nativeMethods)
    return (
      profile.availability !== "deployment_configuration_required" &&
      profile.connection.nativeMethods.some((method) =>
        nativeConnectionMethodAllowed(method, "create"),
      )
    );
  if (profile.connection?.methods)
    return profile.connection.methods.some((method) =>
      connectionMethodAllowed(
        profile,
        "create",
        method.kind,
        method.kind === "credential_import" ? method.method : undefined,
      ),
    );
  return profile.availability !== "deployment_configuration_required";
}
