import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  parseReviewConfigurationStrict,
  resolveEffectiveReviewConfiguration,
  resolveEffectiveReviewConfigurations,
  resolveReviewRuntimeEnv,
  type ReviewPolicyHead,
  type ReviewPolicyHeadReaderPort,
  type WorkspaceProviderProfile,
} from "../index";
import {
  providerProfileFixture,
  repositoryPolicyDocumentFixture,
  storedPolicyHeadFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "./current-policy-fixture";

const workspaceId = "workspace_1";
const repositoryTarget = {
  scope: "repository",
  workspaceId,
  repositoryId: "repository_1",
} as const;

const claudeProfile = providerProfileFixture({
  id: "profile_claude",
  credential: { kind: "user_ci_secret", authMode: "claude_code_oauth" },
  model: "sonnet",
});
const gatewayProfile = providerProfileFixture({
  id: "profile_gateway",
  credential: {
    kind: "gateway_binding",
    authMode: "codex_account_gateway",
    bindingId: "binding_1",
    gatewayProfileRef: "account_profile_1",
  },
  model: "gpt-5.6-sol",
});
const rotatingProfile = providerProfileFixture({
  id: "profile_rotating",
  credential: {
    kind: "repository_rotating",
    authMode: "codex_subscription_oauth_rotating",
    repositoryId: "repository_1",
  },
  model: workspaceProviderFixture.model,
});
const profiles = [claudeProfile, gatewayProfile, rotatingProfile];

/** The runtime configuration the stored documents must materialize. */
function runtime(providers: readonly unknown[], overrides: object = {}) {
  return parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers,
    execution: { ...workspacePolicyFixture.execution, providerLimit: 1 },
    ...overrides,
  });
}
const claudeConfig = runtime([
  {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  },
]);
const gatewayConfig = runtime([
  {
    kind: "codex",
    authMode: "codex_account_gateway",
    model: "gpt-5.6-sol",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
    gatewayBindingId: "binding_1",
    gatewayProfileRef: "account_profile_1",
  },
]);
const workspaceDefault = workspacePolicyDocumentFixture(claudeConfig, [
  claudeProfile.id,
]);
const workspaceWithoutDefault = workspacePolicyDocumentFixture(claudeConfig);

function head(
  version: number,
  policy: Parameters<typeof storedPolicyHeadFixture>[0],
): ReviewPolicyHead {
  return storedPolicyHeadFixture(policy, version);
}

function policyHeads(
  workspace: ReviewPolicyHead | null,
  repositories: Readonly<Record<string, ReviewPolicyHead>> = {},
  stored: readonly WorkspaceProviderProfile[] = profiles,
): ReviewPolicyHeadReaderPort {
  const byId = new Map(stored.map((profile) => [profile.id, profile]));
  const read = async () => ({
    workspace,
    repositories: new Map(Object.entries(repositories)),
    profiles: byId,
  });
  return {
    readPolicyHeads: async (target) => ({
      workspace,
      repository:
        target.scope === "repository"
          ? (repositories[target.repositoryId] ?? null)
          : null,
      profiles: byId,
    }),
    readRepositoryPolicyHeads: read,
    readWorkspacePolicyHeads: read,
    readProviderProfiles: async () => byId,
  };
}

function digest(config: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
}

