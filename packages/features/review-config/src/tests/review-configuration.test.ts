import { reviewProviderConfigurationSchema } from "../domain/review-configuration";
import {
  providerProfileFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
  workspaceProviderFixture,
} from "./current-policy-fixture";
import { InMemoryReviewConfigurationRepository } from "./in-memory-review-configuration";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  findReviewConfiguration,
  clearReviewConfiguration,
  mapConfigToRuntimeEnv,
  parseReviewConfiguration,
  parseReviewConfigurationStrict,
  resolveReviewConfiguration,
  resolveReviewRuntimeEnv,
  resolveEffectiveReviewPolicy,
  reviewAgentProfileAgenticContextSaveIssue,
  saveReviewConfiguration,
} from "../index";

const enabledInvestigationRollout = {
  recordingEnabled: true,
  shadowEnabled: true,
  contextCriticEnabled: true,
  verifiedCleanEnabled: true,
  crossRevisionReplayEnabled: true,
  productionEffectsEnabled: true,
} as const;

const disabledInvestigationRollout = {
  recordingEnabled: false,
  shadowEnabled: false,
  contextCriticEnabled: false,
  verifiedCleanEnabled: false,
  crossRevisionReplayEnabled: false,
  productionEffectsEnabled: false,
} as const;

const disabledInvestigationRuntimeEnv = {
  REVIEW_ROUTER_REVIEW_INVESTIGATION_RECORDING_ENABLED: "0",
  REVIEW_ROUTER_REVIEW_INVESTIGATION_SHADOW_ENABLED: "0",
  REVIEW_ROUTER_REVIEW_INVESTIGATION_CONTEXT_CRITIC_ENABLED: "0",
  REVIEW_ROUTER_REVIEW_INVESTIGATION_VERIFIED_CLEAN_ENABLED: "0",
  REVIEW_ROUTER_REVIEW_INVESTIGATION_CROSS_REVISION_REPLAY_ENABLED: "0",
  REVIEW_ROUTER_REVIEW_INVESTIGATION_PRODUCTION_EFFECTS_ENABLED: "0",
} as const;

