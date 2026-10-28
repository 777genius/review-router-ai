/**
 * One-time move of stored review policies to schema 4 (provider profiles and
 * selections). Per workspace, in one Serializable transaction and through the
 * same find-or-create path the app uses, it creates the profiles the schema 3
 * heads need, appends a schema 4 version for each convertible head (the
 * workspace first, every scope guard declared up front) and records what the
 * installed workflows of configured repositories were rendered for.
 *
 * Already converted documents are skipped, so a rerun changes nothing. A head
 * it cannot convert keeps its schema 3 version and fails closed in the app
 * (`review_policy_resave_required`); so does a provider list with a row the
 * app would refuse (an unavailable or personal Gateway binding, a changed
 * account profile, OpenRouter without a managed key), which is reported as a
 * warning while the rest of the workspace converts. A rotating workspace
 * default cannot stay a default: each repository that inherited it gets its
 * own rotating selection where the deployment allows rotating for it. A
 * target that still fails is found, reported and left unconverted.
 * `--dry-run` runs the same transactions and rolls them back.
 *
 * Preflight: the database must have applied the current 000145. It was
 * corrected in place before release, and `prisma migrate deploy` does not
 * reapply a migration whose checksum changed, so a database that applied the
 * earlier text is refused and must be recreated.
 *
 * Order for each environment (the Database Release Rule, "Provider registry
 * cutover"): take a pg_dump, stop every old web, API and worker process,
 * apply the migrations (000145 and 000146), run this script, start the new
 * code. Never run it against a production database without the owner's
 * explicit instruction.
 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readPersonalAccountSharingEnabled } from "../packages/features/provider-accounts/src/composition.js";
import {
  lockPersonalWriteActor,
  readSelectableGatewayProfileRef,
} from "../packages/features/review-config/src/infrastructure/prisma/prisma-gateway-binding-authority.js";
import { readPersonalBindingIds } from "../packages/features/review-config/src/infrastructure/prisma/prisma-provider-profile-writes.js";
import {
  canonicalJson,
  managedApiKeyServes,
  parseRepositoryReviewPolicy,
  parseReviewConfigurationStrict,
  parseWorkspaceReviewPolicy,
  PrismaReviewConfigurationTransactionRepository,
  PrismaReviewPolicyHeadReader,
  providerCredentialRequestFor,
  REVIEW_POLICY_SCHEMA_VERSION,
  resolveEffectiveReviewConfigurations,
  reviewProviderConfigurationSchema,
  reviewProviderSelectionFor,
  runReviewConfigurationTransaction,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  workspaceReviewSettingsFromConfiguration,
  type ManagedApiKeyFacts,
  type ProviderProfileDraft,
  type ReviewConfiguration,
  type ReviewConfigurationTarget,
  type ReviewPolicyHead,
  type ReviewPolicyWrite,
  type ReviewProviderConfiguration,
  type ReviewProviderSelection,
} from "../packages/features/review-config/src/index.js";
import { requiredWorkflowRequirement } from "../packages/features/workflow-provisioning/src/index.js";
import { isCodexRotatingOAuthAllowedForRepository } from "../packages/platform/config/src/index.js";
import { createPrismaClient } from "../packages/platform/db/src/index.js";

export const PROVIDER_PROFILE_MIGRATION_ACTOR =
  "system:provider-profile-migration";

export type ProviderProfileMigrationOptions = Readonly<{
  /** Runs every workspace transaction and rolls it back. */
  dryRun: boolean;
  operatorWorkspaceId: string | undefined;
  personalAccountsEnabled: boolean;
  /** The deployment's rule for rotating Codex on one repository. */
  rotatingAllowed: (repositoryFullName: string) => boolean;
  /** Limits the run to these workspaces; every workspace when omitted. */
  workspaceIds?: readonly string[];
}>;

/** A target the migration left unconverted because its write failed. */
export type TargetMigrationFailure = Readonly<{
  target: string;
  error: string;
}>;

export type WorkspaceMigrationReport = Readonly<{
  workspaceId: string;
  /**
   * `converted` wrote at least one document or requirement, `unchanged` found
   * nothing to do, `skipped` had no user to create profiles for or is being
   * deleted, and `failed` rolled back because its workspace document failed.
   */
  status: "converted" | "unchanged" | "skipped" | "failed";
  creatorUserId: string | null;
  /** Target keys that received a schema 4 version. */
  converted: readonly string[];
  profilesCreated: number;
  installedRequirementsFilled: number;
  warnings: readonly string[];
  /** Targets whose write failed and stay on their stored version. */
  failures: readonly TargetMigrationFailure[];
  error?: string;
}>;

