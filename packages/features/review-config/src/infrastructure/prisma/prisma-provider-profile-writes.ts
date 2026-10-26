import {
  PrismaAuditLogRepository,
  recordAuditEvent,
} from "@reviewrouter/features-audit-log";
import { lockProviderAccountBindingUses } from "@reviewrouter/features-provider-accounts";
import type { Prisma } from "@prisma/client";
import type { ProviderProfileFacts } from "../../domain/provider-management-policy";
import {
  defaultProviderProfileLabel,
  managedApiKeyProviderTypes,
  providerProfileAuditEvent,
  providerProfileIdentityKey,
  ProviderProfileError,
  type ProviderCredentialRequest,
  type ProviderCredentialSource,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";
import {
  lockPersonalWriteActor,
  readSelectableGatewayProfileRef,
} from "./prisma-gateway-binding-authority";
import { toProviderProfile } from "./prisma-provider-profile-rows";

/** Trusted backend composition of every profile writer, never request data. */
export type ProviderProfileWriteOptions = Readonly<{
  operatorWorkspaceId: string | undefined;
  personalAccountsEnabled: boolean;
}>;

/**
 * Bindings among the given ones whose account belongs to a user. A plain read
 * without locks or actor checks, so the policy decides before any credential
 * read or personal-actor lock can refuse with its own error.
 */
export async function readPersonalBindingIds(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  bindingIds: readonly string[],
): Promise<ReadonlySet<string>> {
  if (bindingIds.length === 0) return new Set();
  const rows = await tx.workspaceAccountBinding.findMany({
    where: {
      workspaceId,
      id: { in: [...new Set(bindingIds)] },
      connection: { ownerUserId: { not: null } },
    },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
}

/** Decision facts of a requested credential, read before it is resolved. */
export async function requestedProfileFacts(
  tx: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly creatorUserId: string | null;
    readonly credential: ProviderCredentialRequest;
    readonly personalBindings: ReadonlySet<string>;
    /** The repository the profile is attached to, if any. */
    readonly repositoryId: string | null;
  },
): Promise<ProviderProfileFacts & Readonly<{ managedKeyApplied: boolean }>> {
  const { credential } = input;
  return {
    credentialKind: credential.kind,
    createdByUserId: input.creatorUserId,
    personalBinding:
      credential.kind === "gateway_binding" &&
      input.personalBindings.has(credential.bindingId),
    repositoryId:
      credential.kind === "repository_rotating"
        ? credential.repositoryId
        : null,
    managedKeyApplied:
      credential.kind === "managed_api_key" && input.repositoryId !== null
        ? await managedKeyApplied(tx, {
            workspaceId: input.workspaceId,
            providerType: managedApiKeyProviderTypes[credential.authMode],
            repositoryId: input.repositoryId,
          })
        : false,
  };
}

/** The server-installed key of the provider is applied to the repository. */
export async function managedKeyApplied(
  tx: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly repositoryId: string;
  } & (
    | { readonly providerType: string; readonly apiKeyConnectionId?: never }
    | { readonly apiKeyConnectionId: string; readonly providerType?: never }
  ),
): Promise<boolean> {
  const link = await tx.providerApiKeyRepositoryLink.findFirst({
    where: {
      workspaceId: input.workspaceId,
      repositoryId: input.repositoryId,
      appliedKeyVersion: { not: null },
      ...(input.apiKeyConnectionId !== undefined
        ? { providerApiKeyConnectionId: input.apiKeyConnectionId }
        : { connection: { providerType: input.providerType! } }),
    },
    select: { id: true },
  });
  return link !== null;
}

/**
 * Resolves the server-owned references of a request. The caller already holds
 * the personal actor and binding locks of a gateway request, so the account
 * profile ref read here stays current until commit.
 */
export async function resolveProviderCredential(
  tx: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly credential: ProviderCredentialRequest;
    readonly personalBindings: ReadonlySet<string>;
    readonly options: ProviderProfileWriteOptions;
  },
): Promise<ProviderCredentialSource> {
  const { workspaceId, credential } = input;
  switch (credential.kind) {
    case "gateway_binding": {
      // An unselectable binding refuses with the gateway binding error.
      const gatewayProfileRef = await readSelectableGatewayProfileRef(tx, {
        workspaceId,
        bindingId: credential.bindingId,
        personalBindings: input.personalBindings,
        operatorWorkspaceId: input.options.operatorWorkspaceId,
        personalAccountsEnabled: input.options.personalAccountsEnabled,
      });
      if (!gatewayProfileRef)
        throw new ProviderProfileError(
          "provider_profile_credential_unavailable",
        );
      // The account profile the requester saw; a newer one is a new provider.
      if (
        credential.gatewayProfileRef !== undefined &&
        credential.gatewayProfileRef !== gatewayProfileRef
      )
        throw new Error("review_configuration_gateway_profile_mismatch");
      return {
        kind: "gateway_binding",
        authMode: "codex_account_gateway",
        bindingId: credential.bindingId,
        gatewayProfileRef,
      };
    }
    case "managed_api_key": {
      const key = await tx.providerApiKeyConnection.findUnique({
        where: {
          workspaceId_providerType: {
            workspaceId,
            providerType: managedApiKeyProviderTypes[credential.authMode],
          },
        },
        select: { id: true },
      });
      if (!key)
        throw new ProviderProfileError(
          "provider_profile_credential_unavailable",
        );
      return {
        kind: "managed_api_key",
        authMode: credential.authMode,
        apiKeyConnectionId: key.id,
      };
    }
    case "repository_rotating":
      if (
        !(await tx.repositoryConnection.findFirst({
          where: { id: credential.repositoryId, workspaceId },
          select: { id: true },
        }))
      )
        throw new ProviderProfileError(
          "provider_profile_credential_unavailable",
        );
      return {
        kind: "repository_rotating",
        authMode: "codex_subscription_oauth_rotating",
        repositoryId: credential.repositoryId,
      };
    case "hosted_pool":
      return {
        kind: "hosted_pool",
        authMode: "codex_subscription_oauth_hosted_pool",
      };
    case "user_ci_secret":
      return { kind: "user_ci_secret", authMode: credential.authMode };
  }
}