describe("review configuration", () => {
  it("maps an explicit workspace policy without secrets", () => {
    const env = mapConfigToRuntimeEnv(workspacePolicyFixture);
    expect(env).toMatchObject({
      REVIEW_AUTH_MODE: "codex-oauth-rotating",
      CODEX_MODEL: "gpt-5.5",
      CODEX_REASONING_EFFORT: "high",
      INLINE_MAX_COMMENTS: "5",
      ...disabledInvestigationRuntimeEnv,
    });
    expect(Object.keys(env).join("\n")).not.toMatch(/SECRET|KEY/);
  });

  it.each([
    [undefined, undefined, undefined, "true"],
    [false, undefined, false, "false"],
    [true, undefined, true, "true"],
    [undefined, false, false, "false"],
    [undefined, true, true, "true"],
    [false, true, true, "true"],
    [true, false, false, "false"],
  ] as const)(
    "resolves PR description workspace=%s override=%s without materializing defaults",
    (workspaceValue, repositoryValue, resolvedValue, runtimeValue) => {
      const workspace = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        ...(workspaceValue === undefined
          ? {}
          : { updatePrDescription: workspaceValue }),
      });
      const resolved = resolveEffectiveReviewPolicy({
        target: {
          scope: "repository",
          workspaceId: "workspace_1",
          repositoryId: "repo_1",
        },
        workspace: workspacePolicyDocumentFixture(workspace, [
          "profile_hosted_55",
        ]),
        repository: {
          schemaVersion: 4,
          ...(repositoryValue === undefined
            ? {}
            : { updatePrDescription: repositoryValue }),
        },
        profiles: repositoryWithProfiles().profiles,
      })!.config;
      expect(resolved.updatePrDescription).toBe(resolvedValue);
      expect(Object.hasOwn(resolved, "updatePrDescription")).toBe(
        resolvedValue !== undefined,
      );
      expect(mapConfigToRuntimeEnv(resolved).UPDATE_PR_DESCRIPTION).toBe(
        runtimeValue,
      );
    },
  );

  it.each([0, 5, 12])(
    "preserves explicit inline cap %s",
    (inlineMaxComments) => {
      const config = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        limits: { ...workspacePolicyFixture.limits, inlineMaxComments },
      });
      expect(mapConfigToRuntimeEnv(config).INLINE_MAX_COMMENTS).toBe(
        String(inlineMaxComments),
      );
    },
  );

  it.each(["high", "max", "ultra"] as const)(
    "persists and maps %s reasoning effort to runtime env",
    (reasoningEffort) => {
      const config = parseReviewConfigurationStrict({
        ...workspacePolicyFixture,

        providers: [
          {
            ...workspaceProviderFixture,
            model: "gpt-5.6-sol",
            reasoningEffort,
          },
        ],
      });

      expect(config.providers[0]!.reasoningEffort).toBe(reasoningEffort);
      const runtimeEnv = mapConfigToRuntimeEnv(config);
      expect(runtimeEnv.CODEX_REASONING_EFFORT).toBe(reasoningEffort);
      if (reasoningEffort === "ultra") {
        expect(runtimeEnv.RUN_TIMEOUT_SECONDS).toBe("1800");
      } else {
        expect(runtimeEnv).not.toHaveProperty("RUN_TIMEOUT_SECONDS");
      }
    },
  );

  it.each(["max", "ultra"] as const)(
    "rejects unsupported %s effort for an older model on read and save",
    (reasoningEffort) => {
      const input = {
        ...workspacePolicyFixture,

        providers: [
          {
            ...workspaceProviderFixture,
            model: "gpt-5.5",
            reasoningEffort,
          },
        ],
      };

      expect(() => parseReviewConfiguration(input)).toThrow(
        "review reasoning effort is unsupported for model",
      );
      expect(() => parseReviewConfigurationStrict(input)).toThrow(
        "review reasoning effort is unsupported for model",
      );
    },
  );

  it("maps only explicitly enabled investigation rollout flags to canonical 1 values", () => {
    const config = parseReviewConfiguration({
      ...workspacePolicyFixture,
      investigationRollout: enabledInvestigationRollout,
    });

    expect(mapConfigToRuntimeEnv(config)).toMatchObject({
      REVIEW_ROUTER_REVIEW_INVESTIGATION_RECORDING_ENABLED: "1",
      REVIEW_ROUTER_REVIEW_INVESTIGATION_SHADOW_ENABLED: "1",
      REVIEW_ROUTER_REVIEW_INVESTIGATION_CONTEXT_CRITIC_ENABLED: "1",
      REVIEW_ROUTER_REVIEW_INVESTIGATION_VERIFIED_CLEAN_ENABLED: "1",
      REVIEW_ROUTER_REVIEW_INVESTIGATION_CROSS_REVISION_REPLAY_ENABLED: "1",
      REVIEW_ROUTER_REVIEW_INVESTIGATION_PRODUCTION_EFFECTS_ENABLED: "1",
    });
    expect(() =>
      parseReviewConfiguration({
        ...workspacePolicyFixture,
        investigationRollout: { recordingEnabled: "1" },
      }),
    ).toThrow();
  });

  it("keeps an explicitly disabled investigation rollout disabled", () => {
    const config = parseReviewConfiguration({
      ...workspacePolicyFixture,
      investigationRollout: disabledInvestigationRollout,
    });

    expect(mapConfigToRuntimeEnv(config)).toMatchObject(
      disabledInvestigationRuntimeEnv,
    );
  });

  it("maps OpenRouter API-key config to fully-qualified runtime models", () => {
    const provider = {
      ...workspaceProviderFixture,
      kind: "openrouter" as const,
      authMode: "openrouter_api_key" as const,
      model: "poolside/laguna-m.1:free",
    };
    const env = mapConfigToRuntimeEnv({
      ...workspacePolicyFixture,

      providers: [provider],
    });

    expect(env).toMatchObject({
      REVIEW_AUTH_MODE: "openrouter-api",
      REVIEW_PROVIDERS: "openrouter/poolside/laguna-m.1:free",
      REQUIRED_HEALTHY_PROVIDERS: "openrouter/poolside/laguna-m.1:free",
      SYNTHESIS_MODEL: "openrouter/poolside/laguna-m.1:free",
      PROVIDER_LIMIT: "1",
      PROVIDER_MAX_PARALLEL: "1",
      CODEX_REASONING_EFFORT: "high",
      CODEX_AGENTIC_CONTEXT: "true",
    });
    expect(env).not.toHaveProperty("CODEX_MODEL");
    expect(Object.keys(env).join("\n")).not.toContain("SECRET");
    expect(Object.keys(env).join("\n")).not.toContain("KEY");
  });

  it("maps Claude Code OAuth config without leaking secret names or Codex env", () => {
    const provider = {
      ...workspaceProviderFixture,
      kind: "claude" as const,
      authMode: "claude_code_oauth" as const,
      model: "sonnet",
    };
    const env = mapConfigToRuntimeEnv({
      ...workspacePolicyFixture,

      providers: [provider],
    });

    expect(env).toMatchObject({
      REVIEW_AUTH_MODE: "claude-oauth",
      REVIEW_PROVIDERS: "claude/sonnet",
      REQUIRED_HEALTHY_PROVIDERS: "claude/sonnet",
      SYNTHESIS_MODEL: "claude/sonnet",
      CLAUDE_MODEL: "sonnet",
      CLAUDE_AGENTIC_CONTEXT: "true",
      PROVIDER_LIMIT: "1",
      PROVIDER_MAX_PARALLEL: "1",
    });
    expect(env).not.toHaveProperty("CODEX_MODEL");
    expect(Object.keys(env).join("\n")).not.toContain("SECRET");
    expect(Object.keys(env).join("\n")).not.toContain("KEY");
  });

  it("rejects provider auth mode pairs that do not match catalog ownership", () => {
    expect(() =>
      parseReviewConfiguration({
        ...workspacePolicyFixture,
        schemaVersion: 3,
        providers: [
          {
            kind: "codex",
            authMode: "claude_code_oauth",
            model: "sonnet",
            reasoningEffort: "medium",
            agenticContext: true,
            fastMode: false,
          },
        ],
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
      }),
    ).toThrow();
  });

  it.each([1, 2])("rejects obsolete policy schema %s", (schemaVersion) => {
    expect(() =>
      parseReviewConfiguration({ ...workspacePolicyFixture, schemaVersion }),
    ).toThrow();
  });

  it("preserves explicit disabled health requirements", () => {
    const config = parseReviewConfigurationStrict({
      ...workspacePolicyFixture,
      providers: [{ ...workspaceProviderFixture, requiredHealthy: false }],
    });
    expect(config.providers[0]?.requiredHealthy).toBe(false);
  });

  it("maps hybrid rotating Codex provider config to parallel runtime env", () => {
    const env = mapConfigToRuntimeEnv(
      parseReviewConfiguration({
        ...workspacePolicyFixture,
        providers: [
          {
            kind: "codex",
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.5",
            reasoningEffort: "high",
            agenticContext: true,
            fastMode: false,
          },
          {
            kind: "openrouter",
            authMode: "openrouter_api_key",
            model: "poolside/laguna-m.1:free",
            reasoningEffort: "medium",
            agenticContext: true,
            fastMode: false,
          },
          {
            kind: "claude",
            authMode: "claude_code_oauth",
            model: "sonnet",
            reasoningEffort: "medium",
            agenticContext: true,
            fastMode: false,
          },
        ],
        execution: {
          providerLimit: 3,
          providerMaxParallel: 3,
          inlineMinAgreement: 2,
        },
      }),
    );

    expect(env).toMatchObject({
      REVIEW_AUTH_MODE: "codex-oauth-rotating",
      REVIEW_PROVIDERS:
        "codex/gpt-5.5,openrouter/poolside/laguna-m.1:free,claude/sonnet",
      REQUIRED_HEALTHY_PROVIDERS: "codex/gpt-5.5",
      SYNTHESIS_MODEL: "codex/gpt-5.5",
      CODEX_MODEL: "gpt-5.5",
      CODEX_REASONING_EFFORT: "high",
      CLAUDE_MODEL: "sonnet",
      CLAUDE_AGENTIC_CONTEXT: "true",
      PROVIDER_LIMIT: "3",
      PROVIDER_MAX_PARALLEL: "3",
      INLINE_MIN_AGREEMENT: "2",
    });
  });

  it("rejects provider arrays with mismatched execution limits", () => {
    expect(() =>
      parseReviewConfiguration({
        ...workspacePolicyFixture,
        schemaVersion: 3,
        providers: [
          {
            kind: "codex",
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.5",
          },
          {
            kind: "codex",
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.4",
          },
        ],
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
      }),
    ).toThrow("review execution limits do not match providers");
  });

  it("rejects exact duplicate provider and model rows", () => {
    expect(() =>
      parseReviewConfigurationStrict({
        ...workspacePolicyFixture,
        schemaVersion: 3,
        providers: [
          {
            kind: "openrouter",
            authMode: "openrouter_api_key",
            model: "openai/gpt-5.3-codex",
          },
          {
            kind: "openrouter",
            authMode: "openrouter_api_key",
            model: "openai/gpt-5.3-codex",
          },
        ],
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
      }),
    ).toThrow("duplicate review provider");
  });

  it("rejects exact duplicate provider rows on reads and writes", () => {
    const provider = {
      ...workspaceProviderFixture,
      kind: "openrouter" as const,
      authMode: "openrouter_api_key" as const,
      model: "poolside/laguna-m.1:free",
    };
    const input = {
      ...workspacePolicyFixture,
      providers: [provider, provider],
      execution: {
        providerLimit: 2,
        providerMaxParallel: 2,
        inlineMinAgreement: 1,
      },
    };
    expect(() => parseReviewConfiguration(input)).toThrow(
      "duplicate review provider",
    );
    expect(() => parseReviewConfigurationStrict(input)).toThrow(
      "duplicate review provider",
    );
  });

  it("rejects invalid limits", () => {
    expect(() =>
      parseReviewConfiguration({
        providers: [
          {
            kind: "codex",
            authMode: "codex_subscription_oauth_rotating",
            model: "gpt-5.5",
          },
        ],
        blockingPolicy: { failOnSeverity: "critical" },
        limits: { inlineMaxComments: 500, targetTokensPerBatch: 50000 },
      }),
    ).toThrow();
  });

  it("versions workspace review configuration through the repository port", async () => {
    const configurations = repositoryWithProfiles();
    const target = { scope: "workspace", workspaceId: "workspace_1" } as const;

    await expect(
      saveReviewConfiguration(
        {
          target,
          policy: workspaceDocument("profile_hosted_55"),
        },
        { configurations },
      ),
    ).resolves.toMatchObject({ version: 1 });

    const updated = await saveReviewConfiguration(
      {
        target,
        policy: {
          ...workspaceDocument("profile_hosted_55"),
          providers: [
            {
              profileId: "profile_hosted_55",
              reasoningEffort: "high",
              agenticContext: true,
              fastMode: true,
              requiredHealthy: true,
            },
          ],
          investigationRollout: disabledInvestigationRollout,
        },
      },
      { configurations },
    );

    expect(updated.version).toBe(2);
    await expect(
      findReviewConfiguration(target, { configurations }),
    ).resolves.toMatchObject({
      version: 2,
      config: {
        providers: [{ reasoningEffort: "high", fastMode: true }],
        investigationRollout: disabledInvestigationRollout,
      },
    });
  });

  it("inherits the workspace default and resolves explicit repository overrides", async () => {
    const configurations = repositoryWithProfiles();
    const workspaceTarget = {
      scope: "workspace",
      workspaceId: "workspace_1",
    } as const;
    const repositoryTarget = {
      scope: "repository",
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
    } as const;

    await expect(
      resolveReviewConfiguration(repositoryTarget, { configurations }),
    ).resolves.toBeNull();

    await saveReviewConfiguration(
      {
        target: workspaceTarget,
        policy: {
          ...workspaceDocument("profile_hosted_54"),
          investigationRollout: disabledInvestigationRollout,
        },
      },
      { configurations },
    );
    await expect(
      resolveReviewConfiguration(repositoryTarget, { configurations }),
    ).resolves.toMatchObject({
      source: "workspace",
      config: {
        providers: [{ model: "gpt-5.4" }],
        investigationRollout: {
          recordingEnabled: false,
          productionEffectsEnabled: false,
        },
      },
    });

    await saveReviewConfiguration(
      {
        target: repositoryTarget,
        policy: {
          schemaVersion: 4,
          providers: [
            {
              profileId: "profile_rotating_mini",
              reasoningEffort: "high",
              agenticContext: true,
              fastMode: false,
              requiredHealthy: true,
            },
          ],
          blockingPolicy: { failOnSeverity: "major" },
          investigationRollout: enabledInvestigationRollout,
        },
      },
      { configurations },
    );

    await expect(
      resolveReviewRuntimeEnv(repositoryTarget, {
        policyHeads: configurations,
      }),
    ).resolves.toMatchObject({
      source: "repository",
      runtimeEnv: {
        CODEX_MODEL: "gpt-5.4-mini",
        CODEX_FAST_MODE: "false",
        FAIL_ON_SEVERITY: "major",
        REVIEW_ROUTER_REVIEW_INVESTIGATION_RECORDING_ENABLED: "1",
        REVIEW_ROUTER_REVIEW_INVESTIGATION_PRODUCTION_EFFECTS_ENABLED: "1",
      },
    });
  });

  it("clears repository overrides and falls back to the workspace default", async () => {
    const configurations = repositoryWithProfiles();
    const workspaceTarget = {
      scope: "workspace",
      workspaceId: "workspace_1",
    } as const;
    const repositoryTarget = {
      scope: "repository",
      workspaceId: "workspace_1",
      repositoryId: "repo_1",
    } as const;

    await saveReviewConfiguration(
      {
        target: workspaceTarget,
        policy: workspaceDocument("profile_hosted_54"),
      },
      { configurations },
    );
    await saveReviewConfiguration(
      {
        target: repositoryTarget,
        policy: {
          schemaVersion: 4,
          providers: [
            {
              profileId: "profile_rotating_mini",
              reasoningEffort: "high",
              agenticContext: true,
              fastMode: false,
              requiredHealthy: true,
            },
          ],
        },
      },
      { configurations },
    );

    await expect(
      resolveReviewConfiguration(repositoryTarget, { configurations }),
    ).resolves.toMatchObject({
      source: "repository",
      config: { providers: [{ model: "gpt-5.4-mini" }] },
    });
    const history = new Map(configurations.heads);
    const current = await configurations.findLatest(repositoryTarget);
    await expect(
      clearReviewConfiguration(
        { ...repositoryTarget, expectedVersion: current!.version + 1 },
        { configurations },
      ),
    ).rejects.toMatchObject({ code: "review_configuration_write_conflict" });
    await expect(
      clearReviewConfiguration(
        { ...repositoryTarget, expectedVersion: current!.version },
        { configurations },
      ),
    ).resolves.toBe(true);
    await expect(
      resolveReviewConfiguration(repositoryTarget, { configurations }),
    ).resolves.toMatchObject({
      source: "workspace",
      config: { providers: [{ model: "gpt-5.4" }] },
    });
    await expect(
      clearReviewConfiguration(repositoryTarget, { configurations }),
    ).resolves.toBe(false);
    expect(configurations.heads).toEqual(history);
  });
});