/** The database cannot be migrated as it is; nothing was read or written. */
export class ProviderProfileMigrationPreflightError extends Error {
  constructor(
    code: string,
    readonly detail: string,
  ) {
    super(code);
    this.name = "ProviderProfileMigrationPreflightError";
  }
}

const WORKSPACE_PROVIDER_PROFILES_MIGRATION =
  "000145_workspace_provider_profiles";

/**
 * Refuses a database that applied an earlier text of 000145: the migration
 * was corrected in place, and `prisma migrate deploy` reports no pending
 * migration for a changed checksum. The expected checksum is Prisma's, the
 * SHA-256 of this checkout's migration file (pinned by the schema handoff
 * policy test).
 */
export async function assertProviderProfileMigrationSchema(
  prisma: Pick<PrismaClient, "$queryRaw">,
): Promise<void> {
  const expected = createHash("sha256")
    .update(
      await readFile(
        new URL(
          `../packages/platform/db/prisma/migrations/${WORKSPACE_PROVIDER_PROFILES_MIGRATION}/migration.sql`,
          import.meta.url,
        ),
      ),
    )
    .digest("hex");
  // The migration ledger is not part of the Prisma schema.
  const applied = await prisma.$queryRaw<readonly { checksum: string }[]>`
    SELECT "checksum" FROM "_prisma_migrations"
    WHERE "migration_name" = ${WORKSPACE_PROVIDER_PROFILES_MIGRATION}
      AND "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL`;
  if (applied.length === 0)
    throw new ProviderProfileMigrationPreflightError(
      "provider_profile_migration_schema_missing",
      `${WORKSPACE_PROVIDER_PROFILES_MIGRATION} is not applied; run prisma migrate deploy first`,
    );
  const stale = applied.find((row) => row.checksum !== expected);
  if (stale)
    throw new ProviderProfileMigrationPreflightError(
      "provider_profile_migration_stale_000145",
      `this database applied an earlier ${WORKSPACE_PROVIDER_PROFILES_MIGRATION} (checksum ${stale.checksum}, expected ${expected}); prisma migrate deploy does not reapply it. Recreate the development database (or restore a dump taken before 000145) and apply the migrations again`,
    );
}

export async function migrateProviderProfiles(
  prisma: PrismaClient,
  options: ProviderProfileMigrationOptions,
): Promise<readonly WorkspaceMigrationReport[]> {
  await assertProviderProfileMigrationSchema(prisma);
  const workspaces = await prisma.workspace.findMany({
    where: options.workspaceIds
      ? { id: { in: [...options.workspaceIds] } }
      : {},
    orderBy: { id: "asc" },
    select: { id: true, personalOwnerUserId: true, deletionState: true },
  });
  const reports: WorkspaceMigrationReport[] = [];
  for (const workspace of workspaces)
    reports.push(
      workspace.deletionState === "active"
        ? await migrateWorkspace(prisma, workspace, options)
        : {
            ...emptyReport(workspace.id, "skipped"),
            warnings: [
              `workspace is being deleted (${workspace.deletionState}); left unconverted`,
            ],
          },
    );
  return reports;
}

function emptyReport(
  workspaceId: string,
  status: WorkspaceMigrationReport["status"],
): WorkspaceMigrationReport {
  return {
    workspaceId,
    status,
    creatorUserId: null,
    converted: [],
    profilesCreated: 0,
    installedRequirementsFilled: 0,
    warnings: [],
    failures: [],
  };
}

/** Which repository documents one transaction writes. */
type TargetSelection =
  | Readonly<{ kind: "all"; excluded: ReadonlySet<string> }>
  /** Plans and writes nothing; reports the targets it would write. */
  | Readonly<{ kind: "plan" }>
  /** The workspace document and at most this repository document. */
  | Readonly<{ kind: "only"; target: string | null }>;

type WorkspacePass = WorkspaceMigrationReport &
  Readonly<{ planned: readonly string[] }>;

/**
 * A workspace's Serializable pass fails spuriously while other workspaces
 * write the same tables (PostgreSQL tracks reads per index page, not per
 * row), so this one-time batch retries longer than an interactive write.
 */
const SERIALIZABLE_PASS_ATTEMPTS = 10;

class Rollback extends Error {
  constructor(readonly report: WorkspacePass) {
    super("provider_profile_migration_rollback");
  }
}

