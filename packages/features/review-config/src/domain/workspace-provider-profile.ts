import {
  gatewayModelSchema,
  gatewayReferenceSchema,
  getProviderAuthModeMetadata,
  type ProviderAuthMode,
} from "@reviewrouter/features-review-providers";
import { looksLikeSecretValue } from "@reviewrouter/shared";
import { z } from "zod";
import type { ReviewProviderConfiguration } from "./review-configuration";

export const providerCredentialKinds = [
  "gateway_binding",
  "managed_api_key",
  "hosted_pool",
  "repository_rotating",
  "user_ci_secret",
] as const;

/** Where the credential of a workspace provider comes from. */
export type ProviderCredentialKind = (typeof providerCredentialKinds)[number];

/** Auth modes each credential kind can deliver. */
const credentialAuthModes = {
  gateway_binding: ["codex_account_gateway"],
  managed_api_key: ["mimo_token_plan_api_key", "openrouter_api_key"],
  hosted_pool: ["codex_subscription_oauth_hosted_pool"],
  repository_rotating: ["codex_subscription_oauth_rotating"],
  // Fixed repository secrets are read only by the approved direct runtime.
  user_ci_secret: [
    "mimo_token_plan_api_key",
    "claude_code_oauth",
    "openrouter_api_key",
    "kimi_code_api_key",
  ],
} as const satisfies Record<
  ProviderCredentialKind,
  readonly ProviderAuthMode[]
>;

export type ManagedApiKeyAuthMode =
  (typeof credentialAuthModes.managed_api_key)[number];
export type UserCiSecretAuthMode =
  (typeof credentialAuthModes.user_ci_secret)[number];

/** The server-installed key (`ProviderApiKeyConnection.providerType`) per auth mode. */
export const managedApiKeyProviderTypes = {
  mimo_token_plan_api_key: "mimo",
  openrouter_api_key: "openrouter",
} as const satisfies Record<ManagedApiKeyAuthMode, string>;

/**
 * What a creator selects. The server resolves the stored references: the
 * gateway profile ref from the binding and the key from the auth mode, so a
 * request can never name another workspace's key or store a stale profile
 * ref. A gateway request may name the account profile its requester saw; a
 * different current one is refused instead of silently creating a provider.
 */
export type ProviderCredentialRequest =
  | {
      readonly kind: "gateway_binding";
      readonly bindingId: string;
      readonly gatewayProfileRef?: string | undefined;
    }
  | {
      readonly kind: "managed_api_key";
      readonly authMode: ManagedApiKeyAuthMode;
    }
  | { readonly kind: "hosted_pool" }
  | { readonly kind: "repository_rotating"; readonly repositoryId: string }
  | {
      readonly kind: "user_ci_secret";
      readonly authMode: UserCiSecretAuthMode;
    };

/** The credential source of a stored profile. Immutable after creation. */
export type ProviderCredentialSource =
  | {
      readonly kind: "gateway_binding";
      readonly authMode: "codex_account_gateway";
      readonly bindingId: string;
      readonly gatewayProfileRef: string;
    }
  | {
      readonly kind: "managed_api_key";
      readonly authMode: ManagedApiKeyAuthMode;
      readonly apiKeyConnectionId: string;
    }
  | {
      readonly kind: "hosted_pool";
      readonly authMode: "codex_subscription_oauth_hosted_pool";
    }
  | {
      readonly kind: "repository_rotating";
      readonly authMode: "codex_subscription_oauth_rotating";
      readonly repositoryId: string;
    }
  | {
      readonly kind: "user_ci_secret";
      readonly authMode: UserCiSecretAuthMode;
    };

