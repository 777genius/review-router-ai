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
 * (`review_policy_resave_required`). `--dry-run` runs the same transaction and
 * rolls it back.
 *
 * Order for each environment: take a pg_dump, apply migrations, stop writers,
 * run this script, start the new app. Never run it against a production
 * database without the owner's explicit instruction.
 */
import { pathToFileURL } from "node:url";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readPersonalAccountSharingEnabled } from "../packages/features/provider-accounts/src/composition.js";
import {
  canonicalJson,
  managedApiKeyProviderTypes,
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
  type ProviderProfileDraft,
  type ReviewConfiguration,
  type ReviewConfigurationTarget,
  type ReviewPolicyHead,
  type ReviewPolicyWrite,
  type ReviewProviderConfiguration,
} from "../packages/features/review-config/src/index.js";
import { requiredWorkflowRequirement } from "../packages/features/workflow-provisioning/src/index.js";
import { createPrismaClient } from "../packages/platform/db/src/index.js";

export const PROVIDER_PROFILE_MIGRATION_ACTOR =
  "system:provider-profile-migration";

export type ProviderProfileMigrationOptions = Readonly<{
  /** Runs every workspace transaction and rolls it back. */
  dryRun: boolean;
  operatorWorkspaceId: string | undefined;
  personalAccountsEnabled: boolean;
  /** Limits the run to these workspaces; every workspace when omitted. */
  workspaceIds?: readonly string[];
}>;

export type WorkspaceMigrationReport = Readonly<{
  workspaceId: string;
  /**
   * `converted` wrote at least one document or requirement, `unchanged` found
   * nothing to do, `skipped` had no user to create profiles for and `failed`
   * rolled back on an error.
   */
  status: "converted" | "unchanged" | "skipped" | "failed";
  creatorUserId: string | null;
  /** Target keys that received a schema 4 version. */
  converted: readonly string[];
  profilesCreated: number;
  installedRequirementsFilled: number;
  warnings: readonly string[];
  error?: string;
}>;

export async function migrateProviderProfiles(
  prisma: PrismaClient,
  options: ProviderProfileMigrationOptions,
): Promise<readonly WorkspaceMigrationReport[]> {
  const workspaces = await prisma.workspace.findMany({
    where: options.workspaceIds
      ? { id: { in: [...options.workspaceIds] } }
      : {},
    orderBy: { id: "asc" },
    select: { id: true, personalOwnerUserId: true },
  });
  const reports: WorkspaceMigrationReport[] = [];
  for (const workspace of workspaces)
    reports.push(await migrateWorkspace(prisma, workspace, options));
  return reports;
}