async function migrateWorkspace(
  prisma: PrismaClient,
  workspace: {
    readonly id: string;
    readonly personalOwnerUserId: string | null;
  },
  options: ProviderProfileMigrationOptions,
): Promise<WorkspaceMigrationReport> {
  const pass = async (selection: TargetSelection, rollback: boolean) => {
    try {
      return await runReviewConfigurationTransaction(
        prisma,
        async (tx) => {
          const report = await migrateWorkspaceIn(
            tx,
            workspace,
            options,
            selection,
          );
          if (rollback) throw new Rollback(report);
          return report;
        },
        {
          isolationLevel: "Serializable",
          attempts: SERIALIZABLE_PASS_ATTEMPTS,
        },
      );
    } catch (error) {
      if (error instanceof Rollback) return error.report;
      throw error;
    }
  };
  const report = ({ planned: _planned, ...rest }: WorkspacePass) => {
    void _planned;
    return rest;
  };
  try {
    return report(
      await pass({ kind: "all", excluded: new Set() }, options.dryRun),
    );
  } catch (error) {
    // Find the failing targets, each alone with the workspace document, in
    // transactions that roll back, then convert everything else.
    let plan: WorkspacePass;
    try {
      plan = await pass({ kind: "plan" }, true);
    } catch (planError) {
      return failedReport(workspace.id, null, [
        { target: "workspace:default", error: messageOf(planError) },
      ]);
    }
    const failures: TargetMigrationFailure[] = [];
    try {
      await pass({ kind: "only", target: null }, true);
    } catch (workspaceError) {
      return failedReport(workspace.id, plan.creatorUserId, [
        { target: "workspace:default", error: messageOf(workspaceError) },
      ]);
    }
    for (const target of plan.planned) {
      if (target === "workspace:default") continue;
      try {
        await pass({ kind: "only", target }, true);
      } catch (targetError) {
        failures.push({ target, error: messageOf(targetError) });
      }
    }
    if (failures.length === 0)
      return failedReport(workspace.id, plan.creatorUserId, [
        { target: "workspace", error: messageOf(error) },
      ]);
    try {
      const converted = await pass(
        {
          kind: "all",
          excluded: new Set(failures.map((failure) => failure.target)),
        },
        options.dryRun,
      );
      return {
        ...report(converted),
        warnings: [
          ...converted.warnings,
          ...failures.map(
            (failure) =>
              `${failure.target}: write failed (${failure.error}); left unconverted`,
          ),
        ],
        failures,
      };
    } catch (retryError) {
      return failedReport(workspace.id, plan.creatorUserId, [
        ...failures,
        { target: "workspace", error: messageOf(retryError) },
      ]);
    }
  }
}

function failedReport(
  workspaceId: string,
  creatorUserId: string | null,
  failures: readonly TargetMigrationFailure[],
): WorkspaceMigrationReport {
  return {
    ...emptyReport(workspaceId, "failed"),
    creatorUserId,
    failures,
    error: failures
      .map((failure) => `${failure.target}: ${failure.error}`)
      .join("; "),
  };
}

/** A short reason: validation issues by message, other errors by message. */
function messageOf(error: unknown): string {
  const issues = (error as { readonly issues?: unknown } | null)?.issues;
  if (Array.isArray(issues) && issues.length > 0)
    return issues
      .map((issue) => String((issue as { message?: unknown }).message))
      .join("; ");
  return error instanceof Error ? error.message : String(error);
}

