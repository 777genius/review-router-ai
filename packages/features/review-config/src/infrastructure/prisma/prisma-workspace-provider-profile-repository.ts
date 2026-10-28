import {
  PrismaAuditLogRepository,
  recordAuditEvent,
} from "@reviewrouter/features-audit-log";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import type { Prisma, PrismaClient } from "@prisma/client";
import type { WorkspacePolicyHeads } from "../../application/ports/review-configuration-repository-port";
import type {
  ProviderProfileModelChangeScope,
  WorkspaceProviderProfileRepositoryPort,
} from "../../application/ports/workspace-provider-profile-repository-port";
import {
  composeEffectiveReviewConfiguration,
  parseStoredReviewPolicy,
} from "../../application/use-cases/resolve-effective-review-configuration";
import {
  providerProfileUsageOf,
  type RepositoryReviewPolicy,
} from "../../domain/review-policy-document";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import {
  providerProfileIdentityKey,
  providerProfileLabelAfterModelChange,
  ProviderProfileError,
  type ProviderProfileUsage,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";
import { readSelectableGatewayProfileRef } from "./prisma-gateway-binding-authority";
import {
  lockProviderAuthority,
  providerProfileFacts,
  readProviderAuthority,
  type LockedProviderAuthority,
} from "./prisma-provider-authority";
import {
  findOrCreateProviderProfileIn,
  lockGatewayBindings,
  readPersonalBindingIds,
  recordProviderProfileAudit,
  requestedProfileFacts,
  resolveProviderCredential,
  type ProviderProfileWriteOptions,
} from "./prisma-provider-profile-writes";
import { toProviderProfile } from "./prisma-provider-profile-rows";
import { PrismaReviewPolicyHeadReader } from "./prisma-review-policy-head-reader";
import {
  isPrismaReviewConfigurationWriteConflict,
  runReviewConfigurationTransaction,
} from "./prisma-transaction-retry";

type Input<
  Method extends
    | "findOrCreate"
    | "rename"
    | "changeModel"
    | "archive"
    | "readManagementFacts",
> = Parameters<WorkspaceProviderProfileRepositoryPort[Method]>[0];

/**
 * Lock order of every profile write: (model edits and archives: workspace
 * scope guard) -> Workspace -> personal actor and donors -> gateway connection
 * and binding -> ReviewConfiguration rows -> profile row. This extends the
 * admission order, so profile writes serialize with admissions, selection
 * saves and the Access rights toggle. Label edits change no configuration
 * and take no scope guard.
 */
export class PrismaWorkspaceProviderProfileRepository implements WorkspaceProviderProfileRepositoryPort {
  constructor(
    private readonly prisma: PrismaClient,
    // Trusted backend composition, never request data; deliberately required.
    private readonly options: ProviderProfileWriteOptions,
  ) {}

  findOrCreate(input: Input<"findOrCreate">) {
    return runReviewConfigurationTransaction(this.prisma, (tx) =>
      this.findOrCreateIn(tx, input),
    );
  }

  rename(input: Input<"rename">) {
    return runReviewConfigurationTransaction(this.prisma, (tx) =>
      renameIn(tx, input),
    );
  }

  async changeModel(input: Input<"changeModel">) {
    try {
      return await runReviewConfigurationTransaction(this.prisma, (tx) =>
        this.changeModelIn(tx, input),
      );
    } catch (error) {
      // Only a creator that bypassed the workspace lock can collide here.
      if (isPrismaReviewConfigurationWriteConflict(error))
        throw new ProviderProfileError("provider_profile_duplicate");
      throw error;
    }
  }

  archive(input: Input<"archive">) {
    return runReviewConfigurationTransaction(this.prisma, (tx) =>
      this.archiveIn(tx, input),
    );
  }

  changeAccessRights(
    input: Parameters<
      WorkspaceProviderProfileRepositoryPort["changeAccessRights"]
    >[0],
  ) {
    return runReviewConfigurationTransaction(this.prisma, async (tx) => {
      // Refuses a deleted or deleting workspace before any write.
      const authority = await lockProviderAuthority(
        tx,
        input.workspaceId,
        input.actor,
      );
      input.authorize(authority);
      const previous = authority.workspace.providerManagementAdminOnly;
      if (previous !== input.adminOnly)
        await tx.workspace.update({
          where: { id: input.workspaceId },
          data: { providerManagementAdminOnly: input.adminOnly },
        });
      await recordAuditEvent(
        {
          workspaceId: input.workspaceId,
          actor: input.actor.auditActor,
          action: "workspace.access_rights_saved",
          targetType: "workspace",
          targetId: input.workspaceId,
          metadata: {
            providerManagementAdminOnly: input.adminOnly,
            previous,
            ...input.auditMetadata,
          },
        },
        { auditLog: new PrismaAuditLogRepository(tx) },
      );
      return { adminOnly: input.adminOnly, previous };
    });
  }

  async list(workspaceId: string) {
    const rows = await this.prisma.workspaceProviderProfile.findMany({
      where: { workspaceId, archivedAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return rows.flatMap((row) => {
      try {
        return [toProviderProfile(row)];
      } catch (error) {
        // The SQL CHECKs keep rows consistent; never let one row hide the list.
        if (error instanceof ProviderProfileError) return [];
        throw error;
      }
    });
  }

  async readManagementFacts(input: Input<"readManagementFacts">) {
    const authority = await readProviderAuthority(
      this.prisma,
      input.workspaceId,
      input.actor,
    );
    if (!authority) return null;
    return {
      ...authority,
      personalBindingIds: await readPersonalBindingIds(
        this.prisma,
        input.workspaceId,
        input.bindingIds,
      ),
    };
  }

  async listUsage(workspaceId: string) {
    const heads = await PrismaReviewPolicyHeadReader.snapshot(
      this.prisma,
    ).readWorkspacePolicyHeads(workspaceId);
    return [...storedUsage(heads).values()];
  }

  private async findOrCreateIn(
    tx: Prisma.TransactionClient,
    input: Input<"findOrCreate">,
  ) {
    const authority = await lockProviderAuthority(
      tx,
      input.workspaceId,
      input.actor,
    );
    const { credential } = input;
    const bindingIds =
      credential.kind === "gateway_binding" ? [credential.bindingId] : [];
    input.authorize({
      ...authority,
      profile: await requestedProfileFacts(tx, {
        workspaceId: input.workspaceId,
        creatorUserId: input.actor.userId,
        credential,
        personalBindings: await readPersonalBindingIds(
          tx,
          input.workspaceId,
          bindingIds,
        ),
        repositoryId: null,
      }),
    });
    const personalBindings = await lockGatewayBindings(
      tx,
      input.workspaceId,
      bindingIds,
      input.actor.userId,
      this.options,
    );
    const source = await resolveProviderCredential(tx, {
      workspaceId: input.workspaceId,
      credential,
      personalBindings,
      options: this.options,
    });
    return findOrCreateProviderProfileIn(tx, {
      workspaceId: input.workspaceId,
      creatorUserId: input.actor.userId,
      auditActor: input.actor.auditActor,
      source,
      model: input.model,
      label: input.label,
    });
  }

  private async changeModelIn(
    tx: Prisma.TransactionClient,
    input: Input<"changeModel">,
  ) {
    const { profile, personalBindings } = await this.lockProfileWrite(
      tx,
      input,
    );
    const previousModel = profile.model;
    const changed: WorkspaceProviderProfile = {
      ...profile,
      model: input.model,
    };
    const heads = await new PrismaReviewPolicyHeadReader(
      tx,
    ).readWorkspacePolicyHeads(input.workspaceId);
    const profiles = new Map(heads.profiles).set(profile.id, changed);
    const affected = storedUsage(heads).get(profile.id) ?? emptyUsage(profile);
    const incompatible = {
      workspaceDefault: false,
      repositoryIds: [] as string[],
    };
    const scopes: ProviderProfileModelChangeScope[] = [];
    for (const target of affectedTargets(
      input.workspaceId,
      heads,
      profile.id,
    )) {
      const resolved = composeEffectiveReviewConfiguration(target, {
        workspace: heads.workspace,
        repository:
          target.scope === "repository"
            ? (heads.repositories.get(target.repositoryId) ?? null)
            : null,
        profiles,
      });
      if (resolved.status !== "ready") {
        if (target.scope === "workspace") incompatible.workspaceDefault = true;
        else incompatible.repositoryIds.push(target.repositoryId);
        continue;
      }
      scopes.push({ target, config: resolved.config });
    }
    if (incompatible.workspaceDefault || incompatible.repositoryIds.length)
      throw new ProviderProfileError("provider_profile_model_incompatible", {
        profileId: profile.id,
        workspaceDefault: incompatible.workspaceDefault,
        repositoryIds: incompatible.repositoryIds.sort(),
      });
    for (const scope of scopes) input.validateScope(scope);
    if (
      profile.credential.kind === "gateway_binding" &&
      (await readSelectableGatewayProfileRef(tx, {
        workspaceId: input.workspaceId,
        bindingId: profile.credential.bindingId,
        personalBindings,
        operatorWorkspaceId: this.options.operatorWorkspaceId,
        personalAccountsEnabled: this.options.personalAccountsEnabled,
      })) !== profile.credential.gatewayProfileRef
    )
      throw new Error("review_configuration_gateway_profile_mismatch");
    const identityKey = providerProfileIdentityKey(
      profile.credential,
      input.model,
    );
    const duplicate = await tx.workspaceProviderProfile.findUnique({
      where: {
        workspaceId_identityKey: {
          workspaceId: input.workspaceId,
          identityKey,
        },
      },
      select: { id: true },
    });
    if (duplicate && duplicate.id !== profile.id)
      throw new ProviderProfileError("provider_profile_duplicate");
    if (previousModel === input.model)
      return { profile, previousModel, affected };
    const label = providerProfileLabelAfterModelChange(profile, input.model);
    const updated = await tx.workspaceProviderProfile.updateMany({
      where: {
        id: profile.id,
        workspaceId: input.workspaceId,
        archivedAt: null,
      },
      data: { model: input.model, identityKey, label },
    });
    if (updated.count !== 1)
      throw new ProviderProfileError("provider_profile_not_found");
    const saved = toProviderProfile(
      await tx.workspaceProviderProfile.findUniqueOrThrow({
        where: { id: profile.id },
      }),
    );
    // No policy version changes, so the audit event names every scope.
    await recordProviderProfileAudit(tx, {
      action: "provider_profile.model_changed",
      profile: saved,
      actor: input.actor.auditActor,
      previousModel,
      ...(label === profile.label ? {} : { previousLabel: profile.label }),
      affected,
    });
    return { profile: saved, previousModel, affected };
  }

  private async archiveIn(
    tx: Prisma.TransactionClient,
    input: Input<"archive">,
  ) {
    const { profile } = await this.lockProfileWrite(tx, input);
    const heads = await new PrismaReviewPolicyHeadReader(
      tx,
    ).readWorkspacePolicyHeads(input.workspaceId);
    const usage = storedUsage(heads).get(profile.id);
    if (usage && (usage.workspaceDefault || usage.repositoryIds.length > 0))
      throw new ProviderProfileError("provider_profile_in_use", usage);
    const archivedAt = new Date();
    const updated = await tx.workspaceProviderProfile.updateMany({
      where: {
        id: profile.id,
        workspaceId: input.workspaceId,
        archivedAt: null,
      },
      // Archiving releases the identity so the provider can be created again.
      data: { archivedAt, identityKey: null },
    });
    if (updated.count !== 1)
      throw new ProviderProfileError("provider_profile_not_found");
    const archived = { ...profile, archivedAt };
    await recordProviderProfileAudit(tx, {
      action: "provider_profile.archived",
      profile: archived,
      actor: input.actor.auditActor,
    });
    return archived;
  }

  /**
   * The documented order for writes that change effective configurations:
   * workspace guard, Workspace, decision, personal actor, bindings, every
   * ReviewConfiguration row, then the profile itself, reread after its lock.
   */
  private async lockProfileWrite(
    tx: Prisma.TransactionClient,
    input: Input<"archive">,
  ): Promise<
    Readonly<{
      profile: WorkspaceProviderProfile;
      personalBindings: ReadonlySet<string>;
    }>
  > {
    await acquireCurrentScopeGuards(tx, [
      { scope: "workspace", workspaceId: input.workspaceId, mode: "exclusive" },
    ]);
    const authority = await lockProviderAuthority(
      tx,
      input.workspaceId,
      input.actor,
    );
    const candidate = await authorizeProfileWrite(tx, input, authority);
    const bindingIds =
      candidate.credential.kind === "gateway_binding"
        ? [candidate.credential.bindingId]
        : [];
    const personalBindings = await lockGatewayBindings(
      tx,
      input.workspaceId,
      bindingIds,
      input.actor.userId,
      this.options,
    );
    await tx.$queryRaw`
      SELECT "id" FROM "ReviewConfiguration"
      WHERE "workspaceId" = ${input.workspaceId} AND "active" = true
      ORDER BY "id" FOR UPDATE`;
    const locked = await tx.$queryRaw<readonly { id: string }[]>`
      SELECT "id" FROM "WorkspaceProviderProfile"
      WHERE "id" = ${candidate.id} AND "workspaceId" = ${input.workspaceId}
        AND "archivedAt" IS NULL
      FOR UPDATE`;
    if (locked.length !== 1)
      throw new ProviderProfileError("provider_profile_not_found");
    const profile = toProviderProfile(
      await tx.workspaceProviderProfile.findUniqueOrThrow({
        where: { id: candidate.id },
      }),
    );
    return { profile, personalBindings };
  }
}

async function renameIn(tx: Prisma.TransactionClient, input: Input<"rename">) {
  const authority = await lockProviderAuthority(
    tx,
    input.workspaceId,
    input.actor,
  );
  const profile = await authorizeProfileWrite(tx, input, authority);
  if (profile.label === input.label) return profile;
  // The conditional update locks the row and rechecks it is still active.
  const updated = await tx.workspaceProviderProfile.updateMany({
    where: { id: profile.id, workspaceId: input.workspaceId, archivedAt: null },
    data: { label: input.label },
  });
  if (updated.count !== 1)
    throw new ProviderProfileError("provider_profile_not_found");
  const renamed = toProviderProfile(
    await tx.workspaceProviderProfile.findUniqueOrThrow({
      where: { id: profile.id },
    }),
  );
  await recordProviderProfileAudit(tx, {
    action: "provider_profile.renamed",
    profile: renamed,
    actor: input.actor.auditActor,
    previousLabel: profile.label,
  });
  return renamed;
}

/**
 * The profile-independent gate first, then the profile and the decision, all
 * before any credential read or personal-actor lock can answer instead.
 */
async function authorizeProfileWrite(
  tx: Prisma.TransactionClient,
  input: Input<"archive">,
  authority: LockedProviderAuthority,
): Promise<WorkspaceProviderProfile> {
  input.gate(authority);
  const row = await tx.workspaceProviderProfile.findFirst({
    where: {
      id: input.profileId,
      workspaceId: input.workspaceId,
      archivedAt: null,
    },
  });
  if (!row) throw new ProviderProfileError("provider_profile_not_found");
  const profile = toProviderProfile(row);
  input.authorize({
    ...authority,
    profile: providerProfileFacts(
      profile,
      await readPersonalBindingIds(
        tx,
        input.workspaceId,
        profile.credential.kind === "gateway_binding"
          ? [profile.credential.bindingId]
          : [],
      ),
    ),
  });
  return profile;
}

function storedUsage(
  heads: WorkspacePolicyHeads,
): ReadonlyMap<string, ProviderProfileUsage> {
  const repositories = new Map<string, RepositoryReviewPolicy>();
  for (const [repositoryId, head] of heads.repositories) {
    const policy = parseStoredReviewPolicy("repository", head);
    if (policy) repositories.set(repositoryId, policy);
  }
  return providerProfileUsageOf({
    workspace: heads.workspace
      ? parseStoredReviewPolicy("workspace", heads.workspace)
      : null,
    repositories,
  });
}

/**
 * Targets whose effective configuration uses the profile: the workspace
 * default and every repository document resolving to it, explicitly or by
 * inheritance. A repository without a document resolves like the workspace.
 */
function affectedTargets(
  workspaceId: string,
  heads: WorkspacePolicyHeads,
  profileId: string,
): readonly ReviewConfigurationTarget[] {
  const workspace = heads.workspace
    ? parseStoredReviewPolicy("workspace", heads.workspace)
    : null;
  const defaultUses =
    workspace?.providers?.some(
      (selection) => selection.profileId === profileId,
    ) ?? false;
  const targets: ReviewConfigurationTarget[] = defaultUses
    ? [{ scope: "workspace", workspaceId }]
    : [];
  for (const [repositoryId, head] of heads.repositories) {
    const policy = parseStoredReviewPolicy("repository", head);
    const selections =
      policy?.providers ?? (policy ? workspace?.providers : []);
    if (selections?.some((selection) => selection.profileId === profileId))
      targets.push({ scope: "repository", workspaceId, repositoryId });
  }
  return targets;
}

function emptyUsage(profile: WorkspaceProviderProfile): ProviderProfileUsage {
  return { profileId: profile.id, workspaceDefault: false, repositoryIds: [] };
}
