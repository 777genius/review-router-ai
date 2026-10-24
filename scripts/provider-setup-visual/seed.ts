/**
 * Seeds the provider setup visual data set (fixture-contract.ts) into a
 * migrated database. Every run first removes the rows of the fixed fixture
 * IDs and then writes them again, so the result is the same data set after
 * any earlier run, including one whose screens changed providers.
 *
 * Users, workspaces, repositories and the setup facts are plain rows written
 * through Prisma. Provider profiles, selections, the workspace default and
 * Access rights are written only through the review-config use cases with the
 * actor who would make the change in the dashboard, so the stored documents,
 * audit events and permission decisions are the production ones.
 *
 * CLI: PROVIDER_VISUAL_DATABASE_URL=postgresql://user@127.0.0.1:PORT/
 * reviewrouter_provider_setup_visual tsx scripts/provider-setup-visual/seed.ts
 * [--rotating] [--no-personal-sharing]
 */
import { pathToFileURL } from "node:url";
import type { PrismaClient } from "@prisma/client";
import { saveGitHubUserAuthorizationFromAccount } from "../../packages/features/auth/src/index.js";
import { readPersonalAccountSharingEnabled } from "../../packages/features/provider-accounts/src/composition.js";
import {
  assignProviderProfileToRepositories,
  changeProviderAccessRights,
  createWorkspaceProviderProfile,
  PrismaReviewConfigurationRepository,
  PrismaReviewPolicyHeadReader,
  PrismaWorkspaceProviderProfileRepository,
  resolveEffectiveReviewConfigurations,
  setWorkspaceDefaultProvider,
  type EffectiveReviewConfigurationValidatorPort,
  type ProviderCredentialRequest,
  type ProviderCredentialSource,
  type ProviderProfileActor,
  type ProviderRepositoryCapability,
  type ProviderSelectionDraft,
  type ReviewConfiguration,
} from "../../packages/features/review-config/src/index.js";
import { getProviderAuthModeMetadata } from "../../packages/features/review-providers/src/index.js";
import {
  defaultSetupBranch,
  defaultWorkflowPath,
  requiredWorkflowRequirement,
} from "../../packages/features/workflow-provisioning/src/index.js";
import { resolveReviewRouterActionRef } from "../../packages/platform/config/src/index.js";
import { createPrismaClient } from "../../packages/platform/db/src/index.js";
import {
  entriesOf,
  VISUAL_CONNECTIONS,
  VISUAL_DATABASE_NAME,
  VISUAL_GITLAB,
  VISUAL_MANAGED_KEYS,
  VISUAL_PROFILES,
  VISUAL_REPOSITORIES,
  VISUAL_SELECTION_SETTINGS,
  VISUAL_SETUP_BRANCH_HEAD_SHA,
  VISUAL_USERS,
  VISUAL_WORKSPACES,
  visualGitHubPermission,
  visualRepositoryEnabled,
  visualRepositoryFullName,
  visualRepositorySecretKey,
  visualSharedEnvironment,
  type GitHubFixtureState,
  type VisualCredential,
  type VisualProfileKey,
  type VisualRepository,
  type VisualRepositoryKey,
  type VisualRunFlags,
  type VisualUserKey,
  type VisualWorkspaceKey,
  type WorkspaceRole,
} from "./fixture-contract.js";

export type VisualSeedResult = Readonly<{
  profileIds: Readonly<Partial<Record<VisualProfileKey, string>>>;
  repositories: readonly Readonly<{
    key: VisualRepositoryKey;
    fullName: string;
    configStatus: string;
    authMode: string | null;
  }>[];
  /** What the GitHub fixture answers: the confirmed secrets exist. */
  github: GitHubFixtureState;
}>;

const FIXTURE_AVATAR = (fill: string) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="${fill}"/></svg>`,
  )}`;

/**
 * Refuses any database except a loopback one named for this qualification,
 * so a reset can never reach shared or production data.
 */
