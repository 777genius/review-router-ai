import {
  PrismaAuditLogRepository,
  recordAuditEvent,
} from "@reviewrouter/features-audit-log";
import { lockProviderAccountBindingUses } from "@reviewrouter/features-provider-accounts";
import type {
  Prisma,
  PrismaClient,
  WorkspaceProviderProfile as WorkspaceProviderProfileRow,
} from "@prisma/client";
import type {
  ProviderProfileActor,
  ProviderProfileAuthorityFacts,
  WorkspaceProviderProfileRepositoryPort,
} from "../../application/ports/workspace-provider-profile-repository-port";
import type { ProviderProfileFacts } from "../../domain/provider-management-policy";
import {
  defaultProviderProfileLabel,
  managedApiKeyProviderTypes,
  providerCredentialSourceFromStorage,
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
import { isPrismaReviewConfigurationSerializationConflict } from "./prisma-review-configuration-repository";

type Input<Method extends "findOrCreate" | "rename"> = Parameters<
  WorkspaceProviderProfileRepositoryPort[Method]
>[0];

const MAX_TRANSACTION_ATTEMPTS = 3;

/**
 * Lock order of every profile write: Workspace -> personal actor and donors ->
 * gateway connection and binding -> profile row. This extends the admission
 * order, so profile writes serialize with admissions, saves and the Access
 * rights toggle without new locks on those paths.
 */
export class PrismaWorkspaceProviderProfileRepository implements WorkspaceProviderProfileRepositoryPort {
  constructor(
    private readonly prisma: PrismaClient,
    // Trusted backend composition, never request data.
    private readonly options: Readonly<{
      operatorWorkspaceId?: string;
      personalAccountsEnabled?: boolean;
    }> = {},
  ) {}

  findOrCreate(input: Input<"findOrCreate">) {
    return this.transaction((tx) => this.findOrCreateIn(tx, input));
  }

  rename(input: Input<"rename">) {
    return this.transaction((tx) => renameIn(tx, input));
  }

  async list(workspaceId: string) {
    const rows = await this.prisma.workspaceProviderProfile.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.map(toProfile);
  }

  private async findOrCreateIn(
    tx: Prisma.TransactionClient,
    input: Input<"findOrCreate">,
  ) {
    const facts = await lockAuthorityFacts(tx, input.workspaceId, input.actor);
    const { credential } = input;
    const personalBindings =
      credential.kind === "gateway_binding"
        ? await lockPersonalWriteActor(
            tx,
            input.workspaceId,
            [credential.bindingId],
            input.actor.userId,
          )
        : new Set<string>();
    input.authorize({
      ...facts,
      profile: {
        credentialKind: credential.kind,
        createdByUserId: input.actor.userId,
        personalBinding:
          credential.kind === "gateway_binding" &&
          personalBindings.has(credential.bindingId),
        repositoryId:
          credential.kind === "repository_rotating"
            ? credential.repositoryId
            : null,
      },
    });
    if (
      input.repository &&
      !(await tx.repositoryConnection.findFirst({
        where: {
          id: input.repository.repositoryId,
          workspaceId: input.workspaceId,
        },
        select: { id: true },
      }))
    )
      throw new ProviderProfileError("provider_profile_invalid");
    const source = await this.resolveCredential(
      tx,
      input.workspaceId,
      credential,
      personalBindings,
    );
    const identityKey = providerProfileIdentityKey(source, input.model);
    const where = {
      workspaceId_identityKey: { workspaceId: input.workspaceId, identityKey },
    };
    const existing = await tx.workspaceProviderProfile.findUnique({ where });
    if (existing) return { profile: toProfile(existing), created: false };
    // Never catch a unique violation inside the interactive transaction: a
    // concurrent creator that bypassed the workspace lock wins and is read back.
    const inserted = await tx.workspaceProviderProfile.createMany({
      data: [
        {
          workspaceId: input.workspaceId,
          createdByUserId: input.actor.userId,
          credentialKind: source.kind,
          authMode: source.authMode,
          gatewayBindingId:
            source.kind === "gateway_binding" ? source.bindingId : null,
          gatewayProfileRef:
            source.kind === "gateway_binding" ? source.gatewayProfileRef : null,
          apiKeyConnectionId:
            source.kind === "managed_api_key"
              ? source.apiKeyConnectionId
              : null,
          repositoryId:
            source.kind === "repository_rotating" ? source.repositoryId : null,
          model: input.model,
          label:
            input.label ?? defaultProviderProfileLabel(source, input.model),
          identityKey,
        },
      ],
      skipDuplicates: true,
    });
    const profile = toProfile(
      await tx.workspaceProviderProfile.findUniqueOrThrow({ where }),
    );
    if (inserted.count === 1)
      await audit(tx, {
        action: "provider_profile.created",
        profile,
        actor: input.actor.auditActor,
      });
    return { profile, created: inserted.count === 1 };
  }

  /** Resolves server-owned references; the request never names them itself. */
  private async resolveCredential(
    tx: Prisma.TransactionClient,
    workspaceId: string,
    credential: ProviderCredentialRequest,
    personalBindings: ReadonlySet<string>,
  ): Promise<ProviderCredentialSource> {
    switch (credential.kind) {
      case "gateway_binding": {
        const personalAccountsEnabled =
          this.options.personalAccountsEnabled ?? false;
        await lockProviderAccountBindingUses(
          tx,
          workspaceId,
          [credential.bindingId],
          personalAccountsEnabled,
        );
        const gatewayProfileRef = await readSelectableGatewayProfileRef(tx, {
          workspaceId,
          bindingId: credential.bindingId,
          personalBindings,
          operatorWorkspaceId: this.options.operatorWorkspaceId,
          personalAccountsEnabled,
        });
        if (!gatewayProfileRef)
          throw new ProviderProfileError(
            "provider_profile_credential_unavailable",
          );
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

  private async transaction<Result>(
    run: (tx: Prisma.TransactionClient) => Promise<Result>,
  ): Promise<Result> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(run);
      } catch (error) {
        // Deadlock victims against lock-order-inverting writers retry whole.
        if (
          !isPrismaReviewConfigurationSerializationConflict(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        )
          throw error;
      }
    }
  }
}

async function renameIn(tx: Prisma.TransactionClient, input: Input<"rename">) {
  const facts = await lockAuthorityFacts(tx, input.workspaceId, input.actor);
  const where = {
    id: input.profileId,
    workspaceId: input.workspaceId,
    archivedAt: null,
  };
  const current = await tx.workspaceProviderProfile.findFirst({ where });
  if (!current) throw new ProviderProfileError("provider_profile_not_found");
  const profile = toProfile(current);
  const personalBindings =
    profile.credential.kind === "gateway_binding"
      ? await lockPersonalWriteActor(
          tx,
          input.workspaceId,
          [profile.credential.bindingId],
          input.actor.userId,
        )
      : new Set<string>();
  input.authorize({
    ...facts,
    profile: profileFacts(profile, personalBindings),
  });
  if (profile.label === input.label) return profile;
  // The conditional update locks the row and rechecks it is still active.
  const updated = await tx.workspaceProviderProfile.updateMany({
    where,
    data: { label: input.label },
  });
  if (updated.count !== 1)
    throw new ProviderProfileError("provider_profile_not_found");
  const renamed = toProfile(
    await tx.workspaceProviderProfile.findUniqueOrThrow({
      where: { id: input.profileId },
    }),
  );
  await audit(tx, {
    action: "provider_profile.renamed",
    profile: renamed,
    actor: input.actor.auditActor,
    previousLabel: profile.label,
  });
  return renamed;
}

/** Locks the workspace row, then reads the facts every decision needs. */
async function lockAuthorityFacts(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actor: ProviderProfileActor,
): Promise<Omit<ProviderProfileAuthorityFacts, "profile">> {
  // NO KEY UPDATE serializes with admission (FOR UPDATE), other profile writes
  // and the Access rights toggle, but not with foreign-key checks of inserts.
  const locked = await tx.$queryRaw<readonly { id: string }[]>`
    SELECT "id" FROM "Workspace"
    WHERE "id" = ${workspaceId} AND "deletionState" = 'active'
    FOR NO KEY UPDATE`;
  if (locked.length !== 1)
    throw new ProviderProfileError("provider_profile_workspace_unavailable");
  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { personalOwnerUserId: true, providerManagementAdminOnly: true },
  });
  const member = await tx.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    select: { role: true },
  });
  return {
    actor: { userId: actor.userId, role: member?.role ?? null },
    workspace,
  };
}

function profileFacts(
  profile: WorkspaceProviderProfile,
  personalBindings: ReadonlySet<string>,
): ProviderProfileFacts {
  const { credential } = profile;
  return {
    credentialKind: credential.kind,
    createdByUserId: profile.createdByUserId,
    personalBinding:
      credential.kind === "gateway_binding" &&
      personalBindings.has(credential.bindingId),
    repositoryId:
      credential.kind === "repository_rotating"
        ? credential.repositoryId
        : null,
  };
}

async function audit(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof providerProfileAuditEvent>[0],
) {
  await recordAuditEvent(providerProfileAuditEvent(input), {
    auditLog: new PrismaAuditLogRepository(tx),
  });
}

function toProfile(row: WorkspaceProviderProfileRow): WorkspaceProviderProfile {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    credential: providerCredentialSourceFromStorage(row),
    model: row.model,
    label: row.label,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