async function migrateWorkspaceIn(
  tx: Prisma.TransactionClient,
  workspace: {
    readonly id: string;
    readonly personalOwnerUserId: string | null;
  },
  options: ProviderProfileMigrationOptions,
  selection: TargetSelection,
): Promise<WorkspacePass> {
  const workspaceId = workspace.id;
  const warnings: string[] = [];
  const heads = await new PrismaReviewPolicyHeadReader(
    tx,
  ).readWorkspacePolicyHeads(workspaceId);
  const creatorUserId = await profileCreator(tx, workspace);
  const legacyWorkspace = readLegacyWorkspace(heads.workspace, warnings);
  const legacyRepositories = new Map<string, LegacyRepository>();
  // Heads in no readable format: their repositories had no schema 3
  // configuration to inherit.
  const unreadableRepositories = new Set<string>();
  for (const [repositoryId, head] of heads.repositories) {
    if (head.schemaVersion === STORED_REVIEW_POLICY_SCHEMA_VERSION) continue;
    const override = readLegacyRepository(repositoryId, head, warnings);
    if (override) legacyRepositories.set(repositoryId, override);
    else unreadableRepositories.add(repositoryId);
  }
  const pending = legacyWorkspace !== undefined || legacyRepositories.size > 0;
  if (pending && !creatorUserId) {
    return {
      ...emptyReport(workspaceId, "skipped"),
      warnings: [
        ...warnings,
        "no personal owner, owner or admin to create the profiles; workspace left unconverted",
      ],
      planned: [],
    };
  }
  const workspaceConfig = legacyWorkspace?.config ?? null;
  const drafts = new DraftPlan(tx, {
    workspaceId,
    creatorUserId,
    options,
    credentials: await credentialFacts(tx, workspaceId),
    warnings,
  });
  const writes: ReviewPolicyWrite[] = [];
  const workspaceTarget = { scope: "workspace" as const, workspaceId };
  const repositoryTarget = (repositoryId: string) => ({
    scope: "repository" as const,
    workspaceId,
    repositoryId,
  });
  const repositories = await tx.repositoryConnection.findMany({
    where: { workspaceId },
    orderBy: { id: "asc" },
    select: { id: true, fullName: true },
  });
  // Repositories that review with the workspace default: no own providers.
  const inheriting = repositories.filter(
    (repository) =>
      !unreadableRepositories.has(repository.id) &&
      !legacyRepositories.get(repository.id)?.override.providers &&
      !currentRepositorySelects(heads.repositories.get(repository.id)),
  );
  // A rotating default gives each inheriting repository its own selection.
  const inheritedSelections = new Map<
    string,
    readonly ReviewProviderSelection[]
  >();

  if (legacyWorkspace) {
    const defaultProviders = legacyWorkspace.config.providers;
    const rotatingDefault = defaultProviders.some(
      (provider) => provider.authMode === "codex_subscription_oauth_rotating",
    );
    const selections = rotatingDefault
      ? null
      : await drafts.selections(defaultProviders, workspaceTarget);
    writes.push({
      target: workspaceTarget,
      expectedVersion: legacyWorkspace.version,
      policy: parseWorkspaceReviewPolicy({
        schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        ...(selections ? { providers: selections } : {}),
        ...workspaceReviewSettingsFromConfiguration(legacyWorkspace.config),
      }),
    });
    if (rotatingDefault) {
      warnings.push(
        "workspace:default: rotating Codex cannot be a workspace default; stored without a default provider",
      );
      const disabled: string[] = [];
      for (const repository of inheriting) {
        const target = repositoryTarget(repository.id);
        if (!selected(selection, targetKey(target))) continue;
        if (!options.rotatingAllowed(repository.fullName)) {
          disabled.push(repository.id);
          continue;
        }
        const own = await drafts.selections(defaultProviders, target);
        if (own) inheritedSelections.set(repository.id, own);
      }
      if (disabled.length)
        warnings.push(
          `rotating Codex is not allowed for these repositories; they now select no provider: ${disabled.join(", ")}`,
        );
    } else if (!selections && inheriting.length) {
      warnings.push(
        `repositories that inherited the workspace default now select no provider: ${inheriting.map((repository) => repository.id).join(", ")}`,
      );
    }
  } else if (legacyRepositories.size > 0 && !heads.workspace) {
    warnings.push(
      "repository policies without a workspace policy were left unconverted",
    );
    legacyRepositories.clear();
  }

  for (const [repositoryId, legacy] of legacyRepositories) {
    const target = repositoryTarget(repositoryId);
    if (!selected(selection, targetKey(target))) continue;
    if (
      !workspaceConfig &&
      heads.workspace?.schemaVersion !== STORED_REVIEW_POLICY_SCHEMA_VERSION
    ) {
      warnings.push(
        `repo:${repositoryId}: workspace policy is not readable; left unconverted`,
      );
      continue;
    }
    // An override schema 3 could not apply is left as it is, never repaired.
    if (
      workspaceConfig &&
      !legacyEffectiveConfiguration(workspaceConfig, legacy.raw)
    ) {
      warnings.push(
        `repo:${repositoryId}: the schema 3 override does not form a valid configuration with the workspace policy; left unconverted`,
      );
      continue;
    }
    const selections = legacy.override.providers
      ? await drafts.selections(legacy.override.providers, target)
      : inheritedSelections.get(repositoryId);
    // A provider list that cannot be kept as a whole is not converted.
    if (selections === null) continue;
    writes.push({
      target,
      expectedVersion: legacy.version,
      policy: parseRepositoryReviewPolicy({
        schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        ...(selections ? { providers: selections } : {}),
        ...legacy.settings,
      }),
    });
  }
  // Inheriting repositories without a document of their own.
  for (const [repositoryId, selections] of inheritedSelections) {
    if (heads.repositories.has(repositoryId)) continue;
    writes.push({
      target: repositoryTarget(repositoryId),
      expectedVersion: null,
      policy: parseRepositoryReviewPolicy({
        schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        providers: selections,
      }),
    });
  }
  const planned = writes.map((write) => targetKey(write.target));
  if (selection.kind === "plan")
    return {
      ...emptyReport(workspaceId, "unchanged"),
      creatorUserId,
      warnings,
      planned,
    };

  const profilesBefore = await tx.workspaceProviderProfile.count({
    where: { workspaceId },
  });
  const saved = writes.length
    ? await new PrismaReviewConfigurationTransactionRepository(
        tx,
        options.operatorWorkspaceId,
        options.personalAccountsEnabled,
        creatorUserId ?? undefined,
      ).saveNextVersions({
        workspaceId,
        writes,
        profileDrafts: drafts.forWrites(writes),
        profileCreatorUserId: creatorUserId,
        audit: {
          actor: PROVIDER_PROFILE_MIGRATION_ACTOR,
          action: "review_config.migrated_to_provider_profiles",
        },
      })
    : [];
  const profilesCreated =
    (await tx.workspaceProviderProfile.count({ where: { workspaceId } })) -
    profilesBefore;

  // The schema 3 configuration each target reviewed with; null when the
  // workspace was not on schema 3.
  const legacyEffective = (target: ReviewConfigurationTarget) => {
    if (
      !workspaceConfig ||
      (target.scope === "repository" &&
        unreadableRepositories.has(target.repositoryId))
    )
      return null;
    const legacy =
      target.scope === "repository"
        ? legacyRepositories.get(target.repositoryId)
        : undefined;
    return legacy
      ? legacyEffectiveConfiguration(workspaceConfig, legacy.raw)
      : workspaceConfig;
  };
  for (const result of saved) {
    const expected = result.configuration && legacyEffective(result.target);
    if (
      expected &&
      canonicalJson(expected) !== canonicalJson(result.configuration!.config)
    )
      warnings.push(
        `${targetKey(result.target)}: the schema 4 configuration differs from schema 3`,
      );
  }
  const installedRequirementsFilled = await fillInstalledRequirements(tx, {
    workspaceId,
    legacyEffective: (repositoryId) =>
      legacyEffective(repositoryTarget(repositoryId)),
    warnings,
  });

  const converted = saved.map((result) => targetKey(result.target));
  return {
    ...emptyReport(
      workspaceId,
      converted.length > 0 || installedRequirementsFilled > 0
        ? "converted"
        : "unchanged",
    ),
    creatorUserId,
    converted,
    profilesCreated,
    installedRequirementsFilled,
    warnings,
    planned,
  };
}

