import {
  supportsConnectionMethod,
  type ConnectionInputField,
  type ConnectionMethodV3,
  type ConnectionProfileV3,
  type CredentialAttestation,
} from "@agent-teams/account-gateway/contracts";
import type {
  NativeConnectionField,
  NativeConnectionInteraction,
  NativeConnectionMethod,
  NativeCredentialAttestation,
} from "../features/account-gateway/domain/native-connection";
import { nativeConnectionMethodAllowed } from "../features/account-gateway/domain/native-connection";
import type {
  AccountProfileView,
  AccountView,
} from "./account-gateway-accounts";
import type { AccountLifecycleRead } from "./account-lifecycle-reader";

export function nativeCredentialView(
  value: CredentialAttestation,
): NativeCredentialAttestation {
  return {
    credentialKind: value.credentialKind,
    credentialPolicy: value.credentialPolicy,
    refreshPolicy: value.refreshPolicy,
  };
}

/** Current account facts take precedence over a legacy catalog hint. */
export function accountCredentialView(
  account:
    | Pick<AccountLifecycleRead, "authKind" | "credential">
    | null
    | undefined,
  legacyAuthKind?: AccountProfileView["authKind"],
): Pick<AccountView, "authKind" | "nativeCredential"> {
  const kind = account?.authKind ?? legacyAuthKind;
  return {
    ...(kind === "api_key" || kind === "oauth" ? { authKind: kind } : {}),
    ...(account?.credential
      ? { nativeCredential: nativeCredentialView(account.credential) }
      : {}),
  };
}

function field(value: ConnectionInputField): NativeConnectionField {
  return {
    fieldId: value.fieldId,
    label: value.label,
    kind: value.kind,
    required: value.required,
    maxBytes: value.maxBytes,
    ...(value.help === undefined ? {} : { help: value.help }),
    ...(value.kind === "select"
      ? { choices: value.choices.map(({ value, label }) => ({ value, label })) }
      : {}),
  };
}

/** Allowlisted safe presentation only. Unknown required primitives stay disabled. */
export function nativeConnectionMethodView(
  value: ConnectionMethodV3,
): NativeConnectionMethod {
  let interaction: NativeConnectionInteraction = { kind: "unsupported" };
  if (supportsConnectionMethod(value)) {
    const source = value.interaction;
    if (source.kind === "credential_form")
      interaction = {
        kind: source.kind,
        inputFields: source.inputFields.map(field),
      };
    else {
      const preflight = source.preflightFields
        ? { preflightFields: source.preflightFields.map(field) }
        : {};
      interaction =
        source.kind === "browser"
          ? {
              kind: source.kind,
              ...preflight,
              callbackMode: source.callbackMode,
              completionInputKind: source.completionInputKind,
            }
          : { kind: source.kind, ...preflight };
    }
  }
  return {
    methodId: value.methodId,
    revision: value.revision,
    configurationGeneration: value.configurationGeneration,
    label: value.label,
    create: value.create,
    reconnect: value.reconnect,
    requirements: [...value.requirements],
    allowedCredentialPolicies: [...value.allowedCredentialPolicies],
    availability: value.availability,
    interaction,
  };
}

/** Provider identity is open; the admitted execution adapter remains explicit. */
export function nativeConnectionProfileView(
  value: ConnectionProfileV3,
): AccountProfileView {
  const methods = value.methods.map(nativeConnectionMethodView);
  return {
    id: value.profileId,
    label: value.provider.label,
    protocol: value.protocol,
    provider: "codex",
    availability: value.availability,
    models: value.models.map((model) => model.modelId),
    canReconnect: methods.some((method) =>
      nativeConnectionMethodAllowed(method, "reconnect"),
    ),
    connection: {
      provider: value.provider.id,
      providerLabel: value.provider.label,
      productId: value.product.id,
      planLabel: value.product.label,
      regionLabel: value.region.label,
      completionInputKind: "none",
      limitsContract:
        value.limitsContract === "unsupported" ? "none" : value.limitsContract,
      nativeMethods: methods,
      modelPolicy: {
        sourceId: value.modelPolicy.sourceId,
        contract: value.modelPolicy.contract,
        unavailableFallback: value.modelPolicy.unavailableFallback,
      },
      modelSettings: value.models.map((model) => ({
        modelId: model.modelId,
        reasoning: model.reasoning
          ? {
              allowed: [...model.reasoning.allowed],
              default: model.reasoning.default,
            }
          : null,
        fast: model.fast
          ? { allowed: [...model.fast.allowed], default: model.fast.default }
          : null,
        tools: {
          allowed: [...model.tools.allowed],
          default: model.tools.default,
        },
      })),
    },
  };
}
