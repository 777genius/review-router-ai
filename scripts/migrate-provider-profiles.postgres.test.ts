import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "../packages/platform/db/src/index";
import {
  canonicalJson,
  parseReviewConfigurationStrict,
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfigurations,
  type ReviewConfiguration,
} from "../packages/features/review-config/src/index";
import { workspacePolicyFixture } from "../packages/features/review-config/src/tests/current-policy-fixture";
import {
  migrateProviderProfiles,
  PROVIDER_PROFILE_MIGRATION_ACTOR,
  type WorkspaceMigrationReport,
} from "./migrate-provider-profiles";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

// Old-policy fixture on the migrated (000144) schema: schema 3 heads with a
// Gateway default, sparse rotating and OpenRouter overrides, a retired
// schema 2 head, a rotating workspace default and a workspace without anyone
// who could own the profiles.
databaseTests("one-time provider profile migration", () => {
  let prisma: PrismaClient;
  const prefix = `migrate-${randomUUID().slice(0, 8)}`;
  const org = `${prefix}-org`;
  const rotatingOrg = `${prefix}-rotating`;
  const orphan = `${prefix}-orphan`;
  const personal = `${prefix}-personal`;
  const owner = `${prefix}-owner`;
  const admin = `${prefix}-admin`;
  const personalUser = `${prefix}-personal-user`;
  const repo = (name: string) => `${prefix}-${name}`;
  const binding = `${prefix}-binding`;
  const workspaceIds = [org, rotatingOrg, orphan, personal];
  const options = {
    operatorWorkspaceId: undefined,
    personalAccountsEnabled: false,
    workspaceIds,
  };

  const provider = {
    rotating: {
      kind: "codex",
      authMode: "codex_subscription_oauth_rotating",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
    gateway: {
      kind: "codex",
      authMode: "codex_account_gateway",
      gatewayBindingId: binding,
      gatewayProfileRef: "profile-mimo",
      model: "mimo-v2-pro",
      reasoningEffort: "high",
      agenticContext: false,
      fastMode: true,
      requiredHealthy: true,
    },
    openrouter: {
      kind: "openrouter",
      authMode: "openrouter_api_key",
      model: "openai/gpt-5.3-codex",
      reasoningEffort: "high",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: false,
    },
    mimo: {
      kind: "codex-mimo",
      authMode: "mimo_token_plan_api_key",
      model: "mimo-v2.6-pro",
      reasoningEffort: "medium",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
    claude: {
      kind: "claude",
      authMode: "claude_code_oauth",
      model: "claude-opus-4-7",
      reasoningEffort: "high",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
  } as const;
  const workspaceConfig = (providers: readonly unknown[]) =>
    parseReviewConfigurationStrict({
      ...workspacePolicyFixture,
      providers,
      execution: {
        providerLimit: providers.length,
        providerMaxParallel: providers.length,
        inlineMinAgreement: 1,
      },
      blockingPolicy: { failOnSeverity: "major" },
      limits: { inlineMaxComments: 7, targetTokensPerBatch: 32000 },
      reviewLanguage: "Russian",
    });
  const orgConfig = workspaceConfig([provider.gateway]);
  // Sparse schema 3 overrides as the old repository editor stored them.
  const rotatingOverride = {
    schemaVersion: 3,
    providers: [provider.rotating, provider.mimo],
    execution: { providerLimit: 2, providerMaxParallel: 2 },
    limits: { inlineMaxComments: 0 },
  };
  const settingsOverride = {
    schemaVersion: 3,
    investigationRollout: { recordingEnabled: true },
  };
  const openrouterOverride = {
    schemaVersion: 3,
    providers: [provider.openrouter],
  };

  async function storeHead(input: {
    readonly workspaceId: string;
    readonly repositoryId?: string;
    readonly version: number;
    readonly schemaVersion: number;
    readonly policy: unknown;
  }) {
    const targetKey = input.repositoryId
      ? `repo:${input.repositoryId}`
      : "workspace:default";
    const configuration = await prisma.reviewConfiguration.upsert({
      where: {
        workspaceId_targetKey: { workspaceId: input.workspaceId, targetKey },
      },
      update: {},
      create: {
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId ?? null,
        targetKey,
      },
    });
    await prisma.reviewConfigurationVersion.create({
      data: {
        configurationId: configuration.id,
        workspaceId: input.workspaceId,
        version: input.version,
        schemaVersion: input.schemaVersion,
        policyJson: canonicalJson(input.policy),
      },
    });
  }

  async function repository(workspaceId: string, id: string) {
    await prisma.repositoryConnection.create({
      data: {
        id,
        workspaceId,
        externalRepositoryId: id,
        owner: "acme",
        name: id,
        fullName: `acme/${id}`,
        defaultBranch: "main",
        visibility: "private",
      },
    });
    await prisma.workflowProvisioning.create({
      data: {
        workspaceId,
        repositoryId: id,
        status: "configured",
        branch: "reviewrouter/setup",
        workflowPath: ".github/workflows/reviewrouter-review.yml",
        actionVersion: "workflow-v1",
      },
    });
  }

  async function snapshot() {
    const where = { workspaceId: { in: workspaceIds } };
    return {
      versions: await prisma.reviewConfigurationVersion.count({ where }),
      profiles: await prisma.workspaceProviderProfile.count({ where }),
      requirements: (
        await prisma.workflowProvisioning.findMany({
          where,
          orderBy: { repositoryId: "asc" },
          select: { repositoryId: true, installedWorkflowRequirement: true },
        })
      ).map((row) => [row.repositoryId, row.installedWorkflowRequirement]),
    };
  }

  beforeAll(async () => {
    prisma = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 4 });
    for (const id of [owner, admin, personalUser])
      await prisma.user.create({ data: { id } });
    for (const id of [org, rotatingOrg, orphan])
      await prisma.workspace.create({ data: { id, slug: id, name: id } });
    await prisma.workspace.create({
      data: {
        id: personal,
        slug: personal,
        name: personal,
        personalOwnerUserId: personalUser,
      },
    });
    await prisma.workspaceMember.createMany({
      data: [
        // The earliest owner creates; an invite without a user never does.
        { workspaceId: org, githubLogin: `${prefix}-invite`, role: "owner" },
        { workspaceId: org, userId: owner, role: "owner" },
        { workspaceId: org, userId: admin, role: "admin" },
        { workspaceId: rotatingOrg, userId: admin, role: "admin" },
      ],
    });
    const connection = await prisma.providerAccountConnection.create({
      data: {
        ownerWorkspaceId: org,
        gatewayAccountRef: `${prefix}-account`,
        profileRef: "profile-mimo",
        displayName: "Team account",
        state: "active",
      },
    });
    await prisma.workspaceAccountBinding.create({
      data: {
        id: binding,
        workspaceId: org,
        connectionId: connection.id,
        state: "active",
      },
    });
    for (const name of [
      "rotating",
      "inherits",
      "settings",
      "openrouter",
      "retired",
    ])
      await repository(org, repo(name));
    await repository(rotatingOrg, repo("rotating-inherits"));
    const mimoKey = await prisma.providerApiKeyConnection.create({
      data: {
        workspaceId: org,
        providerType: "mimo",
        encryptedApiKey: "test-ciphertext",
        keyVersion: 1,
        latestOperationId: `${prefix}-key-operation`,
      },
    });
    // The managed MiMo key is applied to the rotating repository only.
    await prisma.providerApiKeyRepositoryLink.create({
      data: {
        workspaceId: org,
        providerApiKeyConnectionId: mimoKey.id,
        repositoryId: repo("rotating"),
        status: "applied",
        attemptedKeyVersion: 1,
        appliedKeyVersion: 1,
      },
    });

    await storeHead({
      workspaceId: org,
      version: 3,
      schemaVersion: 3,
      policy: orgConfig,
    });
    await storeHead({
      workspaceId: org,
      repositoryId: repo("rotating"),
      version: 2,
      schemaVersion: 3,
      policy: rotatingOverride,
    });
    await storeHead({
      workspaceId: org,
      repositoryId: repo("settings"),
      version: 1,
      schemaVersion: 3,
      policy: settingsOverride,
    });
    await storeHead({
      workspaceId: org,
      repositoryId: repo("openrouter"),
      version: 1,
      schemaVersion: 3,
      policy: openrouterOverride,
    });
    await storeHead({
      workspaceId: org,
      repositoryId: repo("retired"),
      version: 1,
      schemaVersion: 2,
      policy: { schemaVersion: 2 },
    });
    await storeHead({
      workspaceId: rotatingOrg,
      version: 1,
      schemaVersion: 3,
      policy: workspaceConfig([provider.rotating]),
    });
    await storeHead({
      workspaceId: orphan,
      version: 1,
      schemaVersion: 3,
      policy: workspaceConfig([provider.claude]),
    });
    await storeHead({
      workspaceId: personal,
      version: 1,
      schemaVersion: 3,
      policy: workspaceConfig([provider.claude]),
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    const where = { workspaceId: { in: workspaceIds } };
    await prisma.workspaceProviderProfile.deleteMany({ where });
    await prisma.workspaceAccountBinding.deleteMany({ where });
    await prisma.providerAccountConnection.deleteMany({
      where: { ownerWorkspaceId: { in: workspaceIds } },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.$disconnect();
  });

  const byWorkspace = (reports: readonly WorkspaceMigrationReport[]) =>
    new Map(reports.map((report) => [report.workspaceId, report]));

  it("rolls a dry run back, converts once with schema 3 behavior and reruns as a no-op", async () => {
    const before = await snapshot();
    const dryRun = byWorkspace(
      await migrateProviderProfiles(prisma, { ...options, dryRun: true }),
    );
    expect(dryRun.get(org)).toMatchObject({
      status: "converted",
      creatorUserId: owner,
      profilesCreated: 3,
    });
    expect(await snapshot()).toEqual(before);

    const reports = byWorkspace(
      await migrateProviderProfiles(prisma, { ...options, dryRun: false }),
    );
    expect(reports.get(org)).toEqual({
      workspaceId: org,
      status: "converted",
      creatorUserId: owner,
      converted: [
        "workspace:default",
        `repo:${repo("rotating")}`,
        `repo:${repo("settings")}`,
      ],
      // Gateway default, rotating and managed MiMo of one repository; the
      // OpenRouter override has no managed key and stays on schema 3.
      profilesCreated: 3,
      installedRequirementsFilled: 4,
      warnings: [
        `repo:${repo("retired")}: schema 2 is not convertible; left unconverted`,
        `repo:${repo("openrouter")}: OpenRouter has no managed API key here; left unconverted`,
      ],
    });
    expect(dryRun.get(org)?.converted).toEqual(reports.get(org)?.converted);
    // A rotating default cannot stay a default: its settings are kept and
    // the inheriting repository is named.
    expect(reports.get(rotatingOrg)).toMatchObject({
      status: "converted",
      creatorUserId: admin,
      converted: ["workspace:default"],
      profilesCreated: 0,
      installedRequirementsFilled: 1,
      warnings: [
        "workspace:default: rotating Codex cannot be a workspace default; stored without a default provider",
        `repositories that inherited the workspace default now select no provider: ${repo("rotating-inherits")}`,
      ],
    });
    expect(reports.get(orphan)).toMatchObject({
      status: "skipped",
      converted: [],
    });
    expect(reports.get(personal)).toMatchObject({
      status: "converted",
      creatorUserId: personalUser,
      converted: ["workspace:default"],
      profilesCreated: 1,
    });

    // Materialization equivalence: every converted target reviews with the
    // schema 3 configuration; unconverted heads fail closed.
    const resolved = await resolveEffectiveReviewConfigurations(
      {
        workspaceId: org,
        repositoryIds: [
          repo("rotating"),
          repo("inherits"),
          repo("settings"),
          repo("openrouter"),
          repo("retired"),
        ],
      },
      { policyHeads: new PrismaReviewPolicyHeadReader(prisma) },
    );
    const ready = (repositoryId: string): ReviewConfiguration => {
      const effective = resolved.repositories.get(repositoryId);
      if (effective?.status !== "ready")
        throw new Error(`not_ready:${repositoryId}:${effective?.status}`);
      return effective.config;
    };
    expect(ready(repo("inherits"))).toEqual(orgConfig);
    expect(ready(repo("rotating"))).toEqual(
      parseReviewConfigurationStrict({
        ...orgConfig,
        providers: [provider.rotating, provider.mimo],
        execution: {
          ...orgConfig.execution,
          providerLimit: 2,
          providerMaxParallel: 2,
        },
        limits: { ...orgConfig.limits, inlineMaxComments: 0 },
      }),
    );
    expect(ready(repo("settings"))).toEqual(
      parseReviewConfigurationStrict({
        ...orgConfig,
        investigationRollout: {
          ...orgConfig.investigationRollout,
          recordingEnabled: true,
        },
      }),
    );
    for (const name of ["openrouter", "retired"])
      expect(resolved.repositories.get(repo(name))?.status).toBe(
        "resave_required",
      );

    // Profiles belong to the chosen creator; credentials stay references.
    const profiles = await prisma.workspaceProviderProfile.findMany({
      where: { workspaceId: org },
      orderBy: { credentialKind: "asc" },
    });
    expect(
      profiles.map((profile) => [
        profile.credentialKind,
        profile.authMode,
        profile.createdByUserId,
      ]),
    ).toEqual([
      ["gateway_binding", "codex_account_gateway", owner],
      ["managed_api_key", "mimo_token_plan_api_key", owner],
      ["repository_rotating", "codex_subscription_oauth_rotating", owner],
    ]);
    expect(
      await prisma.auditEvent.count({
        where: {
          workspaceId: org,
          actor: PROVIDER_PROFILE_MIGRATION_ACTOR,
          action: "review_config.migrated_to_provider_profiles",
        },
      }),
    ).toBe(3);
    // What the installed workflows were rendered for, from schema 3.
    expect(Object.fromEntries((await snapshot()).requirements)).toMatchObject({
      [repo("inherits")]: "gateway",
      [repo("settings")]: "gateway",
      // The rotating workflow passes the MiMo secret through.
      [repo("rotating")]: "rotating+codex-mimo",
      // A retired head had no configuration to render from.
      [repo("retired")]: null,
      // Schema 3 OpenRouter-only reviews used the provider API caller.
      [repo("openrouter")]: "provider_api",
      [repo("rotating-inherits")]: "rotating",
    });

    const converted = await snapshot();
    const rerun = await migrateProviderProfiles(prisma, {
      ...options,
      dryRun: false,
    });
    expect(rerun.map((report) => [report.workspaceId, report.status])).toEqual(
      [
        [org, "unchanged"],
        [orphan, "skipped"],
        [personal, "unchanged"],
        [rotatingOrg, "unchanged"],
      ].sort(([left], [right]) => left!.localeCompare(right!)),
    );
    expect(await snapshot()).toEqual(converted);
  });
});