export function assertVisualDatabaseUrl(
  databaseUrl: string | undefined,
): string {
  if (!databaseUrl) throw new Error("provider_visual_database_url_required");
  const url = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.pathname !== `/${VISUAL_DATABASE_NAME}`
  )
    throw new Error("provider_visual_requires_named_loopback_database");
  return databaseUrl;
}

export async function seedProviderSetupVisualFixtures(
  prisma: PrismaClient,
  flags: VisualRunFlags,
): Promise<VisualSeedResult> {
  const environment = visualSharedEnvironment(flags);
  await resetFixtureRows(prisma);
  await seedIdentities(prisma, environment);
  await seedWorkspaces(prisma);
  await seedRepositories(prisma, flags);
  await seedCredentials(prisma);
  const profileIds = await seedProviderRegistry(prisma, {
    flags,
    personalAccountsEnabled: readPersonalAccountSharingEnabled(environment),
  });
  const repositorySecrets: string[] = [];
  return {
    profileIds,
    repositories: await seedSetupFacts(prisma, flags, repositorySecrets),
    github: { repositorySecrets },
  };
}

/**
 * Profiles, the workspace default, repository selections and Access rights,
 * each written by the use case and the actor the dashboard would use.
 */
async function seedProviderRegistry(
  prisma: PrismaClient,
  input: Readonly<{ flags: VisualRunFlags; personalAccountsEnabled: boolean }>,
): Promise<Partial<Record<VisualProfileKey, string>>> {
  const { flags, personalAccountsEnabled } = input;
  const profiles = new PrismaWorkspaceProviderProfileRepository(prisma, {
    operatorWorkspaceId: undefined,
    personalAccountsEnabled,
  });
  const selections = (actor: VisualUserKey) => ({
    configurations: new PrismaReviewConfigurationRepository(
      prisma,
      undefined,
      personalAccountsEnabled,
      VISUAL_USERS[actor].id,
    ),
    policyHeads: new PrismaReviewPolicyHeadReader(prisma),
    validator: fixtureValidator,
  });
  const profileIds: Partial<Record<VisualProfileKey, string>> = {};

  for (const [key, profile] of entriesOf(VISUAL_PROFILES)) {
    if (profile.requiresRotating && !flags.rotating) continue;
    if (profile.requiresPersonalSharing && !flags.personalSharing) continue;
    const workspaceId = VISUAL_WORKSPACES[profile.workspace].id;
    const credential = credentialRequest(profile.credential);
    if (profile.attachTo) {
      // Created inside the attach flow: one decision for profile and attach.
      const repository = VISUAL_REPOSITORIES[profile.attachTo];
      const draft = attachDraft(workspaceId, profile.credential, {
        credential,
        model: profile.model,
        label: profile.label,
      });
      const [result] = await assignProviderProfileToRepositories(
        {
          workspaceId,
          actor: providerActor(profile.createdBy),
          profileId: draft.draft.draftId,
          settings: {
            ...VISUAL_SELECTION_SETTINGS,
            ...(profile.attachReasoningEffort
              ? { reasoningEffort: profile.attachReasoningEffort }
              : {}),
          },
          draft,
          repositories: [
            {
              repositoryId: repository.id,
              capability: repositoryCapability(profile.createdBy, repository),
            },
          ],
        },
        selections(profile.createdBy),
      );
      if (result?.status !== "applied" || !result.profileId)
        throw new Error(
          `provider_visual_attach_failed:${key}:${JSON.stringify(result)}`,
        );
      profileIds[key] = result.profileId;
      continue;
    }
    const { profile: created } = await createWorkspaceProviderProfile(
      {
        workspaceId,
        actor: providerActor(profile.createdBy),
        credential,
        model: profile.model,
        label: profile.label,
      },
      { profiles },
    );
    profileIds[key] = created.id;
  }

  for (const [, workspace] of entriesOf(VISUAL_WORKSPACES)) {
    if (!workspace.defaultProfile) continue;
    await setWorkspaceDefaultProvider(
      {
        workspaceId: workspace.id,
        actor: providerActor("owner"),
        selection: {
          profileId: requiredProfileId(profileIds, workspace.defaultProfile),
          ...VISUAL_SELECTION_SETTINGS,
        },
      },
      selections("owner"),
    );
  }

  for (const [key, repository] of entriesOf(VISUAL_REPOSITORIES)) {
    if (!repository.selection || !visualRepositoryEnabled(repository, flags))
      continue;
    if (VISUAL_PROFILES[repository.selection.profile].attachTo === key)
      continue;
    const [result] = await assignProviderProfileToRepositories(
      {
        workspaceId: VISUAL_WORKSPACES[repository.workspace].id,
        actor: providerActor(repository.selection.by),
        profileId: requiredProfileId(profileIds, repository.selection.profile),
        settings: VISUAL_SELECTION_SETTINGS,
        repositories: [
          {
            repositoryId: repository.id,
            capability: repositoryCapability(
              repository.selection.by,
              repository,
            ),
          },
        ],
      },
      selections(repository.selection.by),
    );
    if (result?.status !== "applied")
      throw new Error(
        `provider_visual_assignment_failed:${key}:${JSON.stringify(result)}`,
      );
  }

  for (const [, workspace] of entriesOf(VISUAL_WORKSPACES)) {
    if (!workspace.providerManagementAdminOnly) continue;
    await changeProviderAccessRights(
      {
        workspaceId: workspace.id,
        actor: providerActor("owner"),
        adminOnly: true,
      },
      { profiles },
    );
  }
  return profileIds;
}