/**
 * Returns the active profile with the same identity or creates it, recording
 * the creation audit event. Never catches a unique violation inside the
 * interactive transaction: a concurrent creator that bypassed the workspace
 * lock wins and is read back.
 */
export async function findOrCreateProviderProfileIn(
  tx: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    /** Null is a system creator; only owners and admins manage its profiles. */
    readonly creatorUserId: string | null;
    readonly auditActor: string;
    readonly source: ProviderCredentialSource;
    readonly model: string;
    readonly label: string | null;
  },
): Promise<Readonly<{ profile: WorkspaceProviderProfile; created: boolean }>> {
  const { source } = input;
  const identityKey = providerProfileIdentityKey(source, input.model);
  const where = {
    workspaceId_identityKey: { workspaceId: input.workspaceId, identityKey },
  };
  const existing = await tx.workspaceProviderProfile.findUnique({ where });
  if (existing) return { profile: toProviderProfile(existing), created: false };
  const inserted = await tx.workspaceProviderProfile.createMany({
    data: [
      {
        workspaceId: input.workspaceId,
        createdByUserId: input.creatorUserId,
        credentialKind: source.kind,
        authMode: source.authMode,
        gatewayBindingId:
          source.kind === "gateway_binding" ? source.bindingId : null,
        gatewayProfileRef:
          source.kind === "gateway_binding" ? source.gatewayProfileRef : null,
        apiKeyConnectionId:
          source.kind === "managed_api_key" ? source.apiKeyConnectionId : null,
        repositoryId:
          source.kind === "repository_rotating" ? source.repositoryId : null,
        model: input.model,
        label: input.label ?? defaultProviderProfileLabel(source, input.model),
        identityKey,
      },
    ],
    skipDuplicates: true,
  });
  const profile = toProviderProfile(
    await tx.workspaceProviderProfile.findUniqueOrThrow({ where }),
  );
  if (inserted.count === 1)
    await recordProviderProfileAudit(tx, {
      action: "provider_profile.created",
      profile,
      actor: input.auditActor,
    });
  return { profile, created: inserted.count === 1 };
}

export async function recordProviderProfileAudit(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof providerProfileAuditEvent>[0],
): Promise<void> {
  await recordAuditEvent(providerProfileAuditEvent(input), {
    auditLog: new PrismaAuditLogRepository(tx),
  });
}

/** Personal actor and donors, then the gateway connections and bindings. */
export async function lockGatewayBindings(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  bindingIds: readonly string[],
  actorUserId: string | undefined,
  options: ProviderProfileWriteOptions,
): Promise<ReadonlySet<string>> {
  const personalBindings = options.personalAccountsEnabled
    ? await lockPersonalWriteActor(tx, workspaceId, bindingIds, actorUserId)
    : new Set<string>();
  await lockProviderAccountBindingUses(
    tx,
    workspaceId,
    bindingIds,
    options.personalAccountsEnabled,
  );
  return personalBindings;
}
