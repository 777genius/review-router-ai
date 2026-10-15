import { workspacePolicyFixture } from "./current-policy-fixture";
import { describe, expect, it, vi } from "vitest";
import {
  findRepositoryReviewConfigurations,
  PrismaReviewConfigurationRepository,
  type PersistedReviewConfiguration,
  type ReviewConfigurationBatchReaderPort,
} from "../index";

describe("findRepositoryReviewConfigurations", () => {
  it("preserves requested order and duplicates while representing missing overrides as null", async () => {
    const saved = {
      version: 4,
      revisionToken: "db:version_4",
      config: workspacePolicyFixture,
      policy: { schemaVersion: 3 },
      source: "repository",
      workspaceVersion: 1,
      repositoryVersion: 4,
      effectivePolicyDigest: "a".repeat(64),
    } satisfies PersistedReviewConfiguration;
    const findLatestForRepositories = vi.fn(
      async (): ReturnType<
        ReviewConfigurationBatchReaderPort["findLatestForRepositories"]
      > => [{ repositoryId: "repository_2", config: saved }],
    );

    await expect(
      findRepositoryReviewConfigurations(
        {
          workspaceId: "workspace_1",
          repositoryIds: ["repository_2", "repository_missing", "repository_2"],
        },
        { configurations: { findLatestForRepositories } },
      ),
    ).resolves.toEqual([
      { repositoryId: "repository_2", config: saved },
      { repositoryId: "repository_missing", config: null },
      { repositoryId: "repository_2", config: saved },
    ]);
    expect(findLatestForRepositories).toHaveBeenCalledOnce();
    expect(findLatestForRepositories).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      repositoryIds: ["repository_2", "repository_missing"],
    });
  });

  it("does not query the port for an empty request", async () => {
    const findLatestForRepositories = vi.fn(async () => []);

    await expect(
      findRepositoryReviewConfigurations(
        { workspaceId: "workspace_1", repositoryIds: [] },
        { configurations: { findLatestForRepositories } },
      ),
    ).resolves.toEqual([]);
    expect(findLatestForRepositories).not.toHaveBeenCalled();
  });
});

describe("PrismaReviewConfigurationRepository batch reads", () => {
  it("loads latest revisions and provider rows for all unique IDs with one workspace read and one bounded repository query", async () => {
    const findMany = vi.fn(async () => [
      {
        repositoryId: "repository_2",
        versions: [
          versionRow({
            id: "version_7",
            version: 7,
            providers: [
              providerRow({ model: "gpt-5.6-sol", requiredHealthy: true }),
              providerRow({
                kind: "openrouter",
                authMode: "openrouter_api_key",
                model: "poolside/laguna-m.1:free",
                requiredHealthy: false,
              }),
            ],
          }),
        ],
      },
      { repositoryId: "repository_missing", versions: [] },
    ]);
    const findUnique = vi.fn(async () => ({
      active: true,
      repositoryId: null,
      versions: [
        {
          version: 1,
          schemaVersion: 3,
          policyJson: JSON.stringify(workspacePolicyFixture),
        },
      ],
    }));
    const repository = new PrismaReviewConfigurationRepository({
      reviewConfiguration: { findMany, findUnique },
    } as never);

    await expect(
      repository.findLatestForRepositories({
        workspaceId: "workspace_1",
        repositoryIds: ["repository_2", "repository_missing", "repository_2"],
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        repositoryId: "repository_2",
        config: expect.objectContaining({
          version: 7,
          revisionToken: expect.stringMatching(/^policy:1:7:/),
          config: expect.objectContaining({
            providers: [
              expect.objectContaining({ model: "gpt-5.6-sol" }),
              expect.objectContaining({
                model: "poolside/laguna-m.1:free",
              }),
            ],
          }),
        }),
      }),
    ]);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        repositoryId: {
          in: ["repository_2", "repository_missing"],
        },
        active: true,
      },
      orderBy: { repositoryId: "asc" },
      select: {
        repositoryId: true,
        versions: expect.objectContaining({
          orderBy: { version: "desc" },
          take: 1,
          select: expect.objectContaining({
            providers: {
              orderBy: { order: "asc" },
              select: expect.any(Object),
            },
          }),
        }),
      },
    });
  });

  it("keeps database reads bounded for 1000 repositories without creating overrides", async () => {
    const findUnique = vi.fn(async () => ({
      active: true,
      repositoryId: null,
      versions: [
        {
          version: 1,
          schemaVersion: 3,
          policyJson: JSON.stringify(workspacePolicyFixture),
        },
      ],
    }));
    const findMany = vi.fn(async (_input: unknown) => []);
    const repository = new PrismaReviewConfigurationRepository({
      reviewConfiguration: { findUnique, findMany },
    } as never);
    const repositoryIds = Array.from(
      { length: 1000 },
      (_, index) => `repository_${index}`,
    );
    await expect(
      repository.findLatestForRepositories({
        workspaceId: "workspace_1",
        repositoryIds,
      }),
    ).resolves.toEqual([]);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { repositoryId: { in: repositoryIds } },
    });
  });

  it("does not query Prisma for an empty request", async () => {
    const findMany = vi.fn(async () => []);
    const repository = new PrismaReviewConfigurationRepository({
      reviewConfiguration: { findMany },
    } as never);

    await expect(
      repository.findLatestForRepositories({
        workspaceId: "workspace_1",
        repositoryIds: [],
      }),
    ).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });
});

function providerRow(input: {
  readonly kind?: string;
  readonly authMode?: string;
  readonly model: string;
  readonly requiredHealthy: boolean;
}) {
  return {
    providerKind: input.kind ?? "codex",
    providerAuthMode: input.authMode ?? "codex_subscription_oauth",
    model: input.model,
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: input.requiredHealthy,
  };
}

function versionRow(input: {
  readonly id: string;
  readonly version: number;
  readonly providers: ReturnType<typeof providerRow>[];
}) {
  return {
    id: input.id,
    version: input.version,
    schemaVersion: 3,
    policyJson: JSON.stringify({
      schemaVersion: 3,
      providers: input.providers.map(
        ({ providerKind: kind, providerAuthMode: authMode, ...provider }) => ({
          kind,
          authMode,
          ...provider,
        }),
      ),
      execution: {
        providerLimit: input.providers.length,
        providerMaxParallel: input.providers.length,
        inlineMinAgreement: 1,
      },
    }),
    providerKind: input.providers[0]!.providerKind,
    providerAuthMode: input.providers[0]!.providerAuthMode,
    model: input.providers[0]!.model,
    reasoningEffort: input.providers[0]!.reasoningEffort,
    agenticContext: true,
    fastMode: false,
    failOnSeverity: "critical",
    inlineMaxComments: 50,
    providerLimit: 2,
    providerMaxParallel: 2,
    inlineMinAgreement: 1,
    targetTokensPerBatch: 12000,
    reviewLanguage: null,
    investigationRecordingEnabled: true,
    investigationShadowEnabled: true,
    investigationContextCriticEnabled: true,
    investigationVerifiedCleanEnabled: true,
    investigationCrossRevisionReplayEnabled: false,
    investigationProductionEffectsEnabled: true,
    providers: input.providers,
  };
}
