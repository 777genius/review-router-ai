import { workspacePolicyFixture } from "./current-policy-fixture";
import { describe, expect, it, vi } from "vitest";
import {
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfigurations,
} from "../index";

describe("PrismaReviewPolicyHeadReader batch reads", () => {
  it("loads latest revisions for all unique IDs with one workspace read and one bounded repository query", async () => {
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
      versions: [
        {
          version: 1,
          schemaVersion: 3,
          policyJson: JSON.stringify(workspacePolicyFixture),
        },
      ],
    }));
    const resolved = await resolveEffectiveReviewConfigurations(
      {
        workspaceId: "workspace_1",
        repositoryIds: ["repository_2", "repository_missing", "repository_2"],
      },
      {
        policyHeads: new PrismaReviewPolicyHeadReader({
          reviewConfiguration: { findMany, findUnique },
        } as never),
      },
    );

    expect(resolved.repositories.get("repository_2")).toMatchObject({
      status: "ready",
      source: "repository",
      version: 7,
      revisionToken: expect.stringMatching(/^policy:1:7:/),
      config: expect.objectContaining({
        providers: [
          expect.objectContaining({ model: "gpt-5.6-sol" }),
          expect.objectContaining({ model: "poolside/laguna-m.1:free" }),
        ],
      }),
    });
    expect(resolved.repositories.get("repository_missing")).toBe(
      resolved.workspace,
    );
    expect(findUnique).toHaveBeenCalledOnce();
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        workspaceId_targetKey: {
          workspaceId: "workspace_1",
          targetKey: "workspace:default",
        },
        active: true,
      },
      select: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, schemaVersion: true, policyJson: true },
        },
      },
    });
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
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          select: { version: true, schemaVersion: true, policyJson: true },
        },
      },
    });
  });

  it("keeps database reads bounded for 1000 repositories without creating overrides", async () => {
    const findUnique = vi.fn(async () => ({
      versions: [
        {
          version: 1,
          schemaVersion: 3,
          policyJson: JSON.stringify(workspacePolicyFixture),
        },
      ],
    }));
    const findMany = vi.fn(async (input: unknown) => {
      expect(input).toBeDefined();
      return [];
    });
    const repositoryIds = Array.from(
      { length: 1000 },
      (_, index) => `repository_${index}`,
    );
    const resolved = await resolveEffectiveReviewConfigurations(
      { workspaceId: "workspace_1", repositoryIds },
      {
        policyHeads: new PrismaReviewPolicyHeadReader({
          reviewConfiguration: { findUnique, findMany },
        } as never),
      },
    );
    expect(resolved.repositories.size).toBe(1000);
    expect(
      [...resolved.repositories.values()].every(
        (policy) => policy === resolved.workspace,
      ),
    ).toBe(true);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(findMany).toHaveBeenCalledOnce();
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { repositoryId: { in: repositoryIds } },
    });
  });

  it("does not query repositories for an empty request", async () => {
    const findMany = vi.fn(async () => []);
    const findUnique = vi.fn(async () => null);

    const resolved = await resolveEffectiveReviewConfigurations(
      { workspaceId: "workspace_1", repositoryIds: [] },
      {
        policyHeads: new PrismaReviewPolicyHeadReader({
          reviewConfiguration: { findMany, findUnique },
        } as never),
      },
    );
    expect(resolved.workspace.status).toBe("missing");
    expect(resolved.repositories.size).toBe(0);
    expect(findUnique).toHaveBeenCalledOnce();
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
    providerAuthMode: input.authMode ?? "codex_subscription_oauth_rotating",
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