/** A workspace provider: credential source plus model. Never holds a secret. */
export type WorkspaceProviderProfile = Readonly<{
  id: string;
  workspaceId: string;
  /** Null is a system creator or a deleted user; only owners/admins manage it. */
  createdByUserId: string | null;
  credential: ProviderCredentialSource;
  model: string;
  label: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export type ProviderProfileErrorCode =
  | "provider_profile_invalid"
  | "provider_profile_not_found"
  | "provider_profile_workspace_unavailable"
  | "provider_profile_credential_unavailable"
  | "provider_profile_duplicate"
  | "provider_profile_in_use"
  | "provider_profile_model_incompatible";

/** Policy scopes whose stored selections use one profile. */
export type ProviderProfileUsage = Readonly<{
  profileId: string;
  /** The profile is (part of) the workspace default. */
  workspaceDefault: boolean;
  /** Repositories selecting the profile themselves, sorted. */
  repositoryIds: readonly string[];
}>;

export class ProviderProfileError extends Error {
  constructor(
    readonly code: ProviderProfileErrorCode,
    /** The scopes that block an archive or a model edit. */
    readonly affected?: ProviderProfileUsage,
  ) {
    super(code);
    this.name = "ProviderProfileError";
  }
}

const opaqueReferenceSchema = gatewayReferenceSchema;

export const providerCredentialRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("gateway_binding"),
      bindingId: opaqueReferenceSchema,
      gatewayProfileRef: opaqueReferenceSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("managed_api_key"),
      authMode: z.enum(credentialAuthModes.managed_api_key),
    })
    .strict(),
  z.object({ kind: z.literal("hosted_pool") }).strict(),
  z
    .object({
      kind: z.literal("repository_rotating"),
      repositoryId: opaqueReferenceSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("user_ci_secret"),
      authMode: z.enum(credentialAuthModes.user_ci_secret),
    })
    .strict(),
]);

export const providerProfileModelSchema = gatewayModelSchema.max(200);

// Prefixes the SQL CHECKs of 000119 and 000145 reject as credential-shaped.
const secretPrefix = /^(?:sk-|ghp_|github_pat_|xox[baprs]-)/;

export const providerProfileLabelSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine(
    (label) =>
      // eslint-disable-next-line no-control-regex
      !/[\u0000-\u001f\u007f]/.test(label) &&
      !secretPrefix.test(label) &&
      !looksLikeSecretValue(label),
    "provider label must be a plain name",
  );

/** Parses untrusted create input; any failure is `provider_profile_invalid`. */
export function parseProviderProfileDraft(input: {
  readonly credential: unknown;
  readonly model: unknown;
  readonly label?: unknown;
}): Readonly<{
  credential: ProviderCredentialRequest;
  model: string;
  label: string | null;
}> {
  const credential = providerCredentialRequestSchema.safeParse(
    input.credential,
  );
  const model = providerProfileModelSchema.safeParse(input.model);
  const label =
    input.label === undefined
      ? null
      : providerProfileLabelSchema.safeParse(input.label);
  if (
    !credential.success ||
    !model.success ||
    label?.success === false ||
    (credential.success &&
      credential.data.kind === "user_ci_secret" &&
      credential.data.authMode === "kimi_code_api_key" &&
      model.success &&
      model.data !== "k3-256k")
  )
    throw new ProviderProfileError("provider_profile_invalid");
  return {
    credential: credential.data,
    model: model.data,
    label: label?.data ?? null,
  };
}

export function parseProviderProfileLabel(label: unknown): string {
  const parsed = providerProfileLabelSchema.safeParse(label);
  if (!parsed.success)
    throw new ProviderProfileError("provider_profile_invalid");
  return parsed.data;
}

/** A readable default when the creator gives no label. */
export function defaultProviderProfileLabel(
  credential: Pick<ProviderCredentialSource, "authMode">,
  model: string,
): string {
  const label = `${getProviderAuthModeMetadata(credential.authMode).label} (${model})`;
  return label.slice(0, 80).trimEnd();
}

/**
 * The label a profile keeps after a model edit. A label that is still the
 * generated one names the old model, so it follows the new model; a label
 * someone chose stays as it is.
 */