describe("resolveEffectiveReviewConfiguration", () => {
  it("materializes exactly the runtime configuration of the selected profiles", async () => {
    // The stored documents and profiles resolve to the same runtime bytes and
    // digest as the configuration they describe.
    const resolved = await resolveEffectiveReviewConfiguration(
      { scope: "workspace", workspaceId },
      { policyHeads: policyHeads(head(2, workspaceDefault)) },
    );
    expect(resolved).toEqual({
      status: "ready",
      version: 2,
      config: claudeConfig,
      policy: workspaceDefault,
      source: "workspace",
      workspaceVersion: 2,
      repositoryVersion: null,
      effectivePolicyDigest: digest(claudeConfig),
      revisionToken: `policy:2:0:${digest(claudeConfig)}`,
      selections: workspaceDefault.providers,
    });
  });

  it("lets a repository selection win over the workspace default", async () => {
    const own = repositoryPolicyDocumentFixture(
      gatewayConfig,
      [gatewayProfile.id],
      { reviewLanguage: "Russian" },
    );
    const resolved = await resolveEffectiveReviewConfiguration(
      repositoryTarget,
      {
        policyHeads: policyHeads(head(2, workspaceDefault), {
          repository_1: head(5, own),
        }),
      },
    );
    const config = runtime(gatewayConfig.providers, {
      reviewLanguage: "Russian",
    });
    expect(resolved).toMatchObject({
      status: "ready",
      version: 5,
      config,
      source: "repository",
      workspaceVersion: 2,
      repositoryVersion: 5,
      effectivePolicyDigest: digest(config),
      selections: own.providers,
    });
  });

  it("inherits the workspace default for a repository without a selection", async () => {
    const overridesOnly = {
      schemaVersion: 4,
      reviewLanguage: "German",
    } as const;
    const withDocument = await resolveEffectiveReviewConfiguration(
      repositoryTarget,
      {
        policyHeads: policyHeads(head(2, workspaceDefault), {
          repository_1: head(3, overridesOnly),
        }),
      },
    );
    expect(withDocument).toMatchObject({
      status: "ready",
      source: "repository",
      config: runtime(claudeConfig.providers, { reviewLanguage: "German" }),
      selections: workspaceDefault.providers,
    });
    const withoutDocument = await resolveEffectiveReviewConfiguration(
      repositoryTarget,
      { policyHeads: policyHeads(head(2, workspaceDefault)) },
    );
    expect(withoutDocument).toMatchObject({
      status: "ready",
      source: "workspace",
      version: 2,
      repositoryVersion: null,
      config: claudeConfig,
    });
  });

  it("requires a provider selection only without a default and without a repository selection", async () => {
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspaceWithoutDefault), {
          repository_1: head(3, { schemaVersion: 4, reviewLanguage: null }),
        }),
      }),
    ).resolves.toEqual({
      status: "provider_selection_required",
      workspaceVersion: 2,
      repositoryVersion: 3,
    });
    // No workspace document at all is the same case.
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(null),
      }),
    ).resolves.toEqual({
      status: "provider_selection_required",
      workspaceVersion: null,
      repositoryVersion: null,
    });
    // A repository selection of its own needs no default.
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspaceWithoutDefault), {
          repository_1: head(
            3,
            repositoryPolicyDocumentFixture(claudeConfig, [claudeProfile.id]),
          ),
        }),
      }),
    ).resolves.toMatchObject({ status: "ready", config: claudeConfig });
  });

  it.each([
    [
      "a retired workspace format",
      {
        version: 4,
        schemaVersion: 3,
        policyJson: JSON.stringify(workspacePolicyFixture),
      },
      null,
      profiles,
    ],
    [
      "an unreadable workspace document",
      { version: 4, schemaVersion: 4, policyJson: "{" },
      null,
      profiles,
    ],
    [
      "a workspace head without a document",
      { version: 4, schemaVersion: 4, policyJson: null },
      null,
      profiles,
    ],
    [
      "a retired repository format",
      head(4, workspaceDefault),
      { version: 9, schemaVersion: 3, policyJson: '{"schemaVersion":3}' },
      profiles,
    ],
    [
      "an archived selected profile",
      head(4, workspaceDefault),
      null,
      [{ ...claudeProfile, archivedAt: new Date() }],
    ],
    [
      "a selected profile that does not exist",
      head(4, workspaceDefault),
      null,
      [],
    ],
    [
      "a rotating profile as the workspace default",
      head(
        4,
        workspacePolicyDocumentFixture(workspacePolicyFixture, [
          rotatingProfile.id,
        ]),
      ),
      null,
      profiles,
    ],
    [
      "a repository override that no longer composes",
      head(4, workspaceDefault),
      head(9, {
        schemaVersion: 4,
        execution: { providerMaxParallel: 2 },
      }),
      profiles,
    ],
  ] as const)(
    "requires a resave for %s and keeps both head versions",
    async (_case, workspace, repository, stored) => {
      await expect(
        resolveEffectiveReviewConfiguration(repositoryTarget, {
          policyHeads: policyHeads(
            workspace,
            repository ? { repository_1: repository } : {},
            stored,
          ),
        }),
      ).resolves.toEqual({
        status: "resave_required",
        workspaceVersion: 4,
        repositoryVersion: repository?.version ?? null,
      });
    },
  );

  it("keeps a rotating profile on its own repository", async () => {
    const own = repositoryPolicyDocumentFixture(workspacePolicyFixture, [
      rotatingProfile.id,
    ]);
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspaceWithoutDefault), {
          repository_1: head(3, own),
        }),
      }),
    ).resolves.toMatchObject({
      status: "ready",
      config: { providers: workspacePolicyFixture.providers },
    });
    await expect(
      resolveEffectiveReviewConfiguration(
        { ...repositoryTarget, repositoryId: "repository_2" },
        {
          policyHeads: policyHeads(head(2, workspaceWithoutDefault), {
            repository_2: head(3, own),
          }),
        },
      ),
    ).resolves.toMatchObject({ status: "resave_required" });
  });

  it("maps the non-ready variants to the runtime error codes", async () => {
    await expect(
      resolveReviewRuntimeEnv(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspaceWithoutDefault)),
      }),
    ).rejects.toThrow("review_provider_selection_required");
    await expect(
      resolveReviewRuntimeEnv(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspaceDefault), {}, []),
      }),
    ).rejects.toThrow("review_policy_resave_required");
  });
});