/** Removes every fixture row in foreign-key order; unknown rows stay. */
export async function resetFixtureRows(prisma: PrismaClient): Promise<void> {
  const workspaceIds = entriesOf(VISUAL_WORKSPACES).map(([, ws]) => ws.id);
  const where = { workspaceId: { in: workspaceIds } };
  // Profiles and versions reference bindings, bindings restrict accounts and
  // workspaces, accounts restrict their owners.
  await prisma.workspaceProviderProfile.deleteMany({ where });
  await prisma.reviewConfiguration.deleteMany({ where });
  await prisma.workspaceAccountBinding.deleteMany({ where });
  await prisma.providerAccountConnection.deleteMany({
    where: {
      id: { in: entriesOf(VISUAL_CONNECTIONS).map(([, item]) => item.id) },
    },
  });
  await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
  await prisma.user.deleteMany({
    where: { id: { in: entriesOf(VISUAL_USERS).map(([, user]) => user.id) } },
  });
}

async function seedIdentities(
  prisma: PrismaClient,
  environment: Readonly<Record<string, string>>,
): Promise<void> {
  for (const [, user] of entriesOf(VISUAL_USERS)) {
    await prisma.user.create({
      data: {
        id: user.id,
        githubUserId: BigInt(user.githubUserId),
        githubLogin: user.login,
        primaryEmail: `${user.login}@invalid.test`,
        avatarUrl: FIXTURE_AVATAR("#22d3ee"),
        externalIdentities: {
          create: {
            provider: "github",
            externalUserId: user.githubUserId,
            login: user.login,
            primaryEmail: `${user.login}@invalid.test`,
            avatarUrl: FIXTURE_AVATAR("#22d3ee"),
          },
        },
      },
    });
    // The sign-in stores the GitHub user token; repository discovery then
    // reads the fixture GitHub API instead of reporting a missing token.
    const saved = await saveGitHubUserAuthorizationFromAccount({
      prisma,
      principal: {
        userId: user.id,
        provider: "github",
        externalUserId: user.githubUserId,
        login: user.login,
        githubUserId: user.githubUserId,
        githubLogin: user.login,
      },
      account: { access_token: `rr-visual-fixture-token-${user.login}` },
      env: environment,
    });
    if (saved !== "saved")
      throw new Error(`provider_visual_user_token_not_saved:${saved}`);
  }
}