class DryRunRollback extends Error {
  constructor(readonly report: WorkspaceMigrationReport) {
    super("provider_profile_migration_dry_run");
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
  try {
    return await runReviewConfigurationTransaction(
      prisma,
      async (tx) => {
        const report = await migrateWorkspaceIn(tx, workspace, options);
        if (options.dryRun) throw new DryRunRollback(report);
        return report;
      },
      { isolationLevel: "Serializable" },
    );
  } catch (error) {
    if (error instanceof DryRunRollback) return error.report;
    return {
      workspaceId: workspace.id,
      status: "failed",
      creatorUserId: null,
      converted: [],
      profilesCreated: 0,
      installedRequirementsFilled: 0,
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function migrateWorkspaceIn(
  tx: Prisma.TransactionClient,
  workspace: {
    readonly id: string;
    readonly personalOwnerUserId: string | null;
  },
  options: ProviderProfileMigrationOptions,
): Promise<WorkspaceMigrationReport> {
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
      workspaceId,
      status: "skipped",
      creatorUserId: null,
      converted: [],
      profilesCreated: 0,
      installedRequirementsFilled: 0,
      warnings: [
        ...warnings,
        "no personal owner, owner or admin to create the profiles; workspace left unconverted",
      ],
    };
  }
  const workspaceConfig = legacyWorkspace?.config ?? null;
  const credentials = await credentialFacts(tx, workspaceId);
  const drafts: ProviderProfileDraft[] = [];
  const writes: ReviewPolicyWrite[] = [];
  const workspaceTarget = { scope: "workspace" as const, workspaceId };

  if (legacyWorkspace) {
    const selections = draftSelections({
      providers: legacyWorkspace.config.providers,
      target: workspaceTarget,
      credentials,
      drafts,
      warnings,
    });
    writes.push({
      target: workspaceTarget,
      expectedVersion: legacyWorkspace.version,
      policy: parseWorkspaceReviewPolicy({
        schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        ...(selections ? { providers: selections } : {}),
        ...storedSettings(legacyWorkspace.config),
      }),
    });
    if (!selections) {
      const repositories = await tx.repositoryConnection.findMany({
        where: { workspaceId },
        orderBy: { id: "asc" },
        select: { id: true },
      });
      const inheriting = repositories
        .map((repository) => repository.id)
        .filter(
          (repositoryId) =>
            !legacyRepositories.get(repositoryId)?.override.providers &&
            !currentRepositorySelects(heads.repositories.get(repositoryId)),
        );
      if (inheriting.length)
        warnings.push(
          `repositories that inherited the workspace default now select no provider: ${inheriting.join(", ")}`,
        );
    }
  } else if (legacyRepositories.size > 0 && !heads.workspace) {
    warnings.push(
      "repository policies without a workspace policy were left unconverted",
    );
    legacyRepositories.clear();
  }

  for (const [repositoryId, legacy] of legacyRepositories) {
    if (
      !workspaceConfig &&
      heads.workspace?.schemaVersion !== STORED_REVIEW_POLICY_SCHEMA_VERSION
    ) {
      warnings.push(
        `repo:${repositoryId}: workspace policy is not readable; left unconverted`,
      );
      continue;
    }
    const target = {
      scope: "repository" as const,
      workspaceId,
      repositoryId,
    };
    const selections = legacy.override.providers
      ? draftSelections({
          providers: legacy.override.providers,
          target,
          credentials,
          drafts,
          warnings,
        })
      : undefined;
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
        profileDrafts: drafts,
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
      legacyEffective({ scope: "repository", workspaceId, repositoryId }),
    warnings,
  });

  const converted = saved.map((result) => targetKey(result.target));
  return {
    workspaceId,
    status:
      converted.length > 0 || installedRequirementsFilled > 0
        ? "converted"
        : "unchanged",
    creatorUserId,
    converted,
    profilesCreated,
    installedRequirementsFilled,
    warnings,
  };
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

type CredentialFacts = Readonly<{
  managedKeys: ReadonlyMap<string, string>;
  appliedKeys: ReadonlySet<string>;
  bindings: ReadonlySet<string>;
}>;

async function credentialFacts(
  tx: Prisma.TransactionClient,
  workspaceId: string,
): Promise<CredentialFacts> {
  const [keys, links, bindings] = await Promise.all([
    tx.providerApiKeyConnection.findMany({
      where: { workspaceId },
      select: { id: true, providerType: true },
    }),
    tx.providerApiKeyRepositoryLink.findMany({
      where: { workspaceId, appliedKeyVersion: { not: null } },
      select: { providerApiKeyConnectionId: true, repositoryId: true },
    }),
    tx.workspaceAccountBinding.findMany({
      where: { workspaceId, state: "active" },
      select: { id: true },
    }),
  ]);
  return {
    managedKeys: new Map(keys.map((key) => [key.providerType, key.id])),
    appliedKeys: new Set(
      links.map(
        (link) => `${link.repositoryId}:${link.providerApiKeyConnectionId}`,
      ),
    ),
    bindings: new Set(bindings.map((binding) => binding.id)),
  };
}

/**
 * Selections of draft profiles for a provider list, keeping each row's review
 * settings; null when a row cannot be kept (the list is then left as is).
 * The managed key rule is the dashboard's: a workspace default uses a
 * workspace key whenever it exists, a repository once the key is applied.
 */
function draftSelections(input: {
  readonly providers: readonly ReviewProviderConfiguration[];
  readonly target: ReviewConfigurationTarget;
  readonly credentials: CredentialFacts;
  readonly drafts: ProviderProfileDraft[];
  readonly warnings: string[];
}) {
  const { target, credentials } = input;
  const scope = targetKey(target);
  const repositoryId =
    target.scope === "repository" ? target.repositoryId : null;
  const refuse = (reason: string) => {
    input.warnings.push(
      target.scope === "workspace"
        ? `${scope}: ${reason}; stored without a default provider`
        : `${scope}: ${reason}; left unconverted`,
    );
    return null;
  };
  const drafts: ProviderProfileDraft[] = [];
  const selections = [];
  for (const [index, provider] of input.providers.entries()) {
    if (
      provider.authMode === "codex_subscription_oauth_rotating" &&
      !repositoryId
    )
      return refuse("rotating Codex cannot be a workspace default");
    if (
      provider.authMode === "codex_account_gateway" &&
      !credentials.bindings.has(provider.gatewayBindingId)
    )
      return refuse(
        `gateway binding ${provider.gatewayBindingId} is not active`,
      );
    const managedKey = (authMode: keyof typeof managedApiKeyProviderTypes) => {
      const keyId = credentials.managedKeys.get(
        managedApiKeyProviderTypes[authMode],
      );
      return (
        keyId !== undefined &&
        (!repositoryId ||
          credentials.appliedKeys.has(`${repositoryId}:${keyId}`))
      );
    };
    // Only the server-managed key delivers OpenRouter.
    if (
      provider.authMode === "openrouter_api_key" &&
      !managedKey(provider.authMode)
    )
      return refuse("OpenRouter has no managed API key here");
    const draftId = `migration:${scope}:${index}`;
    drafts.push({
      draftId,
      credential: providerCredentialRequestFor(provider, {
        repositoryId,
        managedApiKey: managedKey,
      }),
      model: provider.model,
      label: null,
    });
    selections.push(reviewProviderSelectionFor(provider, draftId));
  }
  input.drafts.push(...drafts);
  return selections;
}

/** Every stored setting of a schema 3 workspace configuration. */
function storedSettings(config: ReviewConfiguration) {
  return {
    execution: {
      providerMaxParallel: config.execution.providerMaxParallel,
      inlineMinAgreement: config.execution.inlineMinAgreement,
    },
    blockingPolicy: config.blockingPolicy,
    limits: config.limits,
    reviewLanguage: config.reviewLanguage,
    ...(config.updatePrDescription === undefined
      ? {}
      : { updatePrDescription: config.updatePrDescription }),
    investigationRollout: config.investigationRollout,
    ...(config.contextTools ? { contextTools: config.contextTools } : {}),
  };
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
  "Reads DATABASE_URL. Take a pg_dump and stop writers first.",
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
    const reports = await migrateProviderProfiles(prisma, {
      ...args,
      operatorWorkspaceId: process.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
      personalAccountsEnabled: readPersonalAccountSharingEnabled(process.env),
    });
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