describe("resolveEffectiveReviewConfigurations", () => {
  it("resolves every requested repository against one workspace head", async () => {
    const own = repositoryPolicyDocumentFixture(gatewayConfig, [
      gatewayProfile.id,
    ]);
    const resolved = await resolveEffectiveReviewConfigurations(
      {
        workspaceId,
        repositoryIds: ["repository_2", "repository_1", "repository_2"],
      },
      {
        policyHeads: policyHeads(head(2, workspaceDefault), {
          repository_1: head(5, own),
          repository_3: { version: 6, schemaVersion: 3, policyJson: "{}" },
        }),
      },
    );

    expect(resolved.workspace).toMatchObject({
      status: "ready",
      source: "workspace",
      version: 2,
    });
    expect([...resolved.repositories.keys()]).toEqual([
      "repository_2",
      "repository_1",
    ]);
    expect(resolved.repositories.get("repository_2")).toEqual(
      resolved.workspace,
    );
    expect(resolved.repositories.get("repository_1")).toMatchObject({
      status: "ready",
      source: "repository",
      version: 5,
      workspaceVersion: 2,
      config: gatewayConfig,
    });
  });

  it("keeps repository head versions when no default exists or the workspace is retired", async () => {
    const repositories = {
      repository_1: head(5, { schemaVersion: 4 }),
    };
    const unselected = await resolveEffectiveReviewConfigurations(
      { workspaceId, repositoryIds: ["repository_1", "repository_2"] },
      { policyHeads: policyHeads(null, repositories) },
    );
    expect(unselected.workspace).toEqual({
      status: "provider_selection_required",
      workspaceVersion: null,
      repositoryVersion: null,
    });
    expect(unselected.repositories.get("repository_1")).toEqual({
      status: "provider_selection_required",
      workspaceVersion: null,
      repositoryVersion: 5,
    });

    const retired = await resolveEffectiveReviewConfigurations(
      { workspaceId, repositoryIds: ["repository_1"] },
      {
        policyHeads: policyHeads(
          { version: 3, schemaVersion: 3, policyJson: "{}" },
          repositories,
        ),
      },
    );
    expect(retired.repositories.get("repository_1")).toEqual({
      status: "resave_required",
      workspaceVersion: 3,
      repositoryVersion: 5,
    });
  });
});