/** Hosted pool defaults and a rotating repository provider of repo_1. */
function repositoryWithProfiles(): InMemoryReviewConfigurationRepository {
  const configurations = new InMemoryReviewConfigurationRepository();
  for (const [id, model] of [
    ["profile_hosted_55", "gpt-5.5"],
    ["profile_hosted_54", "gpt-5.4"],
  ] as const)
    configurations.addProfile(
      providerProfileFixture({
        id,
        credential: {
          kind: "hosted_pool",
          authMode: "codex_subscription_oauth_hosted_pool",
        },
        model,
      }),
    );
  configurations.addProfile(
    providerProfileFixture({
      id: "profile_rotating_mini",
      credential: {
        kind: "repository_rotating",
        authMode: "codex_subscription_oauth_rotating",
        repositoryId: "repo_1",
      },
      model: "gpt-5.4-mini",
    }),
  );
  return configurations;
}

function workspaceDocument(profileId: string) {
  return workspacePolicyDocumentFixture(workspacePolicyFixture, [profileId]);
}

const gatewayProvider = {
  kind: "codex",
  authMode: "codex_account_gateway",
  model: "mimo-v2-pro",
  reasoningEffort: "high",
  agenticContext: false,
  fastMode: true,
  gatewayBindingId: "binding-safe",
  gatewayProfileRef: "profile-mimo",
} as const;
const gatewayConfigInput = (provider: unknown) => ({
  ...workspacePolicyFixture,
  schemaVersion: 3,
  providers: [provider],
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 50, targetTokensPerBatch: 50000 },
});

