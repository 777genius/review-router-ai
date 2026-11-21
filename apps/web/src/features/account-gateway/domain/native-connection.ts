/** Safe native declarations consumed by connection UI. No provider credential grammar. */
export type NativeConnectionField = Readonly<{
  fieldId: string;
  label: string;
  required: boolean;
  maxBytes: number;
  kind: "text" | "secret" | "select" | "document";
  help?: string;
  choices?: readonly Readonly<{ value: string; label: string }>[];
}>;

export type NativeConnectionInteraction =
  | Readonly<{
      kind: "browser";
      preflightFields?: readonly NativeConnectionField[];
      callbackMode: "automatic" | "manual";
      completionInputKind: "callback_url" | "authorization_code";
    }>
  | Readonly<{
      kind: "device";
      preflightFields?: readonly NativeConnectionField[];
    }>
  | Readonly<{
      kind: "credential_form";
      inputFields: readonly NativeConnectionField[];
    }>
  | Readonly<{ kind: "unsupported" }>;

export type NativeConnectionMethod = Readonly<{
  methodId: string;
  revision: number;
  configurationGeneration: string;
  label: string;
  create: boolean;
  reconnect: boolean;
  allowedCredentialPolicies: readonly string[];
  requirements: readonly string[];
  interaction: NativeConnectionInteraction;
  availability: "enabled" | "deployment_configuration_required";
}>;

/** Safe immutable identity. Inputs and challenges are deliberately excluded. */
export type NativeConnectionSelection = Readonly<{
  profileId: string;
  methodId: string;
  methodRevision: number;
  configurationGeneration: string;
}>;

export type NativeModelPolicy = Readonly<{
  sourceId: string;
  contract: "native-account-models/v2";
  unavailableFallback: "deny" | "qualified_anchor";
}>;

const supportedRequirements = new Set([
  "owner_scoped_custody",
  "effect_fence",
  "native_dispatch",
]);
const supportedCredentialPolicies = new Set([
  "provider_key",
  "subscription_session",
  "cloud_identity",
  "delegated_identity",
]);

/** Unknown requirements cannot be bypassed by a familiar visual interaction. */
export function nativeConnectionMethodAllowed(
  method: NativeConnectionMethod,
  action: "create" | "reconnect",
): boolean {
  return (
    method.availability === "enabled" &&
    method[action] &&
    method.interaction.kind !== "unsupported" &&
    method.requirements.every((id) => supportedRequirements.has(id)) &&
    method.allowedCredentialPolicies.length > 0 &&
    method.allowedCredentialPolicies.every((id) =>
      supportedCredentialPolicies.has(id),
    )
  );
}

export function nativeConnectionSelection(
  profileId: string,
  method: NativeConnectionMethod,
): NativeConnectionSelection {
  return Object.freeze({
    profileId,
    methodId: method.methodId,
    methodRevision: method.revision,
    configurationGeneration: method.configurationGeneration,
  });
}

export function nativeConnectionFields(
  method: NativeConnectionMethod,
): readonly NativeConnectionField[] {
  return method.interaction.kind === "credential_form"
    ? method.interaction.inputFields
    : method.interaction.kind === "unsupported"
      ? []
      : (method.interaction.preflightFields ?? []);
}

/** Bounded opaque envelope. Native alone interprets token/document/callback syntax. */
export function snapshotNativeConnectionInputs(
  value: unknown,
): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("invalid_connection_inputs");
  const entries = Object.entries(value);
  if (entries.length > 16) throw new Error("invalid_connection_inputs");
  let bytes = 0;
  for (const [key, text] of entries) {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key) ||
      typeof text !== "string" ||
      !text.isWellFormed()
    )
      throw new Error("invalid_connection_inputs");
    bytes += new TextEncoder().encode(text).byteLength;
    if (bytes > 65536) throw new Error("invalid_connection_inputs");
  }
  return Object.freeze(Object.fromEntries(entries));
}