/** Whether a repository document of this target is written by the pass. */
function selected(selection: TargetSelection, target: string): boolean {
  switch (selection.kind) {
    case "all":
      return !selection.excluded.has(target);
    case "plan":
      return true;
    case "only":
      return selection.target === target;
  }
}

function targetKey(target: ReviewConfigurationTarget): string {
  return target.scope === "workspace"
    ? "workspace:default"
    : `repo:${target.repositoryId}`;
}

/**
 * The personal owner, else the earliest owner, else the earliest admin. It
 * creates the profiles and is the personal actor their bindings validate for.
 */
async function profileCreator(
  tx: Prisma.TransactionClient,
  workspace: {
    readonly id: string;
    readonly personalOwnerUserId: string | null;
  },
): Promise<string | null> {
  if (workspace.personalOwnerUserId) return workspace.personalOwnerUserId;
  for (const role of ["owner", "admin"] as const) {
    const member = await tx.workspaceMember.findFirst({
      where: { workspaceId: workspace.id, role, userId: { not: null } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { userId: true },
    });
    if (member?.userId) return member.userId;
  }
  return null;
}

type LegacyHead<Value> = Value & Readonly<{ version: number }>;

/** A schema 3 workspace head; undefined when there is none to convert. */
function readLegacyWorkspace(
  head: ReviewPolicyHead | null,
  warnings: string[],
): LegacyHead<{ config: ReviewConfiguration }> | undefined {
  if (!head || head.schemaVersion === STORED_REVIEW_POLICY_SCHEMA_VERSION)
    return undefined;
  if (head.schemaVersion !== REVIEW_POLICY_SCHEMA_VERSION || !head.policyJson) {
    warnings.push(
      `workspace:default: schema ${head.schemaVersion} is not convertible; left unconverted`,
    );
    return undefined;
  }
  try {
    return {
      version: head.version,
      config: parseReviewConfigurationStrict(JSON.parse(head.policyJson)),
    };
  } catch {
    warnings.push(
      "workspace:default: unreadable schema 3 policy; left unconverted",
    );
    return undefined;
  }
}

type LegacyRepository = LegacyHead<{
  raw: Record<string, unknown>;
  override: { readonly providers?: readonly ReviewProviderConfiguration[] };
  /** The override's own settings in the schema 4 form. */
  settings: Record<string, unknown>;
}>;

/** A readable schema 3 repository override of a not yet converted head. */
function readLegacyRepository(
  repositoryId: string,
  head: ReviewPolicyHead,
  warnings: string[],
): LegacyRepository | undefined {
  if (head.schemaVersion !== REVIEW_POLICY_SCHEMA_VERSION || !head.policyJson) {
    warnings.push(
      `repo:${repositoryId}: schema ${head.schemaVersion} is not convertible; left unconverted`,
    );
    return undefined;
  }
  try {
    const raw = JSON.parse(head.policyJson) as Record<string, unknown>;
    const {
      schemaVersion: _schemaVersion,
      providers,
      execution,
      ...settings
    } = raw;
    // The provider limit is derived from the selections in schema 4.
    const { providerLimit: _providerLimit, ...storedExecution } = (execution ??
      {}) as Record<string, unknown>;
    void _schemaVersion;
    void _providerLimit;
    const schema4Settings = {
      ...settings,
      ...(execution === undefined ? {} : { execution: storedExecution }),
    };
    // Validates the settings exactly as the app reads them.
    parseRepositoryReviewPolicy({
      schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
      ...schema4Settings,
    });
    return {
      version: head.version,
      raw,
      // The schema 3 merge validates the rows together with the settings.
      override:
        providers === undefined
          ? {}
          : {
              providers: reviewProviderConfigurationSchema
                .array()
                .min(1)
                .max(16)
                .parse(providers),
            },
      settings: schema4Settings,
    };
  } catch {
    warnings.push(
      `repo:${repositoryId}: unreadable schema 3 override; left unconverted`,
    );
    return undefined;
  }
}

/** Whether a current repository head names its own providers. */
function currentRepositorySelects(head: ReviewPolicyHead | undefined): boolean {
  if (!head?.policyJson) return false;
  if (head.schemaVersion !== STORED_REVIEW_POLICY_SCHEMA_VERSION) return false;
  return (
    (JSON.parse(head.policyJson) as { readonly providers?: unknown })
      .providers !== undefined
  );
}

async function credentialFacts(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<ManagedApiKeyFacts> {
  const [keys, links] = await Promise.all([
    tx.providerApiKeyConnection.findMany({
      where: { workspaceId },
      select: { id: true, providerType: true },
    }),
    tx.providerApiKeyRepositoryLink.findMany({
      where: { workspaceId, appliedKeyVersion: { not: null } },
      select: { providerApiKeyConnectionId: true, repositoryId: true },
    }),
  ]);
  const applied = new Set(
    links.map(
      (link) => `${link.repositoryId}:${link.providerApiKeyConnectionId}`,
    ),
  );
  return {
    keyIds: new Map(keys.map((key) => [key.providerType, key.id])),
    applied: (repositoryId, keyId) => applied.has(`${repositoryId}:${keyId}`),
  };
}

/**
 * Draft profiles of the provider lists a pass converts, checked with the
 * write path's own rules before the write so that a row the app would refuse
 * is reported instead of rolling back the whole workspace.
 */
class DraftPlan {
  private readonly drafts: ProviderProfileDraft[] = [];
  private readonly gatewayChecks = new Map<string, string | null>();

  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly input: Readonly<{
      workspaceId: string;
      creatorUserId: string | null;
      options: ProviderProfileMigrationOptions;
      credentials: ManagedApiKeyFacts;
      warnings: string[];
    }>,
  ) {}

  /**
   * Selections of draft profiles keeping each row's review settings; null
   * when a row cannot be kept, so the list is left as it is. Whether a
   * managed key serves the target is the domain rule `managedApiKeyServes`.
   */
  async selections(
    providers: readonly ReviewProviderConfiguration[],
    target: ReviewConfigurationTarget,
  ): Promise<ReviewProviderSelection[] | null> {
    const { credentials, warnings } = this.input;
    const scope = targetKey(target);
    const repositoryId =
      target.scope === "repository" ? target.repositoryId : null;
    const refuse = (reason: string) => {
      warnings.push(
        target.scope === "workspace"
          ? `${scope}: ${reason}; stored without a default provider`
          : `${scope}: ${reason}; left unconverted`,
      );
      return null;
    };
    const drafts: ProviderProfileDraft[] = [];
    const selections: ReviewProviderSelection[] = [];
    for (const [index, provider] of providers.entries()) {
      if (
        provider.authMode === "codex_subscription_oauth_rotating" &&
        !repositoryId
      )
        return refuse("rotating Codex cannot be a workspace default");
      if (provider.authMode === "codex_account_gateway") {
        const refusal = await this.gatewayRefusal(
          provider.gatewayBindingId,
          provider.gatewayProfileRef,
        );
        if (refusal) return refuse(refusal);
      }
      // Only the server-managed key delivers OpenRouter.
      if (
        provider.authMode === "openrouter_api_key" &&
        !managedApiKeyServes(credentials, provider.authMode, repositoryId)
      )
        return refuse("OpenRouter has no managed API key here");
      const draftId = `migration:${scope}:${index}`;
      drafts.push({
        draftId,
        credential: providerCredentialRequestFor(provider, {
          repositoryId,
          managedApiKeys: credentials,
        }),
        model: provider.model,
        label: null,
      });
      selections.push(reviewProviderSelectionFor(provider, draftId));
    }
    this.drafts.push(...drafts);
    return selections;
  }

  /** The drafts the given documents reference, as the write requires. */
  forWrites(writes: readonly ReviewPolicyWrite[]): ProviderProfileDraft[] {
    const referenced = new Set(
      writes.flatMap(
        (write) =>
          write.policy.providers?.map((selection) => selection.profileId) ?? [],
      ),
    );
    return this.drafts.filter((draft) => referenced.has(draft.draftId));
  }

  /**
   * Why the write would refuse a Gateway row, decided by the same functions
   * the write calls: the binding must be selectable for this workspace, a
   * personal binding needs sharing enabled and the creator as its personal
   * write actor, and the account profile must still be the stored one.
   */
  private async gatewayRefusal(
    bindingId: string,
    gatewayProfileRef: string,
  ): Promise<string | null> {
    const key = JSON.stringify([bindingId, gatewayProfileRef]);
    if (!this.gatewayChecks.has(key))
      this.gatewayChecks.set(
        key,
        await this.checkGateway(bindingId, gatewayProfileRef),
      );
    return this.gatewayChecks.get(key)!;
  }

  private async checkGateway(
    bindingId: string,
    gatewayProfileRef: string,
  ): Promise<string | null> {
    const { workspaceId, creatorUserId, options } = this.input;
    const binding = `gateway binding ${bindingId}`;
    const personal = await readPersonalBindingIds(this.tx, workspaceId, [
      bindingId,
    ]);
    let personalBindings: ReadonlySet<string> = new Set();
    if (personal.size > 0) {
      if (!options.personalAccountsEnabled)
        return `${binding} is a personal account while personal account sharing is disabled`;
      try {
        // The writers are stopped, so locking before the scope guards is safe.
        personalBindings = await lockPersonalWriteActor(
          this.tx,
          workspaceId,
          [bindingId],
          creatorUserId ?? undefined,
        );
      } catch (error) {
        if (
          messageOf(error) === "review_configuration_personal_actor_forbidden"
        )
          return `${binding} is a personal account the creator ${creatorUserId ?? "(none)"} may not select`;
        throw error;
      }
    }
    let current: string | null;
    try {
      current = await readSelectableGatewayProfileRef(this.tx, {
        workspaceId,
        bindingId,
        personalBindings,
        operatorWorkspaceId: options.operatorWorkspaceId,
        personalAccountsEnabled: options.personalAccountsEnabled,
      });
    } catch (error) {
      const code = messageOf(error);
      if (
        code === "review_configuration_gateway_binding_unavailable" ||
        code === "review_configuration_personal_actor_forbidden"
      )
        return `${binding} is not selectable (${code})`;
      throw error;
    }
    if (!current) return `${binding} is not selectable`;
    if (current !== gatewayProfileRef)
      return `${binding} now serves account profile ${current}, not the stored ${gatewayProfileRef}`;
    return null;
  }
}

/** The schema 3 merge of a repository override over the workspace policy. */
function legacyEffectiveConfiguration(
  workspace: ReviewConfiguration,
  override: Record<string, unknown>,
): ReviewConfiguration | null {
  const section = (name: string) =>
    definedOnly((override[name] ?? {}) as Record<string, unknown>);
  const updatePrDescription =
    override.updatePrDescription ?? workspace.updatePrDescription;
  const contextTools = override.contextTools ?? workspace.contextTools;
  try {
    return parseReviewConfigurationStrict({
      schemaVersion: REVIEW_POLICY_SCHEMA_VERSION,
      providers: override.providers ?? workspace.providers,
      execution: { ...workspace.execution, ...section("execution") },
      blockingPolicy: {
        ...workspace.blockingPolicy,
        ...section("blockingPolicy"),
      },
      limits: { ...workspace.limits, ...section("limits") },
      reviewLanguage:
        override.reviewLanguage !== undefined
          ? override.reviewLanguage
          : workspace.reviewLanguage,
      ...(updatePrDescription === undefined ? {} : { updatePrDescription }),
      investigationRollout: {
        ...workspace.investigationRollout,
        ...section("investigationRollout"),
      },
      ...(contextTools === undefined ? {} : { contextTools }),
    });
  } catch {
    return null;
  }
}

function definedOnly(value: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

/**
 * Records the requirement of configured workflows that predate it (NULL),
 * from the configuration they were installed for. Never overwrites one.
 */
async function fillInstalledRequirements(
  tx: Prisma.TransactionClient,
  input: {
    readonly workspaceId: string;
    readonly legacyEffective: (
      repositoryId: string,
    ) => ReviewConfiguration | null;
    readonly warnings: string[];
  },
): Promise<number> {
  const rows = await tx.workflowProvisioning.findMany({
    where: {
      workspaceId: input.workspaceId,
      status: "configured",
      installedWorkflowRequirement: null,
    },
    orderBy: { repositoryId: "asc" },
    select: { id: true, repositoryId: true },
  });
  // Configurations the app reads now, for workspaces converted earlier.
  const current = rows.length
    ? (
        await resolveEffectiveReviewConfigurations(
          {
            workspaceId: input.workspaceId,
            repositoryIds: rows.map((row) => row.repositoryId),
          },
          { policyHeads: new PrismaReviewPolicyHeadReader(tx) },
        )
      ).repositories
    : new Map();
  let filled = 0;
  for (const row of rows) {
    const resolved = current.get(row.repositoryId);
    const config =
      input.legacyEffective(row.repositoryId) ??
      (resolved?.status === "ready" ? resolved.config : null);
    if (!config) continue;
    let requirement: string;
    try {
      requirement = requiredWorkflowRequirement(config);
    } catch {
      input.warnings.push(
        `repo:${row.repositoryId}: no workflow requirement for its configuration`,
      );
      continue;
    }
    const updated = await tx.workflowProvisioning.updateMany({
      where: {
        id: row.id,
        status: "configured",
        installedWorkflowRequirement: null,
      },
      data: { installedWorkflowRequirement: requirement },
    });
    filled += updated.count;
  }
  return filled;
}

export const PROVIDER_PROFILE_MIGRATION_USAGE = [
  "Usage: tsx scripts/migrate-provider-profiles.ts [--dry-run] [--workspace ID ...]",
  "Reads DATABASE_URL. Run it after migrate deploy, with a pg_dump taken and the old fleet stopped.",
].join("\n");

export function parseProviderProfileMigrationArgs(argv: readonly string[]): {
  readonly dryRun: boolean;
  readonly workspaceIds?: readonly string[];
} {
  let dryRun = false;
  const workspaceIds: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--workspace" && argv[index + 1])
      workspaceIds.push(argv[(index += 1)]!);
    else throw new Error(`invalid_argument:${arg}`);
  }
  return { dryRun, ...(workspaceIds.length ? { workspaceIds } : {}) };
}

async function main(): Promise<void> {
  let args: ReturnType<typeof parseProviderProfileMigrationArgs>;
  try {
    args = parseProviderProfileMigrationArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n${PROVIDER_PROFILE_MIGRATION_USAGE}\n`,
    );
    process.exitCode = 2;
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    process.stderr.write(
      `DATABASE_URL is required\n${PROVIDER_PROFILE_MIGRATION_USAGE}\n`,
    );
    process.exitCode = 2;
    return;
  }
  const prisma = createPrismaClient({ databaseUrl, poolMax: 2 });
  try {
    let reports: readonly WorkspaceMigrationReport[];
    try {
      reports = await migrateProviderProfiles(prisma, {
        ...args,
        operatorWorkspaceId: process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
        personalAccountsEnabled: readPersonalAccountSharingEnabled(process.env),
        rotatingAllowed: (repositoryFullName) =>
          isCodexRotatingOAuthAllowedForRepository(
            repositoryFullName,
            process.env,
          ),
      });
    } catch (error) {
      if (!(error instanceof ProviderProfileMigrationPreflightError))
        throw error;
      process.stderr.write(
        `${JSON.stringify({ error: error.message, detail: error.detail })}\n`,
      );
      process.exitCode = 2;
      return;
    }
    for (const report of reports)
      process.stdout.write(`${JSON.stringify(report)}\n`);
    const count = (status: WorkspaceMigrationReport["status"]) =>
      reports.filter((report) => report.status === status).length;
    process.stdout.write(
      `${JSON.stringify({
        mode: args.dryRun ? "dry-run" : "write",
        workspaces: reports.length,
        converted: count("converted"),
        unchanged: count("unchanged"),
        skipped: count("skipped"),
        failed: count("failed"),
        profilesCreated: reports.reduce(
          (total, report) => total + report.profilesCreated,
          0,
        ),
        warnings: reports.reduce(
          (total, report) => total + report.warnings.length,
          0,
        ),
      })}\n`,
    );
    if (count("failed") > 0) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