export function providerProfileLabelAfterModelChange(
  profile: Pick<WorkspaceProviderProfile, "credential" | "model" | "label">,
  model: string,
): string {
  return profile.label ===
    defaultProviderProfileLabel(profile.credential, profile.model)
    ? defaultProviderProfileLabel(profile.credential, model)
    : profile.label;
}

/**
 * Unique per workspace: `credentialKind:credentialRef-or-authMode:model`.
 * A gateway source contributes `bindingId/gatewayProfileRef`, so a changed
 * account profile is a distinct provider. Segments are URI-encoded, which
 * keeps the key injective although references and models may contain `:`.
 * The model is only trimmed: provider APIs and the runtime configuration
 * treat model IDs as case-sensitive, so `Model-X` and `model-x` are two
 * providers rather than one profile silently answering for the other.
 */
export function providerProfileIdentityKey(
  credential: ProviderCredentialSource,
  model: string,
): string {
  return [
    credential.kind,
    credentialIdentity(credential),
    encodeURIComponent(model.trim()),
  ].join(":");
}

function credentialIdentity(credential: ProviderCredentialSource): string {
  switch (credential.kind) {
    case "gateway_binding":
      return `${encodeURIComponent(credential.bindingId)}/${encodeURIComponent(credential.gatewayProfileRef)}`;
    case "managed_api_key":
      return encodeURIComponent(credential.apiKeyConnectionId);
    case "repository_rotating":
      return encodeURIComponent(credential.repositoryId);
    case "hosted_pool":
    case "user_ci_secret":
      return credential.authMode;
  }
}

/** The workspace's server-managed keys and where each is applied. */
export type ManagedApiKeyFacts = Readonly<{
  /** Key ID by `ProviderApiKeyConnection.providerType`. */
  keyIds: ReadonlyMap<string, string>;
  applied: (repositoryId: string, keyId: string) => boolean;
}>;

/**
 * Whether the server-managed key of a provider serves a target: the
 * workspace default uses it whenever it exists, a repository once the key is
 * applied there.
 */
export function managedApiKeyServes(
  facts: ManagedApiKeyFacts,
  authMode: ManagedApiKeyAuthMode,
  repositoryId: string | null,
): boolean {
  const keyId = facts.keyIds.get(managedApiKeyProviderTypes[authMode]);
  return (
    keyId !== undefined &&
    (repositoryId === null || facts.applied(repositoryId, keyId))
  );
}

/**
 * The credential source a schema 3 runtime provider row stands for, for the
 * one-time profile migration: rotating belongs to the target repository, and
 * an API key is the server-managed key only where that key serves the target.
 */
export function providerCredentialRequestFor(
  provider: Pick<ReviewProviderConfiguration, "authMode"> & {
    readonly gatewayBindingId?: string | undefined;
    readonly gatewayProfileRef?: string | undefined;
  },
  target: Readonly<{
    repositoryId: string | null;
    managedApiKeys: ManagedApiKeyFacts;
  }>,
): ProviderCredentialRequest {
  switch (provider.authMode) {
    case "codex_account_gateway":
      if (!provider.gatewayBindingId)
        throw new ProviderProfileError("provider_profile_invalid");
      return {
        kind: "gateway_binding",
        bindingId: provider.gatewayBindingId,
        ...(provider.gatewayProfileRef
          ? { gatewayProfileRef: provider.gatewayProfileRef }
          : {}),
      };
    case "codex_subscription_oauth_hosted_pool":
      return { kind: "hosted_pool" };
    case "codex_subscription_oauth_rotating":
      if (!target.repositoryId)
        throw new ProviderProfileError("provider_profile_invalid");
      return { kind: "repository_rotating", repositoryId: target.repositoryId };
    case "mimo_token_plan_api_key":
      return managedApiKeyServes(
        target.managedApiKeys,
        provider.authMode,
        target.repositoryId,
      )
        ? { kind: "managed_api_key", authMode: provider.authMode }
        : { kind: "user_ci_secret", authMode: provider.authMode };
    case "openrouter_api_key":
      return managedApiKeyServes(
        target.managedApiKeys,
        provider.authMode,
        target.repositoryId,
      )
        ? { kind: "managed_api_key", authMode: provider.authMode }
        : { kind: "user_ci_secret", authMode: provider.authMode };
    case "kimi_code_api_key":
      return { kind: "user_ci_secret", authMode: provider.authMode };
    case "claude_code_oauth":
      return { kind: "user_ci_secret", authMode: provider.authMode };
  }
}

