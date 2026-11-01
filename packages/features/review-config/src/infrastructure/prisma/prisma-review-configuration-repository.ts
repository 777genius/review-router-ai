import {
  PrismaAuditLogRepository,
  recordAuditEvent,
} from "@reviewrouter/features-audit-log";
import { acquireCurrentScopeGuards } from "@reviewrouter/platform-db";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  canonicalJson,
  type ReviewConfiguration,
} from "../../domain/review-configuration";
import {
  parseReviewPolicyDocument,
  resolveEffectiveReviewPolicy,
  ReviewPolicyMaterializationError,
  sameProviderSelections,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  withProviderSelections,
  type RepositoryReviewPolicy,
  type ReviewPolicyDocument,
  type ReviewProviderSelection,
  type WorkspaceReviewPolicy,
} from "../../domain/review-policy-document";
import {
  reviewConfigurationTargetKey,
  type ReviewConfigurationTarget,
} from "../../domain/review-configuration-target";
import {
  parseProviderProfileDraft,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";
import type {
  PersistedReviewConfiguration,
  ProviderProfileDraft,
  ProviderSelectionAuthority,
  ReviewConfigurationRepositoryPort,
  ReviewPolicyHead,
  ReviewPolicyWrite,
  SavedReviewPolicy,
  SelectedProviderProfileFacts,
} from "../../application/ports/review-configuration-repository-port";
import {
  effectiveReviewPolicyDigest,
  parseStoredReviewPolicy,
  persistedReviewConfiguration,
  readyReviewConfiguration,
  resolveEffectiveReviewConfiguration,
} from "../../application/use-cases/resolve-effective-review-configuration";
import {
  isReviewConfigurationWriteConflictError,
  ReviewConfigurationWriteConflictError as WriteConflict,
} from "../../application/ports/review-configuration-repository-port";
import {
  PrismaReviewPolicyHeadReader,
  readActivePolicyHead,
  referencedProfileIds,
  type ReviewPolicyReader,
} from "./prisma-review-policy-head-reader";
import { readSelectableGatewayProfileRef } from "./prisma-gateway-binding-authority";
import {
  lockProviderAuthority,
  providerProfileFacts,
} from "./prisma-provider-authority";
import { readProviderProfiles } from "./prisma-provider-profile-rows";
import {
  findOrCreateProviderProfileIn,
  lockGatewayBindings,
  managedKeyApplied,
  readPersonalBindingIds,
  requestedProfileFacts,
  resolveProviderCredential,
} from "./prisma-provider-profile-writes";
import {
  isPrismaReviewConfigurationSerializationConflict,
  isPrismaReviewConfigurationWriteConflict,
  MAX_TRANSACTION_ATTEMPTS,
} from "./prisma-transaction-retry";

type WriterOptions = Readonly<{
  operatorWorkspaceId: string | undefined;
  // Trusted backend composition, never a config or batch request field.
  personalAccountsEnabled: boolean;
  personalWriteActorUserId: string | undefined;
}>;

export class PrismaReviewConfigurationRepository implements ReviewConfigurationRepositoryPort {
  private readonly options: WriterOptions;

  /**
   * Every option is trusted backend composition and deliberately required:
   * the Account Gateway operator workspace, whether personal accounts may be
   * used, and the signed-in user personal bindings are validated for (none
   * for system writers).
   */
  constructor(
    private readonly prisma: PrismaClient,
    operatorWorkspaceId: string | undefined,
    personalAccountsEnabled: boolean,
    personalWriteActorUserId: string | undefined,
  ) {
    assertOperatorWorkspaceId(operatorWorkspaceId);
    this.options = {
      operatorWorkspaceId,
      personalAccountsEnabled,
      personalWriteActorUserId,
    };
  }

  findLatest(target: ReviewConfigurationTarget) {
    return findLatestReviewConfiguration(this.prisma, target);
  }

  async saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ): Promise<PersistedReviewConfiguration> {
    const [saved] = await this.write(singleWrite(input), true);
    return requireConfiguration(saved!);
  }

  saveNextVersions(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersions"]>[0],
  ): Promise<readonly SavedReviewPolicy[]> {
    return this.write(input, false);
  }

  private async write(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersions"]>[0],
    requireProvider: boolean,
  ): Promise<readonly SavedReviewPolicy[]> {
    for (let attempt = 1; attempt <= MAX_TRANSACTION_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (tx) =>
            saveReviewPolicyWrites(tx, input, this.options, {
              requireProvider,
            }),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (
          isReviewConfigurationWriteConflictError(error) ||
          isPrismaReviewConfigurationWriteConflict(error)
        ) {
          throw new WriteConflict();
        }
        if (
          !isPrismaReviewConfigurationSerializationConflict(error) ||
          attempt === MAX_TRANSACTION_ATTEMPTS
        ) {
          throw error;
        }
      }
    }
    throw new Error("review_configuration_transaction_retry_exhausted");
  }

  deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
    selectionAuthority?: ProviderSelectionAuthority,
  ) {
    return this.prisma.$transaction((tx) =>
      deleteReviewConfigurationTarget(
        tx,
        target,
        expectedVersion,
        selectionAuthority,
      ),
    );
  }
}

