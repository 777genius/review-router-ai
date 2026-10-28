import { InMemoryReviewConfigurationRepository as InMemoryConfigurations } from "./in-memory-review-configuration";
import {
  providerProfileFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "./current-policy-fixture";
import {
  parseReviewConfigurationStrict,
  type ReviewProviderConfiguration,
} from "../domain/review-configuration";
import type { ProviderCredentialSource } from "../domain/workspace-provider-profile";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  getOperatorReviewConfiguration,
  HashedReviewConfigurationOperatorAuthorization,
  ReviewConfigurationOperatorError,
  ReviewConfigurationOperatorErrorCode,
  ReviewConfigurationOperatorOperation,
  ReviewReasoningEffort,
  setOperatorReviewReasoningEffort,
  type OperatorReviewConfigurationDependencies,
  type ReviewConfigurationOperatorAuditEvent,
  type ReviewConfigurationOperatorRepository,
  ReviewConfigurationWriteConflictError,
  resolveReviewConfiguration,
} from "../index";

const credential = "operator-credential-with-at-least-32-characters";
const repository = {
  id: "repo_1",
  workspaceId: "workspace_1",
  workspaceSlug: "workspace-one",
  provider: "github",
  sourceBaseUrl: "https://github.com",
  fullName: "777genius/example",
} satisfies ReviewConfigurationOperatorRepository;
const workspaceTarget = {
  scope: "workspace" as const,
  workspaceId: repository.workspaceId,
};
const repositoryTarget = {
  scope: "repository" as const,
  workspaceId: repository.workspaceId,
  repositoryId: repository.id,
};
// A hosted pool Codex provider can be the workspace default.
const codexProvider = {
  ...workspaceProviderFixture,
  authMode: "codex_subscription_oauth_hosted_pool",
} as const;

class CapturingAuditLog {
  readonly events: ReviewConfigurationOperatorAuditEvent[] = [];

  async record(event: ReviewConfigurationOperatorAuditEvent): Promise<void> {
    this.events.push(event);
  }
}

function credentialFor(
  provider: ReviewProviderConfiguration,
): ProviderCredentialSource {
  switch (provider.authMode) {
    case "codex_subscription_oauth_hosted_pool":
      return { kind: "hosted_pool", authMode: provider.authMode };
    case "openrouter_api_key":
      return {
        kind: "managed_api_key",
        authMode: provider.authMode,
        apiKeyConnectionId: "key_openrouter",
      };
    case "claude_code_oauth":
    case "mimo_token_plan_api_key":
      return { kind: "user_ci_secret", authMode: provider.authMode };
    default:
      throw new Error(`unsupported_fixture:${provider.authMode}`);
  }
}

/** Stores the configuration as the workspace default over its own profiles. */
async function seedWorkspace(
  configurations: InMemoryConfigurations,
  config: ReturnType<typeof parseReviewConfigurationStrict>,
) {
  const profileIds = config.providers.map((provider, index) => {
    const profile = providerProfileFixture({
      id: `profile_${configurations.profiles.size}_${index}`,
      workspaceId: repository.workspaceId,
      credential: credentialFor(provider),
      model: provider.model,
    });
    configurations.addProfile(profile);
    return profile.id;
  });
  return configurations.saveNextVersion({
    target: workspaceTarget,
    policy: workspacePolicyDocumentFixture(config, profileIds),
  });
}

function workspaceConfig(
  providers: readonly ReviewProviderConfiguration[],
): ReturnType<typeof parseReviewConfigurationStrict> {
  return parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers,
    execution: {
      providerLimit: providers.length,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
  });
}