async function seedWorkspaces(prisma: PrismaClient): Promise<void> {
  for (const [, workspace] of entriesOf(VISUAL_WORKSPACES)) {
    await prisma.workspace.create({
      data: {
        id: workspace.id,
        slug: workspace.slug,
        name: workspace.name,
        personalOwnerUserId: workspace.personalOwner
          ? VISUAL_USERS[workspace.personalOwner].id
          : null,
        members: {
          create: (
            Object.entries(workspace.members) as [
              VisualUserKey,
              WorkspaceRole,
            ][]
          ).map(([user, role]) => ({
            userId: VISUAL_USERS[user].id,
            githubLogin: VISUAL_USERS[user].login,
            role,
          })),
        },
        installations: {
          create: {
            id: workspace.installation.id,
            githubInstallationId: BigInt(
              workspace.installation.githubInstallationId,
            ),
            accountLogin: workspace.installation.accountLogin,
            accountType: workspace.installation.accountType,
            accountAvatarUrl: FIXTURE_AVATAR("#a78bfa"),
            repositorySelection: "selected",
            status: "active",
          },
        },
      },
    });
  }
  await prisma.gitLabInstallation.create({
    data: {
      id: VISUAL_GITLAB.installationId,
      workspaceId: VISUAL_WORKSPACES[VISUAL_GITLAB.workspace].id,
      namespacePath: VISUAL_GITLAB.namespacePath,
      sourceKind: "group",
      status: "active",
      selectedProjects: 1,
      lastInstalledAt: new Date(),
    },
  });
}

async function seedRepositories(
  prisma: PrismaClient,
  flags: VisualRunFlags,
): Promise<void> {
  for (const [, repository] of entriesOf(VISUAL_REPOSITORIES)) {
    if (!visualRepositoryEnabled(repository, flags)) continue;
    const workspace = VISUAL_WORKSPACES[repository.workspace];
    const fullName = visualRepositoryFullName(repository);
    const github = repository.githubRepositoryId !== null;
    await prisma.repositoryConnection.create({
      data: {
        id: repository.id,
        workspaceId: workspace.id,
        provider: github ? "github" : "gitlab",
        sourceBaseUrl: github ? "https://github.com" : "https://gitlab.com",
        externalRepositoryId:
          repository.githubRepositoryId ?? VISUAL_GITLAB.externalProjectId,
        installationId: github ? workspace.installation.id : null,
        gitlabInstallationId: github ? null : VISUAL_GITLAB.installationId,
        githubRepositoryId: github
          ? BigInt(repository.githubRepositoryId!)
          : null,
        owner: fullName.split("/")[0]!,
        name: repository.name,
        fullName,
        defaultBranch: "main",
        visibility: "private",
        setupStatus:
          repository.setup === "none" ? "not_configured" : repository.setup,
      },
    });
  }
}

async function seedCredentials(prisma: PrismaClient): Promise<void> {
  for (const [, connection] of entriesOf(VISUAL_CONNECTIONS)) {
    await prisma.providerAccountConnection.create({
      data: {
        id: connection.id,
        ownerWorkspaceId:
          connection.owner.kind === "workspace"
            ? VISUAL_WORKSPACES[connection.workspace].id
            : null,
        ownerUserId:
          connection.owner.kind === "user"
            ? VISUAL_USERS[connection.owner.user].id
            : null,
        gatewayAccountRef: connection.gatewayAccountRef,
        profileRef: connection.profileRef,
        displayName: connection.displayName,
        state: "active",
        authorizationEpochMirror: 1n,
      },
    });
    await prisma.workspaceAccountBinding.create({
      data: {
        id: connection.bindingId,
        workspaceId: VISUAL_WORKSPACES[connection.workspace].id,
        connectionId: connection.id,
        state: "active",
      },
    });
  }
  for (const key of VISUAL_MANAGED_KEYS) {
    const workspaceId = VISUAL_WORKSPACES[key.workspace].id;
    await prisma.providerApiKeyConnection.create({
      data: {
        id: key.id,
        workspaceId,
        providerType: key.providerType,
        // Never a key: the screens read metadata only and nothing decrypts it.
        encryptedApiKey: "rr-visual-fixture-not-an-encrypted-key",
        keyVersion: 1,
        latestOperationId: `${key.id}-operation`,
      },
    });
    await prisma.providerApiKeyRepositoryLink.createMany({
      data: key.appliedTo.map((repository) => ({
        workspaceId,
        providerApiKeyConnectionId: key.id,
        repositoryId: VISUAL_REPOSITORIES[repository].id,
        status: "applied",
        attemptedKeyVersion: 1,
        appliedKeyVersion: 1,
        attemptCount: 1,
        appliedAt: new Date(),
      })),
    });
  }
}