export class PrismaReviewConfigurationTransactionRepository implements ReviewConfigurationRepositoryPort {
  private readonly options: WriterOptions;

  /** The same required options as PrismaReviewConfigurationRepository. */
  constructor(
    private readonly prisma: Prisma.TransactionClient,
    operatorWorkspaceId: string | undefined,
    personalAccountsEnabled: boolean,
    personalWriteActorUserId: string | undefined,
  ) {
    assertOperatorWorkspaceId(operatorWorkspaceId);
    this.options = {
      operatorWorkspaceId,
      personalAccountsEnabled,
      personalWriteActorUserId,
    };
  }

  findLatest(target: ReviewConfigurationTarget) {
    return findLatestReviewConfiguration(this.prisma, target);
  }

  async saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ) {
    const [saved] = await saveReviewPolicyWrites(
      this.prisma,
      singleWrite(input),
      this.options,
      { requireProvider: true },
    );
    return requireConfiguration(saved!);
  }

  saveNextVersions(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersions"]>[0],
  ) {
    return saveReviewPolicyWrites(this.prisma, input, this.options, {
      requireProvider: false,
    });
  }

  deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
    selectionAuthority?: ProviderSelectionAuthority,
  ) {
    return deleteReviewConfigurationTarget(
      this.prisma,
      target,
      expectedVersion,
      selectionAuthority,
    );
  }
}

export async function acquireReviewConfigurationWriteScope(
  transaction: Prisma.TransactionClient,
  target: ReviewConfigurationTarget,
): Promise<void> {
  await acquireCurrentScopeGuards(transaction, [
    { ...target, mode: "exclusive" },
  ]);
}

function assertOperatorWorkspaceId(value: string | undefined): void {
  if (
    value !== undefined &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.exec(value)?.[0] !== value
  ) {
    throw new Error("review_configuration_operator_workspace_id_invalid");
  }
}

async function findLatestReviewConfiguration(
  reader: ReviewPolicyReader,
  target: ReviewConfigurationTarget,
): Promise<PersistedReviewConfiguration | null> {
  return readyReviewConfiguration(
    await resolveEffectiveReviewConfiguration(target, {
      policyHeads: new PrismaReviewPolicyHeadReader(reader),
    }),
  );
}

function requireConfiguration(
  saved: SavedReviewPolicy,
): PersistedReviewConfiguration {
  if (!saved.configuration)
    throw new Error("review_provider_selection_required");
  return saved.configuration;
}

function singleWrite(
  input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
): Parameters<ReviewConfigurationRepositoryPort["saveNextVersions"]>[0] {
  const { selectionAuthority, profileDrafts, ...write } = input;
  return {
    workspaceId: input.target.workspaceId,
    writes: [write],
    ...(selectionAuthority ? { selectionAuthority } : {}),
    ...(profileDrafts ? { profileDrafts } : {}),
  };
}