async function createDependencies(
  candidates: readonly ReviewConfigurationOperatorRepository[] = [repository],
) {
  const configurations = new InMemoryConfigurations();
  await seedWorkspace(
    configurations,
    workspaceConfig([
      { ...codexProvider, model: "gpt-5.6-sol", reasoningEffort: "xhigh" },
    ]),
  );
  configurations.saveCount = 0;
  const auditLog = new CapturingAuditLog();
  const mutations = {
    async commit(
      input: Parameters<
        OperatorReviewConfigurationDependencies["mutations"]["commit"]
      >[0],
    ) {
      const current = await resolveReviewConfiguration(input.target, {
        configurations,
      });
      if (!current || current.revisionToken !== input.expectedRevisionToken) {
        throw new ReviewConfigurationWriteConflictError();
      }
      const saved = await configurations.saveNextVersion({
        target: input.target,
        policy: input.policy,
        expectedVersion: current.repositoryVersion,
      });
      await auditLog.record({
        ...input.auditEvent,
        metadata: { ...input.auditEvent.metadata, version: saved.version },
      });
      return saved;
    },
  };
  const dependencies = {
    authorization: new HashedReviewConfigurationOperatorAuthorization(
      "operator:test",
      createHash("sha256").update(credential).digest("hex"),
    ),
    repositories: {
      async findActiveCandidates() {
        return candidates;
      },
    },
    rateLimits: {
      async consume() {
        return true;
      },
    },
    configurations,
    mutations,
    audit: auditLog,
  } satisfies OperatorReviewConfigurationDependencies;
  return { dependencies, configurations, auditLog };
}

async function repositoryConfig(configurations: InMemoryConfigurations) {
  return (await configurations.findLatest(repositoryTarget))?.config;
}