it.each([
  { model: "codex-dynamic-fixture", reasoningEffort: "minimal" },
  { model: "mimo-v2.6-pro", reasoningEffort: "high" },
  { model: "openai/gpt-5.6-sol", reasoningEffort: "ultra" },
] as const)(
  "maps Account Gateway $model/$reasoningEffort to the bounded invocation budget",
  ({ model, reasoningEffort }) => {
    const config = parseReviewConfigurationStrict(
      gatewayConfigInput({ ...gatewayProvider, model, reasoningEffort }),
    );

    const runtimeEnv = mapConfigToRuntimeEnv(config);
    expect(runtimeEnv.RUN_TIMEOUT_SECONDS).toBe("3600");
    expect(runtimeEnv.CODEX_MODEL).toBe(model);
    expect(runtimeEnv.CODEX_REASONING_EFFORT).toBe(reasoningEffort);
  },
);

// Detects lost flat references, legacy coercion, OpenAI-only reasoning gates or primary drift.
it("retains current Gateway selections and rejects legacy normalization", () => {
  const first = parseReviewConfigurationStrict(
    gatewayConfigInput(gatewayProvider),
  );
  expect(first.providers[0]!).toEqual({
    ...gatewayProvider,
    requiredHealthy: false,
  });
  expect(first.providers[0]!).toBe(first.providers[0]);
  expect(() =>
    parseReviewConfiguration({
      schemaVersion: 1,
      providers: [gatewayProvider],
      blockingPolicy: {},
      limits: {},
    }),
  ).toThrow();
  const mixed = parseReviewConfigurationStrict({
    ...gatewayConfigInput(gatewayProvider),
    execution: {
      providerLimit: 2,
      providerMaxParallel: 2,
      inlineMinAgreement: 1,
    },
    providers: [
      gatewayProvider,
      {
        ...gatewayProvider,
        model: "openai/gpt-5.6-sol",
        reasoningEffort: "ultra",
        gatewayBindingId: "binding-second",
        gatewayProfileRef: "profile-openrouter",
      },
    ],
  });
  expect(mixed.providers[0]!).toEqual(first.providers[0]!);
  expect(mixed.providers[1]).toMatchObject({
    model: "openai/gpt-5.6-sol",
    reasoningEffort: "ultra",
    fastMode: true,
    gatewayBindingId: "binding-second",
    gatewayProfileRef: "profile-openrouter",
  });
});