export function isManagedApiKeyAuthMode(
  authMode: string,
): authMode is ManagedApiKeyAuthMode {
  return isOneOf(credentialAuthModes.managed_api_key, authMode);
}

/** Rebuilds a stored source; an inconsistent row is refused, never repaired. */
export function providerCredentialSourceFromStorage(row: {
  readonly credentialKind: string;
  readonly authMode: string;
  readonly gatewayBindingId: string | null;
  readonly gatewayProfileRef: string | null;
  readonly apiKeyConnectionId: string | null;
  readonly repositoryId: string | null;
}): ProviderCredentialSource {
  const { authMode } = row;
  switch (row.credentialKind) {
    case "gateway_binding":
      if (
        authMode === "codex_account_gateway" &&
        row.gatewayBindingId &&
        row.gatewayProfileRef
      )
        return {
          kind: "gateway_binding",
          authMode,
          bindingId: row.gatewayBindingId,
          gatewayProfileRef: row.gatewayProfileRef,
        };
      break;
    case "managed_api_key":
      if (
        isOneOf(credentialAuthModes.managed_api_key, authMode) &&
        row.apiKeyConnectionId
      )
        return {
          kind: "managed_api_key",
          authMode,
          apiKeyConnectionId: row.apiKeyConnectionId,
        };
      break;
    case "hosted_pool":
      if (authMode === "codex_subscription_oauth_hosted_pool")
        return { kind: "hosted_pool", authMode };
      break;
    case "repository_rotating":
      if (authMode === "codex_subscription_oauth_rotating" && row.repositoryId)
        return {
          kind: "repository_rotating",
          authMode,
          repositoryId: row.repositoryId,
        };
      break;
    case "user_ci_secret":
      if (isOneOf(credentialAuthModes.user_ci_secret, authMode))
        return { kind: "user_ci_secret", authMode };
      break;
  }
  throw new ProviderProfileError("provider_profile_invalid");
}

function isOneOf<T extends string>(
  values: readonly T[],
  value: string,
): value is T {
  return (values as readonly string[]).includes(value);
}

/** Audit entry of a profile write. Only names and kinds, never a credential. */
export function providerProfileAuditEvent(input: {
  readonly action:
    | "provider_profile.created"
    | "provider_profile.renamed"
    | "provider_profile.model_changed"
    | "provider_profile.archived";
  readonly profile: WorkspaceProviderProfile;
  readonly actor: string;
  readonly previousLabel?: string;
  readonly previousModel?: string;
  /** Scopes whose effective configuration changed without a new version. */
  readonly affected?: ProviderProfileUsage;
}) {
  const { profile } = input;
  return {
    workspaceId: profile.workspaceId,
    actor: input.actor,
    action: input.action,
    targetType: "provider_profile",
    targetId: profile.id,
    metadata: {
      credentialKind: profile.credential.kind,
      authMode: profile.credential.authMode,
      model: profile.model,
      label: profile.label,
      ...(input.previousLabel === undefined
        ? {}
        : { previousLabel: input.previousLabel }),
      ...(input.previousModel === undefined
        ? {}
        : { previousModel: input.previousModel }),
      ...(input.affected === undefined
        ? {}
        : {
            affectedWorkspaceDefault: input.affected.workspaceDefault,
            affectedRepositoryIds: [...input.affected.repositoryIds],
          }),
    },
  };
}