/**
 * Setup workflow and provider secret facts, derived from the effective
 * configuration the use cases stored, as the setup PR and secret
 * confirmation flows would record them.
 */
async function seedSetupFacts(
  prisma: PrismaClient,
  flags: VisualRunFlags,
  repositorySecrets: string[],
): Promise<VisualSeedResult["repositories"]> {
  const report: VisualSeedResult["repositories"][number][] = [];
  const workspaceKeys = new Set<VisualWorkspaceKey>(
    entriesOf(VISUAL_REPOSITORIES).map(
      ([, repository]) => repository.workspace,
    ),
  );
  const actionVersion = resolveReviewRouterActionRef({});
  for (const workspaceKey of workspaceKeys) {
    const workspaceId = VISUAL_WORKSPACES[workspaceKey].id;
    const repositories = entriesOf(VISUAL_REPOSITORIES).filter(
      ([, repository]) =>
        repository.workspace === workspaceKey &&
        visualRepositoryEnabled(repository, flags),
    );
    const resolved = await resolveEffectiveReviewConfigurations(
      {
        workspaceId,
        repositoryIds: repositories.map(([, repository]) => repository.id),
      },
      { policyHeads: new PrismaReviewPolicyHeadReader(prisma) },
    );
    const workspaceConfig =
      resolved.workspace.status === "ready" ? resolved.workspace.config : null;
    for (const [key, repository] of repositories) {
      const effective = resolved.repositories.get(repository.id);
      const config = effective?.status === "ready" ? effective.config : null;
      report.push({
        key,
        fullName: visualRepositoryFullName(repository),
        configStatus: effective?.status ?? "unknown",
        authMode: config?.providers[0]?.authMode ?? null,
      });
      await seedProvisioning(prisma, {
        workspaceId,
        repository,
        actionVersion,
        required: requirementOf(config),
        installed: requirementOf(
          repository.installedForWorkspaceDefault ? workspaceConfig : config,
        ),
      });
      if (repository.secretConfirmed && config)
        for (const provider of config.providers) {
          await prisma.providerSetupState.create({
            data: {
              workspaceId,
              repositoryId: repository.id,
              targetKey: `repo:${repository.id}`,
              providerKind: provider.kind,
              authMode: provider.authMode,
              state: "configured",
            },
          });
          for (const secretName of getProviderAuthModeMetadata(
            provider.authMode,
          ).secretNames)
            repositorySecrets.push(
              visualRepositorySecretKey(
                visualRepositoryFullName(repository),
                secretName,
              ),
            );
        }
    }
  }
  return report;
}

async function seedProvisioning(
  prisma: PrismaClient,
  input: {
    readonly workspaceId: string;
    readonly repository: VisualRepository;
    readonly actionVersion: string;
    readonly required: string | null;
    readonly installed: string | null;
  },
): Promise<void> {
  const { repository } = input;
  if (repository.setup === "none" || repository.githubRepositoryId === null)
    return;
  const fullName = visualRepositoryFullName(repository);
  await prisma.workflowProvisioning.create({
    data: {
      workspaceId: input.workspaceId,
      repositoryId: repository.id,
      installationId: VISUAL_WORKSPACES[repository.workspace].installation.id,
      branch: defaultSetupBranch,
      workflowPath: defaultWorkflowPath,
      actionVersion: input.actionVersion,
      attemptWorkflowRequirement: input.required,
      ...(repository.setup === "setup_pr_open"
        ? {
            status: "setup_pr_open",
            pullRequestUrl: `https://github.com/${fullName}/pull/1`,
            pullRequestHeadSha: VISUAL_SETUP_BRANCH_HEAD_SHA,
          }
        : {
            status: "configured",
            installedWorkflowRequirement: input.installed,
          }),
    },
  });
}