// Detects silently deduplicating two selections that happen to use the same model.
it("keeps distinct bindings ordered and rejects only exact duplicate selections", () => {
  const second = { ...gatewayProvider, gatewayBindingId: "binding-second" };
  const input = {
    ...gatewayConfigInput(gatewayProvider),
    providers: [gatewayProvider, second],
    execution: {
      providerLimit: 2,
      providerMaxParallel: 2,
      inlineMinAgreement: 1,
    },
  };
  expect(parseReviewConfigurationStrict(input).providers).toHaveLength(2);
  expect(() =>
    parseReviewConfigurationStrict({
      ...input,
      providers: [gatewayProvider, gatewayProvider],
    }),
  ).toThrow("duplicate review provider");
});

// Detects missing/partial selections, URL/token references or unbounded identifiers being accepted.
it.each([
  { gatewayBindingId: undefined },
  { gatewayProfileRef: undefined },
  { gatewayBindingId: "" },
  { gatewayProfileRef: " " },
  { gatewayBindingId: "b".repeat(161) },
  { gatewayProfileRef: "p".repeat(161) },
  { gatewayBindingId: "https://private.example/binding" },
  { gatewayProfileRef: "sk-secret-value" },
  { model: "https://private.example/model" },
])("rejects malformed gateway selection %j", (patch) => {
  expect(() =>
    parseReviewConfiguration(
      gatewayConfigInput({ ...gatewayProvider, ...patch }),
    ),
  ).toThrow();
});

