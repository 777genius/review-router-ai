import {
  providerProfileFixture,
  providerProfileRowFixture,
  repositoryPolicyDocumentFixture,
  storedPolicyHeadFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "./current-policy-fixture";
import { describe, expect, it, vi } from "vitest";
import {
  parseReviewConfigurationStrict,
  PrismaReviewPolicyHeadReader,
  resolveEffectiveReviewConfigurations,
} from "../index";

const hostedProfile = providerProfileFixture({
  id: "profile_hosted",
  credential: {
    kind: "hosted_pool",
    authMode: "codex_subscription_oauth_hosted_pool",
  },
  model: workspaceProviderFixture.model,
});
const rotatingProfile = providerProfileFixture({
  id: "profile_rotating",
  credential: {
    kind: "repository_rotating",
    authMode: "codex_subscription_oauth_rotating",
    repositoryId: "repository_2",
  },
  model: "gpt-5.6-sol",
});
const openRouterProfile = providerProfileFixture({
  id: "profile_openrouter",
  credential: {
    kind: "managed_api_key",
    authMode: "openrouter_api_key",
    apiKeyConnectionId: "key_openrouter",
  },
  model: "poolside/laguna-m.1:free",
});
const profiles = [hostedProfile, rotatingProfile, openRouterProfile];
const hostedWorkspace = parseReviewConfigurationStrict({
  ...workspacePolicyFixture,
  providers: [
    {
      ...workspaceProviderFixture,
      authMode: "codex_subscription_oauth_hosted_pool",
    },
  ],
});
const workspaceHead = storedPolicyHeadFixture(
  workspacePolicyDocumentFixture(hostedWorkspace, [hostedProfile.id]),
);

/** Profiles by ID, as the bounded profile read returns them. */
function profileReader() {
  return vi.fn(async (input: { where: { id: { in: string[] } } }) =>
    profiles
      .filter((profile) => input.where.id.in.includes(profile.id))
      .map(providerProfileRowFixture),
  );
}

describe("PrismaReviewPolicyHeadReader batch reads", () => {
  it("loads latest revisions for all unique IDs with one workspace read and one bounded repository query", async () => {
    const repositoryConfig = parseReviewConfigurationStrict({
      ...workspacePolicyFixture,
      providers: [
        { ...workspaceProviderFixture, model: "gpt-5.6-sol" },
        {
          ...workspaceProviderFixture,
          kind: "openrouter",
          authMode: "openrouter_api_key",
          model: "poolside/laguna-m.1:free",
          requiredHealthy: false,
        },
      ],
      execution: {
        providerLimit: 2,
        providerMaxParallel: 2,
        inlineMinAgreement: 1,
      },
    });
    const findMany = vi.fn(async () => [
      {
        repositoryId: "repository_2",
        versions: [
          storedPolicyHeadFixture(
            repositoryPolicyDocumentFixture(
              repositoryConfig,
              [rotatingProfile.id, openRouterProfile.id],
              { execution: { providerMaxParallel: 2 } },
            ),
            7,
          ),
        ],
      },
      { repositoryId: "repository_missing", versions: [] },
    ]);
    const findUnique = vi.fn(async () => ({ versions: [workspaceHead] }));
    const profileFindMany = profileReader();
    const resolved = await resolveEffectiveReviewConfigurations(
      {
        workspaceId: "workspace_1",
        repositoryIds: ["repository_2", "repository_missing", "repository_2"],
      },
      {
        policyHeads: new PrismaReviewPolicyHeadReader({
          reviewConfiguration: { findMany, findUnique },
          workspaceProviderProfile: { findMany: profileFindMany },
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
    expect(resolved.repositories.get("repository_2")).toMatchObject({
      config: repositoryConfig,
    });
    expect(resolved.repositories.get("repository_missing")).toMatchObject({
      status: "ready",
      source: "workspace",
      config: hostedWorkspace,
    });
    // One bounded read of every referenced profile.
    expect(profileFindMany).toHaveBeenCalledOnce();
    expect(profileFindMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace_1",
        id: { in: profiles.map((p) => p.id) },
      },
      orderBy: { id: "asc" },
    });
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
    const findUnique = vi.fn(async () => ({ versions: [workspaceHead] }));
    const profileFindMany = profileReader();
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
          workspaceProviderProfile: { findMany: profileFindMany },
        } as never),
      },
    );
    expect(resolved.repositories.size).toBe(1000);
    // Each repository resolves for its own target and inherits the default.
    for (const policy of resolved.repositories.values())
      expect(policy).toEqual(resolved.workspace);
    expect(resolved.workspace).toMatchObject({
      status: "ready",
      config: hostedWorkspace,
    });
    expect(profileFindMany).toHaveBeenCalledOnce();
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
    // Without a workspace document there is nothing to select from.
    expect(resolved.workspace.status).toBe("provider_selection_required");
    expect(resolved.repositories.size).toBe(0);
    expect(findUnique).toHaveBeenCalledOnce();
    expect(findMany).not.toHaveBeenCalled();
  });
});