function requirementOf(config: ReviewConfiguration | null): string | null {
  return config ? requiredWorkflowRequirement(config) : null;
}

function credentialRequest(
  credential: VisualCredential,
): ProviderCredentialRequest {
  switch (credential.kind) {
    case "gateway_binding":
      return {
        kind: "gateway_binding",
        bindingId: VISUAL_CONNECTIONS[credential.connection].bindingId,
      };
    case "repository_rotating":
      return {
        kind: "repository_rotating",
        repositoryId: VISUAL_REPOSITORIES[credential.repository].id,
      };
    case "managed_api_key":
    case "user_ci_secret":
    case "hosted_pool":
      return credential;
  }
}

function providerActor(user: VisualUserKey): ProviderProfileActor {
  return {
    userId: VISUAL_USERS[user].id,
    auditActor: `user:github:${VISUAL_USERS[user].login}`,
  };
}

/** The capability the dashboard would verify from the fixture GitHub permission. */
function repositoryCapability(
  user: VisualUserKey,
  repository: VisualRepository,
): ProviderRepositoryCapability | null {
  switch (visualGitHubPermission(user, repository)) {
    case "admin":
    case "maintain":
      return "direct_config";
    case "write":
      return "repo_manager";
    default:
      return null;
  }
}

function requiredProfileId(
  ids: Partial<Record<VisualProfileKey, string>>,
  key: VisualProfileKey,
): string {
  const id = ids[key];
  if (!id) throw new Error(`provider_visual_profile_missing:${key}`);
  return id;
}

/**
 * The dashboard validates a candidate with the network Gateway catalog and
 * context tools before each selection write. The fixture has neither, so the
 * seed writes the states the dashboard stored while they were reachable; the
 * write still checks the policy, the stored references and its own digest.
 */
const fixtureValidator: EffectiveReviewConfigurationValidatorPort = {
  validate: async () => undefined,
};

/**
 * A provider created inside an attach flow, as the dialog's "Add a new
 * provider" sends it: the request and the in-memory profile it resolves to.
 */
function attachDraft(
  workspaceId: string,
  credential: VisualCredential,
  request: Readonly<{
    credential: ProviderCredentialRequest;
    model: string;
    label: string;
  }>,
): ProviderSelectionDraft {
  const draftId = "draft-provider";
  const source: ProviderCredentialSource =
    credential.kind === "user_ci_secret"
      ? { kind: "user_ci_secret", authMode: credential.authMode }
      : credential.kind === "repository_rotating"
        ? {
            kind: "repository_rotating",
            authMode: "codex_subscription_oauth_rotating",
            repositoryId: VISUAL_REPOSITORIES[credential.repository].id,
          }
        : unsupportedAttachCredential(credential.kind);
  return {
    draft: { draftId, ...request },
    profile: {
      id: draftId,
      workspaceId,
      createdByUserId: null,
      credential: source,
      model: request.model,
      label: request.label,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  };
}

function unsupportedAttachCredential(kind: string): never {
  throw new Error(`provider_visual_attach_credential_unsupported:${kind}`);
}

async function main(): Promise<void> {
  const databaseUrl = assertVisualDatabaseUrl(
    process.env.PROVIDER_VISUAL_DATABASE_URL,
  );
  const prisma = createPrismaClient({ databaseUrl, poolMax: 4 });
  try {
    const result = await seedProviderSetupVisualFixtures(prisma, {
      rotating: process.argv.includes("--rotating"),
      personalSharing: !process.argv.includes("--no-personal-sharing"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