/** Drafts are unique, parse as profile requests and are each referenced. */
function planProfileDrafts(
  drafts: readonly ProviderProfileDraft[],
  writes: readonly PlannedWrite[],
): readonly ProviderProfileDraft[] {
  const referenced = new Set(
    writes.flatMap(
      (write) =>
        write.policy.providers?.map((selection) => selection.profileId) ?? [],
    ),
  );
  if (
    new Set(drafts.map((draft) => draft.draftId)).size !== drafts.length ||
    drafts.some((draft) => !referenced.has(draft.draftId))
  )
    throw new Error("review_configuration_profile_draft_invalid");
  return drafts.map((draft) => ({
    draftId: draft.draftId,
    ...parseProviderProfileDraft({
      credential: draft.credential,
      model: draft.model,
      ...(draft.label === null ? {} : { label: draft.label }),
    }),
  }));
}

function withResolvedDrafts<Document extends ReviewPolicyDocument>(
  document: Document,
  drafts: ReadonlyMap<string, WorkspaceProviderProfile>,
): Document {
  if (!document.providers || drafts.size === 0) return document;
  return withProviderSelections(
    document,
    document.providers.map((selection) => {
      const profile = drafts.get(selection.profileId);
      return profile ? { ...selection, profileId: profile.id } : selection;
    }),
  );
}

type PlannedWrite = Readonly<{
  target: ReviewConfigurationTarget;
  targetKey: string;
  policy: ReviewPolicyDocument;
  expectedVersion?: number | null;
  expectedEffectivePolicyDigest?: string | null;
  implicit?: boolean;
}>;

/** Selections of a head; "unreadable" when a retired head may hold some. */
type StoredSelections = readonly ReviewProviderSelection[] | undefined;

/**
 * Lock order: scope guards for every written scope -> Workspace (selection
 * authority only) -> personal actor and donors -> gateway connection and
 * binding -> ReviewConfiguration rows -> referenced profiles. Profile edits
 * and archives use the same order, so they serialize with these writes.
 */