// Detects reference smuggling in a foreign/unknown auth mode or kind, and caller authority fields.
it.each([
  { kind: "claude" },
  { kind: "openrouter" },
  { kind: "mimo" },
  { authMode: "unknown_gateway" },
  { authMode: "codex_subscription_oauth_rotating" },
  { authMode: "codex_subscription_oauth_hosted_pool" },
  { ownerWorkspaceId: "caller-owner" },
  { principal: "caller-user" },
  { token: "secret" },
  { relayUrl: "https://private.example" },
  { nativeAccountId: 7 },
])("rejects gateway mode misuse %j", (patch) => {
  expect(() =>
    parseReviewConfigurationStrict(
      gatewayConfigInput({ ...gatewayProvider, ...patch }),
    ),
  ).toThrow();
});

// Detects any resave drift for legacy documents that never saved an engine selection.
const legacyGatewayPolicyInput = {
  schemaVersion: 3 as const,
  providers: [
    {
      kind: "codex" as const,
      authMode: "codex_account_gateway" as const,
      model: "mimo-v2-pro",
      reasoningEffort: "high" as const,
      agenticContext: true,
      fastMode: true,
      requiredHealthy: false,
      gatewayBindingId: "binding-safe",
      gatewayProfileRef: "profile-mimo",
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" as const },
  limits: { inlineMaxComments: 50, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: disabledInvestigationRollout,
};

it("materializes canonical runtime JSON and digest byte-identical to the configuration of its profiles", async () => {
  const parsed = parseReviewConfigurationStrict(legacyGatewayPolicyInput);
  expect(Object.keys(parsed.providers[0]!)).not.toContain("agentProfileRef");
  expect(Object.hasOwn(parsed, "updatePrDescription")).toBe(false);
  expect(canonicalJson(parsed)).toBe(
    '{"blockingPolicy":{"failOnSeverity":"critical"},"execution":{"inlineMinAgreement":1,"providerLimit":1,"providerMaxParallel":1},"investigationRollout":{"contextCriticEnabled":false,"crossRevisionReplayEnabled":false,"productionEffectsEnabled":false,"recordingEnabled":false,"shadowEnabled":false,"verifiedCleanEnabled":false},"limits":{"inlineMaxComments":50,"targetTokensPerBatch":50000},"providers":[{"agenticContext":true,"authMode":"codex_account_gateway","fastMode":true,"gatewayBindingId":"binding-safe","gatewayProfileRef":"profile-mimo","kind":"codex","model":"mimo-v2-pro","reasoningEffort":"high","requiredHealthy":false}],"reviewLanguage":null,"schemaVersion":3}',
  );
  const configurations = new InMemoryReviewConfigurationRepository();
  configurations.addProfile(
    providerProfileFixture({
      id: "profile_gateway",
      credential: {
        kind: "gateway_binding",
        authMode: "codex_account_gateway",
        bindingId: "binding-safe",
        gatewayProfileRef: "profile-mimo",
      },
      model: "mimo-v2-pro",
    }),
  );
  const target = { scope: "workspace", workspaceId: "workspace_1" } as const;
  await saveReviewConfiguration(
    {
      target,
      policy: workspacePolicyDocumentFixture(parsed, ["profile_gateway"]),
    },
    { configurations },
  );
  const resolved = await findReviewConfiguration(target, { configurations });
  // The same bytes the previous stored format resolved to, so the digest of
  // running reviews and snapshots does not move.
  expect(canonicalJson(resolved?.config)).toBe(canonicalJson(parsed));
  expect(resolved?.effectivePolicyDigest).toBe(
    "sha256:14096179835af919b1664f7414fa8fb209b9261a85a855a0a43d5bbfd042cf28",
  );
});

// Detects engine-selection smuggling outside the Account Gateway provider row.
it("rejects agentProfileRef outside the Account Gateway row", () => {
  expect(() =>
    parseReviewConfigurationStrict({
      ...gatewayConfigInput(gatewayProvider),
      providers: [
        { ...workspaceProviderFixture, agentProfileRef: "approved-ocr" },
      ],
    }),
  ).toThrow();
});

it("keeps an allowlisted engine selection beside native agentic context", () => {
  const config = parseReviewConfigurationStrict(
    gatewayConfigInput({
      ...gatewayProvider,
      agenticContext: true,
      agentProfileRef: "approved-ocr",
    }),
  );
  expect(config.providers[0]!).toMatchObject({
    authMode: "codex_account_gateway",
    agentProfileRef: "approved-ocr",
    agenticContext: true,
  });
});

// Admission treats an explicit engine selection beside supplied-diff-only as
// incompatible only for OCR (agent_profile_uncompatible before any inference).
// The saved policy stays readable for every agent kind so admission can answer
// with its own actionable error instead of a resave failure, while the per-kind
// save rule matching admission still requires native context for OCR.
it("keeps an explicit OCR engine selection readable beside supplied-diff-only for admission", () => {
  const config = parseReviewConfigurationStrict(
    gatewayConfigInput({
      ...gatewayProvider,
      agenticContext: false,
      agentProfileRef: "approved-ocr",
    }),
  );
  expect(config.providers[0]!).toMatchObject({
    authMode: "codex_account_gateway",
    agentProfileRef: "approved-ocr",
    agenticContext: false,
  });
});

it("accepts an explicit non-OCR engine selection beside supplied-diff-only", () => {
  const config = parseReviewConfigurationStrict(
    gatewayConfigInput({
      ...gatewayProvider,
      agenticContext: false,
      agentProfileRef: "approved-codex",
    }),
  );
  expect(config.providers[0]!).toMatchObject({
    authMode: "codex_account_gateway",
    agentProfileRef: "approved-codex",
    agenticContext: false,
  });
});

// The per-kind save rule matching admission: the explicit selection beside
// supplied-diff-only is rejected ONLY for OCR-eligible refs (the resolved
// agent kind admission also treats as incompatible), with the accurate
// machine message; codex/claude explicit refs must save. Before the narrowing
// the blanket schema rule rejected every explicit ref here.
it("rejects an explicit engine selection beside supplied-diff-only only for the OCR kind", () => {
  const suppliedDiffOnly = { agenticContext: false } as const;
  expect(
    reviewAgentProfileAgenticContextSaveIssue(
      { ...suppliedDiffOnly, agentProfileRef: "approved-ocr" },
      "ocr",
    ),
  ).toBe("agent_profile_requires_agentic_context");
  expect(
    reviewAgentProfileAgenticContextSaveIssue(
      { ...suppliedDiffOnly, agentProfileRef: "approved-codex" },
      "codex",
    ),
  ).toBeNull();
  expect(
    reviewAgentProfileAgenticContextSaveIssue(
      { ...suppliedDiffOnly, agentProfileRef: "approved-claude" },
      "claude",
    ),
  ).toBeNull();
  // Native agentic context and the implicit default never trigger the rule.
  expect(
    reviewAgentProfileAgenticContextSaveIssue(
      { agenticContext: true, agentProfileRef: "approved-ocr" },
      "ocr",
    ),
  ).toBeNull();
  expect(
    reviewAgentProfileAgenticContextSaveIssue(suppliedDiffOnly, "ocr"),
  ).toBeNull();
});

it.each([
  { agentProfileRef: "" },
  { agentProfileRef: " " },
  { agentProfileRef: "p".repeat(161) },
  { agentProfileRef: "https://private.example/profile" },
  { agentProfileRef: "sk-secret-value" },
])("rejects malformed agent profile selection %j", (patch) => {
  expect(() =>
    parseReviewConfigurationStrict(
      gatewayConfigInput({
        ...gatewayProvider,
        agenticContext: true,
        ...patch,
      }),
    ),
  ).toThrow();
});

// Public discovery cannot widen the runtime fast-mode compatibility policy.
it("requires explicit fast-mode correction for an unverified public Codex model", () => {
  const provider = {
    ...workspaceProviderFixture,
    kind: "codex",
    model: "public-new-model",
    reasoningEffort: "high",
    fastMode: true,
  };
  expect(() =>
    parseReviewConfigurationStrict({
      ...workspacePolicyFixture,
      providers: [provider],
    }),
  ).toThrow("Fast mode is not verified");
  expect(
    parseReviewConfigurationStrict({
      ...workspacePolicyFixture,
      providers: [{ ...provider, fastMode: false }],
    }).providers[0],
  ).toMatchObject({ model: "public-new-model", fastMode: false });
});

it("does not default absent Gateway reasoning while preserving legacy defaults", () => {
  const settings = {
    kind: "codex",
    authMode: "codex_account_gateway",
    model: "k3-256k",
    gatewayBindingId: "binding",
    gatewayProfileRef: "kimi-code-global-responses-apikey-v1",
    agenticContext: true,
    fastMode: false,
  };
  const gateway = reviewProviderConfigurationSchema.parse(settings);
  expect(gateway).not.toHaveProperty("reasoningEffort");
});