describe("operator review configuration", () => {
  it("refuses an operator update without a saved workspace policy", async () => {
    const { dependencies, configurations, auditLog } =
      await createDependencies();
    configurations.heads.clear();
    await expect(
      setOperatorReviewReasoningEffort(
        {
          credential,
          repositoryFullName: repository.fullName,
          provider: "github",
          effort: ReviewReasoningEffort.High,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.ConfigurationMissing,
    });
    expect(configurations.saveCount).toBe(0);
    expect(auditLog.events).toEqual([]);
  });

  it("rejects invalid credentials without repository lookup or audit output", async () => {
    const { dependencies, auditLog } = await createDependencies();
    let repositoryLookups = 0;
    let rateLimitCalls = 0;
    const guardedDependencies = {
      ...dependencies,
      rateLimits: {
        async consume() {
          rateLimitCalls += 1;
          return true;
        },
      },
      repositories: {
        async findActiveCandidates() {
          repositoryLookups += 1;
          return [repository];
        },
      },
    };

    await expect(
      getOperatorReviewConfiguration(
        {
          credential: "wrong",
          repositoryFullName: repository.fullName,
          provider: "github",
        },
        guardedDependencies,
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.Unauthorized,
    });
    expect(rateLimitCalls).toBe(0);
    expect(repositoryLookups).toBe(0);
    expect(auditLog.events).toEqual([]);
  });

  it("reports missing and ambiguous repositories explicitly", async () => {
    const missing = await createDependencies([]);
    await expect(
      getOperatorReviewConfiguration(
        {
          credential,
          repositoryFullName: repository.fullName,
          provider: "github",
        },
        missing.dependencies,
      ),
    ).rejects.toEqual(
      new ReviewConfigurationOperatorError(
        ReviewConfigurationOperatorErrorCode.RepositoryNotFound,
      ),
    );

    const ambiguous = await createDependencies([
      repository,
      { ...repository, id: "repo_2", workspaceId: "workspace_2" },
    ]);
    await expect(
      getOperatorReviewConfiguration(
        {
          credential,
          repositoryFullName: repository.fullName,
          provider: "github",
        },
        ambiguous.dependencies,
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.RepositoryAmbiguous,
    });
  });

  it("creates a repository override even when the inherited effort is equal", async () => {
    const { dependencies, configurations, auditLog } =
      await createDependencies();

    const result = await setOperatorReviewReasoningEffort(
      {
        credential,
        repositoryFullName: repository.fullName,
        provider: "github",
        effort: ReviewReasoningEffort.XHigh,
      },
      dependencies,
    );

    expect(result).toMatchObject({
      changed: true,
      previousSource: "workspace",
      source: "repository",
      reasoningEffort: ReviewReasoningEffort.XHigh,
    });
    expect(configurations.saveCount).toBe(1);
    expect(auditLog.events).toHaveLength(1);
    expect(auditLog.events[0]).toMatchObject({
      actor: "operator:test",
      action: "review_config.operator_reasoning_effort_set",
      metadata: {
        changed: true,
        previousSource: "workspace",
        effort: "xhigh",
      },
    });
    expect(JSON.stringify(auditLog.events)).not.toContain(credential);
  });

  it.each([ReviewReasoningEffort.Max, ReviewReasoningEffort.Ultra])(
    "rejects %s for an inherited Codex model that does not support it",
    async (effort) => {
      const { dependencies, configurations } = await createDependencies();
      await seedWorkspace(
        configurations,
        workspaceConfig([{ ...codexProvider, model: "gpt-5.5" }]),
      );

      await expect(
        setOperatorReviewReasoningEffort(
          {
            credential,
            repositoryFullName: repository.fullName,
            provider: "github",
            effort,
          },
          dependencies,
        ),
      ).rejects.toMatchObject({
        code: ReviewConfigurationOperatorErrorCode.UnsupportedReasoningEffort,
      });
      expect(configurations.saveCount).toBe(1);
    },
  );

  it("updates only the runtime-selected Codex-backed provider and is idempotent", async () => {
    const { dependencies, configurations, auditLog } =
      await createDependencies();
    const secondProvider = {
      ...workspaceProviderFixture,
      kind: "openrouter" as const,
      authMode: "openrouter_api_key" as const,
      model: "openai/gpt-5.5",
      requiredHealthy: false,
    };
    await seedWorkspace(
      configurations,
      workspaceConfig([codexProvider, secondProvider]),
    );
    configurations.saveCount = 0;

    const first = await setOperatorReviewReasoningEffort(
      {
        credential,
        repositoryFullName: repository.fullName,
        provider: "github",
        effort: ReviewReasoningEffort.High,
      },
      dependencies,
    );
    const second = await setOperatorReviewReasoningEffort(
      {
        credential,
        repositoryFullName: repository.fullName,
        provider: "github",
        effort: ReviewReasoningEffort.High,
      },
      dependencies,
    );

    expect(first).toMatchObject({
      changed: true,
      previousSource: "workspace",
      providers: 2,
      reasoningEffort: ReviewReasoningEffort.High,
    });
    expect(second).toMatchObject({
      changed: false,
      previousSource: "repository",
      providers: 2,
    });
    expect(configurations.saveCount).toBe(1);
    const savedConfig = await repositoryConfig(configurations);
    expect(savedConfig?.providers[0]?.reasoningEffort).toBe("high");
    expect(savedConfig?.providers[1]?.reasoningEffort).toBe("high");
    expect(savedConfig?.providers).toHaveLength(2);
    expect(auditLog.events).toHaveLength(2);
    expect(auditLog.events[1]?.metadata).toMatchObject({ changed: false });
  });

  it("preserves a non-Codex primary provider", async () => {
    const { dependencies, configurations } = await createDependencies();
    const claudeProvider = {
      ...workspaceProviderFixture,
      kind: "claude" as const,
      authMode: "claude_code_oauth" as const,
      model: "sonnet",
      reasoningEffort: "medium" as const,
    };
    await seedWorkspace(
      configurations,
      workspaceConfig([
        claudeProvider,
        { ...codexProvider, requiredHealthy: false },
      ]),
    );

    await setOperatorReviewReasoningEffort(
      {
        credential,
        repositoryFullName: repository.fullName,
        provider: "github",
        effort: ReviewReasoningEffort.High,
      },
      dependencies,
    );

    const savedConfig = await repositoryConfig(configurations);
    expect(savedConfig?.providers[0]).toEqual(claudeProvider);
    expect(savedConfig?.providers[1]?.reasoningEffort).toBe("high");
  });

  it("returns the effective source and records a sanitized read audit", async () => {
    const { dependencies, auditLog } = await createDependencies();

    const result = await getOperatorReviewConfiguration(
      {
        credential,
        repositoryFullName: repository.fullName,
        provider: "github",
      },
      dependencies,
    );

    expect(result).toMatchObject({
      repository: repository.fullName,
      workspaceSlug: repository.workspaceSlug,
      source: "workspace",
      version: 1,
      reasoningEffort: ReviewReasoningEffort.XHigh,
    });
    expect(auditLog.events[0]).toMatchObject({
      action: "review_config.operator_read",
      targetId: repository.id,
    });
    expect(JSON.stringify(auditLog.events)).not.toContain(credential);
  });

  it("fails before repository lookup when the operator rate limit is exhausted", async () => {
    const { dependencies } = await createDependencies();
    let repositoryLookups = 0;

    await expect(
      getOperatorReviewConfiguration(
        {
          credential,
          repositoryFullName: repository.fullName,
          provider: "github",
        },
        {
          ...dependencies,
          rateLimits: {
            async consume() {
              return false;
            },
          },
          repositories: {
            async findActiveCandidates() {
              repositoryLookups += 1;
              return [repository];
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.RateLimited,
    });
    expect(repositoryLookups).toBe(0);
  });

  it("rejects an invalid repository before consuming rate-limit capacity", async () => {
    const { dependencies } = await createDependencies();
    let rateLimitCalls = 0;

    await expect(
      getOperatorReviewConfiguration(
        {
          credential,
          repositoryFullName: `owner/${"x".repeat(300)}`,
          provider: "github",
        },
        {
          ...dependencies,
          rateLimits: {
            async consume() {
              rateLimitCalls += 1;
              return true;
            },
          },
        },
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.InvalidRepository,
    });
    expect(rateLimitCalls).toBe(0);
  });

  it("maps an optimistic write conflict to a stable operator error", async () => {
    const { dependencies, configurations, auditLog } =
      await createDependencies();
    configurations.conflictNextSave = true;

    await expect(
      setOperatorReviewReasoningEffort(
        {
          credential,
          repositoryFullName: repository.fullName,
          provider: "github",
          effort: ReviewReasoningEffort.High,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.ConfigurationChanged,
    });
    expect(auditLog.events).toEqual([]);
  });

  it("rejects effort updates when no Codex-backed provider exists", async () => {
    const { dependencies, configurations } = await createDependencies();
    const claudeProvider = {
      ...workspaceProviderFixture,
      kind: "claude" as const,
      authMode: "claude_code_oauth" as const,
      model: "sonnet",
    };
    await seedWorkspace(configurations, workspaceConfig([claudeProvider]));

    await expect(
      setOperatorReviewReasoningEffort(
        {
          credential,
          repositoryFullName: repository.fullName,
          provider: "github",
          effort: ReviewReasoningEffort.High,
        },
        dependencies,
      ),
    ).rejects.toMatchObject({
      code: ReviewConfigurationOperatorErrorCode.ReviewProviderNotFound,
    });
  });
});

describe("hashed operator authorization", () => {
  it("normalizes configured identity and digest", async () => {
    const authorization = new HashedReviewConfigurationOperatorAuthorization(
      "  operator:test  ",
      createHash("sha256").update(credential).digest("hex").toUpperCase(),
    );

    await expect(
      authorization.authenticate({
        credential,
        operation: ReviewConfigurationOperatorOperation.Read,
      }),
    ).resolves.toEqual({ operatorId: "operator:test" });
  });

  it("rejects invalid credentials and malformed configuration", async () => {
    const authorization = new HashedReviewConfigurationOperatorAuthorization(
      "operator:test",
      createHash("sha256").update(credential).digest("hex"),
    );
    await expect(
      authorization.authenticate({
        credential: `${credential}-wrong`,
        operation: ReviewConfigurationOperatorOperation.Read,
      }),
    ).resolves.toBeNull();
    expect(
      () =>
        new HashedReviewConfigurationOperatorAuthorization(
          "operator:test",
          "not-a-digest",
        ),
    ).toThrow("review_configuration_operator_credential_hash_invalid");
  });
});