async function saveReviewPolicyWrites(
  tx: Prisma.TransactionClient,
  input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersions"]>[0],
  options: WriterOptions,
  mode: Readonly<{ requireProvider: boolean }>,
): Promise<readonly SavedReviewPolicy[]> {
  const workspaceId = input.workspaceId;
  let writes = planWrites(workspaceId, input.writes);
  await acquireCurrentScopeGuards(
    tx,
    writes.map((write) => ({ ...write.target, mode: "exclusive" as const })),
  );
  const authority = input.selectionAuthority;
  const lockedAuthority = authority
    ? await lockProviderAuthority(tx, workspaceId, authority)
    : null;
  const drafts = planProfileDrafts(input.profileDrafts ?? [], writes);
  const creatorUserId =
    input.profileCreatorUserId !== undefined
      ? input.profileCreatorUserId
      : (authority?.userId ?? null);
  const personalWriteActorUserId =
    authority?.userId ?? options.personalWriteActorUserId;

  const workspaceKey = reviewConfigurationTargetKey({
    scope: "workspace",
    workspaceId,
  });
  const storedWorkspaceHead = await readActivePolicyHead(tx, {
    workspaceId,
    targetKey: workspaceKey,
  });
  if (
    input.expectedWorkspaceVersion !== undefined &&
    (storedWorkspaceHead?.version ?? null) !== input.expectedWorkspaceVersion
  )
    throw new WriteConflict();
  const workspaceWrite = writes.find(
    (write) => write.target.scope === "workspace",
  );
  const storedWorkspace = storedWorkspaceHead
    ? parseStoredReviewPolicy("workspace", storedWorkspaceHead)
    : null;
  // A generic workspace save may omit the Memory form's setting. Preserve
  // it under the same workspace write lock, before materialization and CAS.
  if (storedWorkspace?.memory !== undefined) {
    writes = writes.map((write) =>
      write.target.scope === "workspace" &&
      (!("memory" in write.policy) || write.policy.memory === undefined)
        ? {
            ...write,
            policy: {
              ...write.policy,
              memory: storedWorkspace.memory,
            } as WorkspaceReviewPolicy,
          }
        : write,
    );
  }
  if (!workspaceWrite && !storedWorkspace) {
    if (storedWorkspaceHead) throw new Error("review_policy_resave_required");
    // The caller writes the workspace document in the same batch and rereads.
    throw new WriteConflict();
  }
  const storedHeads = new Map<string, ReviewPolicyHead | null>();
  for (const write of writes)
    storedHeads.set(
      write.targetKey,
      write.target.scope === "workspace"
        ? storedWorkspaceHead
        : await readActivePolicyHead(tx, {
            workspaceId,
            targetKey: write.targetKey,
          }),
    );
  // A workspace write must keep every sparse repository document resolvable.
  const descendants = workspaceWrite
    ? await readRepositoryHeads(
        tx,
        workspaceId,
        new Set(writes.map((write) => write.targetKey)),
      )
    : [];
  const draftedWorkspace = (writes.find(
    (write) => write.target.scope === "workspace",
  )?.policy ?? storedWorkspace) as WorkspaceReviewPolicy;
  // Workspace memory settings require current admin authority even when the
  // provider selection stays unchanged. The workspace/member locks above hold
  // this decision through the policy write and its version CAS.
  if (
    workspaceWrite &&
    (draftedWorkspace.memory !== undefined ||
      storedWorkspace?.memory !== undefined) &&
    authority &&
    lockedAuthority
  )
    authority.authorize({
      ...lockedAuthority,
      target: workspaceWrite.target,
      profiles: [],
    });
  // Each write's effective selections, still naming drafts by draft ID.
  const selected = writes.map(
    (write) =>
      (write.target.scope === "repository"
        ? write.policy.providers
        : undefined) ??
      draftedWorkspace.providers ??
      [],
  );
  const storedProfiles = await readProviderProfiles(tx, workspaceId, [
    ...selected.flat().map((selection) => selection.profileId),
    ...referencedProfileIds(descendants.map((descendant) => descendant.head)),
  ]);
  const gatewayBindingIds = [
    ...new Set([
      ...drafts.flatMap((draft) =>
        draft.credential.kind === "gateway_binding"
          ? [draft.credential.bindingId]
          : [],
      ),
      ...selected.flat().flatMap((selection) => {
        const credential = storedProfiles.get(selection.profileId)?.credential;
        return credential?.kind === "gateway_binding"
          ? [credential.bindingId]
          : [];
      }),
    ]),
  ];

  // Decide every changed selection before any credential read or personal
  // actor lock can refuse with its own error, so a member always sees the
  // policy's reason and a refused attach never leaves a created profile.
  if (authority && lockedAuthority) {
    const personalBindings = await readPersonalBindingIds(
      tx,
      workspaceId,
      gatewayBindingIds,
    );
    for (const write of writes) {
      const stored = storedHeads.get(write.targetKey) ?? null;
      if (
        sameStoredSelections(
          storedSelections(write.target.scope, stored),
          write.policy.providers,
        )
      )
        continue;
      const facts: SelectedProviderProfileFacts[] = [];
      for (const selection of write.policy.providers ?? []) {
        const draft = drafts.find(
          (candidate) => candidate.draftId === selection.profileId,
        );
        if (draft) {
          facts.push({
            ...(await requestedProfileFacts(tx, {
              workspaceId,
              creatorUserId: authority.userId,
              credential: draft.credential,
              personalBindings,
              repositoryId:
                write.target.scope === "repository"
                  ? write.target.repositoryId
                  : null,
            })),
            draft: true,
          });
          continue;
        }
        const profile = storedProfiles.get(selection.profileId);
        if (!profile || profile.archivedAt !== null)
          throw new ReviewPolicyMaterializationError(
            "review_provider_profile_unavailable",
          );
        facts.push({
          ...providerProfileFacts(profile, personalBindings),
          managedKeyApplied:
            profile.credential.kind === "managed_api_key" &&
            write.target.scope === "repository" &&
            (await managedKeyApplied(tx, {
              workspaceId,
              repositoryId: write.target.repositoryId,
              apiKeyConnectionId: profile.credential.apiKeyConnectionId,
            })),
          draft: false,
        });
      }
      authority.authorize({
        ...lockedAuthority,
        target: write.target,
        profiles: facts,
      });
    }
  }

  // Personal actor and donors, then every binding the result uses, once.
  const lockedPersonalBindings = await lockGatewayBindings(
    tx,
    workspaceId,
    gatewayBindingIds,
    personalWriteActorUserId,
    options,
  );
  const draftProfiles = new Map<string, WorkspaceProviderProfile>();
  for (const draft of drafts) {
    const { profile } = await findOrCreateProviderProfileIn(tx, {
      workspaceId,
      creatorUserId,
      auditActor:
        authority?.auditActor ?? input.audit?.actor ?? "system:review-config",
      source: await resolveProviderCredential(tx, {
        workspaceId,
        credential: draft.credential,
        personalBindings: lockedPersonalBindings,
        options,
      }),
      model: draft.model,
      label: draft.label,
    });
    draftProfiles.set(draft.draftId, profile);
  }
  const resolvedWrites = writes.map((write) => ({
    ...write,
    policy: withResolvedDrafts(write.policy, draftProfiles),
  }));
  const nextWorkspace = withResolvedDrafts(
    draftedWorkspace,
    draftProfiles,
  ) as WorkspaceReviewPolicy;
  const profiles = new Map(storedProfiles);
  for (const profile of draftProfiles.values())
    profiles.set(profile.id, profile);

  const effective = resolvedWrites.map((write) => ({
    write,
    resolved: materializeWrite(write, () =>
      resolveEffectiveReviewPolicy({
        target: write.target,
        workspace: nextWorkspace,
        repository:
          write.target.scope === "repository"
            ? (write.policy as RepositoryReviewPolicy)
            : null,
        profiles,
      }),
    ),
  }));
  for (const descendant of descendants) {
    const policy = parseStoredReviewPolicy("repository", descendant.head);
    if (!policy) continue;
    try {
      resolveEffectiveReviewPolicy({
        target: {
          scope: "repository",
          workspaceId,
          repositoryId: descendant.repositoryId,
        },
        workspace: nextWorkspace,
        repository: policy,
        profiles,
      });
    } catch (error) {
      if (
        error instanceof ReviewPolicyMaterializationError &&
        error.code === "review_execution_limits_incompatible"
      )
        throw new Error("review_inherited_execution_limits_incompatible", {
          cause: error,
        });
      throw error;
    }
  }
  // Single-document saves promise a usable configuration.
  if (mode.requireProvider && effective.some(({ resolved }) => !resolved))
    throw new Error("review_provider_selection_required");
  for (const { write, resolved } of effective) {
    if (write.expectedEffectivePolicyDigest === undefined) continue;
    const digest = resolved
      ? effectiveReviewPolicyDigest(resolved.config)
      : null;
    if (digest !== write.expectedEffectivePolicyDigest)
      throw new WriteConflict();
  }
  await assertGatewaySelections(tx, {
    workspaceId,
    configs: effective.flatMap(({ resolved }) =>
      resolved ? [resolved.config] : [],
    ),
    options: { ...options, personalWriteActorUserId },
  });

  const saved: SavedReviewPolicy[] = [];
  const savedHeads = new Map<string, ReviewPolicyHead>();
  for (const { write, resolved } of effective) {
    const configuration = await tx.reviewConfiguration.upsert({
      where: {
        workspaceId_targetKey: { workspaceId, targetKey: write.targetKey },
      },
      update: {
        repositoryId:
          write.target.scope === "repository"
            ? write.target.repositoryId
            : null,
      },
      create: {
        workspaceId,
        repositoryId:
          write.target.scope === "repository"
            ? write.target.repositoryId
            : null,
        targetKey: write.targetKey,
      },
      select: { id: true, active: true },
    });
    const latest = await tx.reviewConfigurationVersion.findFirst({
      where: { configurationId: configuration.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const currentVersion = configuration.active
      ? (latest?.version ?? null)
      : null;
    if (
      write.expectedVersion !== undefined &&
      currentVersion !== write.expectedVersion
    ) {
      throw new WriteConflict();
    }
    if (!configuration.active) {
      await tx.reviewConfiguration.update({
        where: { id: configuration.id },
        data: { active: true },
      });
    }
    const version = (latest?.version ?? 0) + 1;
    const workspaceVersion =
      write.target.scope === "workspace"
        ? version
        : (savedHeads.get(workspaceKey)?.version ??
          storedWorkspaceHead?.version);
    if (workspaceVersion === undefined) throw new WriteConflict();
    const head = await tx.reviewConfigurationVersion.create({
      data: {
        configurationId: configuration.id,
        workspaceId,
        version,
        schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        policyJson: canonicalJson(write.policy),
      },
      select: { version: true, schemaVersion: true, policyJson: true },
    });
    savedHeads.set(write.targetKey, head);
    const savedPolicy: SavedReviewPolicy = {
      target: write.target,
      version,
      configuration: resolved
        ? persistedReviewConfiguration({
            config: resolved.config,
            selections: resolved.selections,
            policy: write.policy,
            workspaceVersion,
            repositoryVersion:
              write.target.scope === "repository" ? version : null,
          })
        : null,
    };
    saved.push(savedPolicy);
    if (input.audit && !write.implicit)
      await recordAuditEvent(
        {
          workspaceId,
          actor: input.audit.actor,
          action: input.audit.action,
          targetType: write.target.scope,
          targetId:
            write.target.scope === "repository"
              ? write.target.repositoryId
              : workspaceId,
          metadata: {
            ...input.audit.metadata,
            ...input.audit.metadataForSavedConfiguration?.(
              savedPolicy.configuration,
            ),
            version,
            providerSelected: resolved !== null,
          },
        },
        { auditLog: new PrismaAuditLogRepository(tx) },
      );
  }
  // Last in the lock order: a profile edited or archived after this
  // snapshot fails the lock as a serialization conflict and is reread.
  await lockSelectedProfiles(tx, workspaceId, [...profiles.keys()]);
  return saved;
}

/**
 * A write whose effective result the caller validated no longer materializes
 * only when a concurrent profile edit or archive committed after that
 * validation; the caller rereads and validates again, so the refusal reaches
 * it with the reason, never as a raw parse error.
 */
function materializeWrite<Result>(
  write: PlannedWrite,
  resolve: () => Result,
): Result {
  try {
    return resolve();
  } catch (error) {
    if (
      error instanceof ReviewPolicyMaterializationError &&
      write.expectedEffectivePolicyDigest !== undefined
    )
      throw new WriteConflict();
    throw error;
  }
}

function planWrites(
  workspaceId: string,
  writes: readonly ReviewPolicyWrite[],
): readonly PlannedWrite[] {
  if (writes.length === 0 || writes.length > 101)
    throw new Error("review_configuration_target_invalid");
  const planned = writes.map((write) => {
    const target = snapshotTarget(write.target);
    if (target.workspaceId !== workspaceId)
      throw new Error("review_configuration_target_invalid");
    return {
      target,
      targetKey: reviewConfigurationTargetKey(target),
      policy: parseReviewPolicyDocument(target.scope, write.policy),
      ...(write.expectedVersion === undefined
        ? {}
        : { expectedVersion: write.expectedVersion }),
      ...(write.expectedEffectivePolicyDigest === undefined
        ? {}
        : {
            expectedEffectivePolicyDigest: write.expectedEffectivePolicyDigest,
          }),
      ...(write.implicit ? { implicit: true } : {}),
    };
  });
  if (new Set(planned.map((write) => write.targetKey)).size !== planned.length)
    throw new Error("review_configuration_target_invalid");
  // The workspace document is written first so repositories resolve against it.
  return [...planned].sort(
    (left, right) =>
      Number(left.target.scope === "repository") -
      Number(right.target.scope === "repository"),
  );
}

async function readRepositoryHeads(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  excludedTargetKeys: ReadonlySet<string>,
): Promise<
  readonly Readonly<{ repositoryId: string; head: ReviewPolicyHead }>[]
> {
  const records = await tx.reviewConfiguration.findMany({
    where: { workspaceId, repositoryId: { not: null }, active: true },
    orderBy: { id: "asc" },
    select: {
      targetKey: true,
      repositoryId: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { version: true, schemaVersion: true, policyJson: true },
      },
    },
  });
  return records.flatMap((record) =>
    record.repositoryId &&
    record.versions[0] &&
    !excludedTargetKeys.has(record.targetKey)
      ? [{ repositoryId: record.repositoryId, head: record.versions[0] }]
      : [],
  );
}

const unreadableSelections = Symbol("unreadable_selections");

function storedSelections(
  scope: ReviewConfigurationTarget["scope"],
  head: ReviewPolicyHead | null,
): StoredSelections | typeof unreadableSelections {
  if (!head) return undefined;
  const policy = parseStoredReviewPolicy(scope, head);
  return policy ? policy.providers : unreadableSelections;
}

function sameStoredSelections(
  stored: StoredSelections | typeof unreadableSelections,
  next: StoredSelections,
): boolean {
  return (
    stored !== unreadableSelections && sameProviderSelections(stored, next)
  );
}

async function lockSelectedProfiles(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  profileIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(profileIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw`
    SELECT "id" FROM "WorkspaceProviderProfile"
    WHERE "workspaceId" = ${workspaceId} AND "id" = ANY(${ids}::text[])
    ORDER BY "id" FOR SHARE`;
}

async function deleteReviewConfigurationTarget(
  prisma: Prisma.TransactionClient,
  target: ReviewConfigurationTarget,
  expectedVersion?: number | null,
  selectionAuthority?: ProviderSelectionAuthority,
): Promise<boolean> {
  await acquireReviewConfigurationWriteScope(prisma, target);
  const lockedAuthority = selectionAuthority
    ? await lockProviderAuthority(
        prisma,
        target.workspaceId,
        selectionAuthority,
      )
    : null;
  const scope = {
    workspaceId: target.workspaceId,
    targetKey: reviewConfigurationTargetKey(target),
  };
  const current = await readActivePolicyHead(prisma, scope);
  if (
    expectedVersion !== undefined &&
    (current?.version ?? null) !== expectedVersion
  ) {
    throw new WriteConflict();
  }
  if (
    selectionAuthority &&
    lockedAuthority &&
    !sameStoredSelections(storedSelections(target.scope, current), undefined)
  )
    selectionAuthority.authorize({
      ...lockedAuthority,
      target,
      profiles: [],
    });
  const result = await prisma.reviewConfiguration.updateMany({
    where: { ...scope, active: true },
    data: { active: false },
  });
  return result.count > 0;
}

function snapshotTarget(
  target: ReviewConfigurationTarget,
): ReviewConfigurationTarget {
  if (
    typeof target.workspaceId !== "string" ||
    !target.workspaceId ||
    (target.scope === "repository" && !target.repositoryId)
  ) {
    throw new Error("review_configuration_target_invalid");
  }
  return target.scope === "repository"
    ? {
        scope: "repository",
        workspaceId: target.workspaceId,
        repositoryId: target.repositoryId,
      }
    : { scope: "workspace", workspaceId: target.workspaceId };
}

/**
 * Locks the personal actor and donors, then the gateway bindings of the
 * configurations, and refuses a binding whose account profile changed since
 * the provider profile captured it. Returns the user-owned bindings.
 */
async function assertGatewaySelections(
  prisma: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly configs: readonly ReviewConfiguration[];
    readonly options: WriterOptions;
  },
): Promise<ReadonlySet<string>> {
  const { workspaceId, options } = input;
  const providers = input.configs.flatMap((config) =>
    config.providers.flatMap((provider) =>
      provider.authMode === "codex_account_gateway" ? [provider] : [],
    ),
  );
  const bindingIds = [
    ...new Set(providers.map((provider) => provider.gatewayBindingId)),
  ];
  const personalBindings = await lockGatewayBindings(
    prisma,
    workspaceId,
    bindingIds,
    options.personalWriteActorUserId,
    options,
  );
  for (const provider of providers) {
    const profileRef = await readSelectableGatewayProfileRef(prisma, {
      workspaceId,
      bindingId: provider.gatewayBindingId,
      personalBindings,
      operatorWorkspaceId: options.operatorWorkspaceId,
      personalAccountsEnabled: options.personalAccountsEnabled,
    });
    if (profileRef !== provider.gatewayProfileRef)
      throw new Error("review_configuration_gateway_profile_mismatch");
  }
  return personalBindings;
}
