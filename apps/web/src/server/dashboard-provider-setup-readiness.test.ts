import { describe, expect, it } from "vitest";
import {
  parseReviewConfiguration,
  type ReviewConfiguration,
} from "@reviewrouter/features-review-config";
import {
  buildConfiguredProviderSetupByRepositoryId,
  buildEffectiveProviderSetupStateByRepositoryId,
  buildProviderSetupMismatchRepositoryIds,
  getReadyGatewayAccounts,
  isGatewayProviderSetupReady,
  repositoryHealthStatusWithProviderSetupReadiness,
} from "./dashboard-provider-setup-readiness";
import type { AccountsPage, AccountsResult } from "./account-gateway-accounts";
import {
  repositorySearchReadiness,
  repositorySetupProgressStep,
  workflowSetupAlreadyCurrent,
} from "./repository-search";

const workspacePolicy = parseReviewConfiguration({
  schemaVersion: 3,
  providers: [
    {
      kind: "codex",
      authMode: "codex_subscription_oauth_rotating",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: false,
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: {
    recordingEnabled: false,
    shadowEnabled: false,
    contextCriticEnabled: false,
    verifiedCleanEnabled: false,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: false,
  },
});

describe("dashboard provider setup readiness", () => {
  it("requires a saved policy even when old provider setup rows are configured", () => {
    const input = {
      providerSetup: [
        providerSetup({
          authMode: "codex_subscription_oauth_rotating",
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      ],
      repositories: [{ id: "repo_1" }],
      repositoryConfigs: [],
      activeConfig: null,
    };
    expect(buildConfiguredProviderSetupByRepositoryId(input).size).toBe(0);
    expect(
      buildEffectiveProviderSetupStateByRepositoryId(input).get("repo_1")
        ?.state,
    ).toBe("missing");
    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId:
          buildEffectiveProviderSetupStateByRepositoryId(input),
        providerSetupMismatchRepositoryIds: new Set(),
      }),
    ).toBe("provider_needs_setup");
  });

  it("uses the selected live Gateway binding and catalog without legacy secret setup, preserving health failures", () => {
    const config = parseReviewConfiguration({
      ...workspacePolicy,
      providers: [
        {
          kind: "codex",
          authMode: "codex_account_gateway",
          gatewayBindingId: "binding_1",
          gatewayProfileRef: "openai-responses-apikey-v1",
          model: "mimo-v2.6-pro",
          reasoningEffort: "medium",
          agenticContext: true,
          fastMode: false,
        },
      ],
    });
    const accounts: AccountsResult<AccountsPage> = {
      status: "ok",
      value: {
        accounts: [
          {
            connectionId: "connection_1",
            label: "Workspace account",
            profileId: "openai-responses-apikey-v1",
            profileLabel: "MiMo",
            state: "active",
            gatewayRevision: 2,
            mirrorRevision: 2,
            binding: {
              id: "binding_1",
              revision: 1,
              state: "active",
              fencePending: false,
            },
          },
        ],
        profiles: [
          {
            id: "openai-responses-apikey-v1",
            label: "MiMo",
            protocol: "openai-responses",
            models: ["mimo-v2.6-pro"],
          },
        ],
        nextCursor: null,
      },
    };
    const legacy = buildEffectiveProviderSetupStateByRepositoryId({
      providerSetup: [],
      repositories: [{ id: "repo_1" }],
      repositoryConfigs: [],
      activeConfig: config,
    });
    expect(legacy.get("repo_1")?.state).toBe("missing");
    expect(getReadyGatewayAccounts(accounts)).toHaveLength(1);
    expect(isGatewayProviderSetupReady(config, accounts)).toBe(true);
    const projectHealth = (
      healthStatus: Parameters<
        typeof repositoryHealthStatusWithProviderSetupReadiness
      >[0]["healthStatus"],
      page: AccountsResult<AccountsPage> = accounts,
    ) =>
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus,
        effectiveProviderSetupStateByRepositoryId: legacy,
        providerSetupMismatchRepositoryIds: new Set(),
        gatewayProviderSetupReady: isGatewayProviderSetupReady(config, page),
      });
    const healthStatus = projectHealth("healthy");
    const setupProgressStep = repositorySetupProgressStep({
      setupStatus: "configured",
      healthStatus,
      workflowCurrent: workflowSetupAlreadyCurrent(healthStatus),
      providerSetupConfirmed: isGatewayProviderSetupReady(config, accounts),
    });
    expect(repositorySearchReadiness({ setupProgressStep, healthStatus })).toBe(
      "ready",
    );
    for (const failure of [
      "provider_unhealthy",
      "provider_report_stale",
      "missing_workflow",
      "provider_needs_setup",
    ] as const) {
      expect(projectHealth(failure)).toBe(failure);
      const failureProgress = repositorySetupProgressStep({
        setupStatus: "configured",
        healthStatus: failure,
        workflowCurrent: workflowSetupAlreadyCurrent(failure),
        providerSetupConfirmed: isGatewayProviderSetupReady(config, accounts),
      });
      const readiness = repositorySearchReadiness({
        setupProgressStep: failureProgress,
        healthStatus: failure,
      });
      if (failure === "provider_report_stale") {
        expect(readiness).toBe("ready");
      } else {
        expect(readiness).not.toBe("ready");
      }
    }
    const account = accounts.value.accounts[0]!;
    const binding = account.binding!;
    const blockedPages: AccountsResult<AccountsPage>[] = [
      { status: "unavailable" },
      { status: "denied" },
      { status: "ok", value: { ...accounts.value, accounts: [] } },
      ...[
        { ...account, state: "quarantined" as const },
        { ...account, binding: { ...binding, state: "revoked" as const } },
        { ...account, binding: { ...binding, fencePending: true } },
        { ...account, binding: { ...binding, id: "another_binding" } },
        { ...account, profileId: "another_profile" },
      ].map((blocked) => ({
        status: "ok" as const,
        value: { ...accounts.value, accounts: [blocked] },
      })),
      {
        status: "ok",
        value: {
          ...accounts.value,
          profiles: [
            { ...accounts.value.profiles[0]!, models: ["another-model"] },
          ],
        },
      },
    ];
    for (const page of blockedPages) {
      expect(isGatewayProviderSetupReady(config, page)).toBe(false);
      expect(projectHealth("healthy", page)).toBe("provider_needs_setup");
    }
  });
  it("does not treat legacy Codex setup as configured for rotating Codex", () => {
    const configured = buildConfiguredProviderSetupByRepositoryId({
      providerSetup: [
        providerSetup({
          authMode: "codex_subscription_oauth",
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        }),
      ],
      repositories: [{ id: "repo_1" }],
      repositoryConfigs: [],
      activeConfig: workspacePolicy,
    });

    expect(configured.has("repo_1")).toBe(false);
  });

  it("uses only configured setup rows that match the effective provider auth", () => {
    const configuredAt = new Date("2026-01-02T00:00:00Z");
    const configured = buildConfiguredProviderSetupByRepositoryId({
      providerSetup: [
        providerSetup({
          authMode: "codex_subscription_oauth",
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        }),
        providerSetup({
          authMode: "codex_subscription_oauth_rotating",
          updatedAt: configuredAt,
        }),
      ],
      repositories: [{ id: "repo_1" }],
      repositoryConfigs: [],
      activeConfig: workspacePolicy,
    });

    expect(configured.get("repo_1")?.updatedAt).toEqual(configuredAt);
  });

  it("does not treat a repository as configured when any matching provider setup row is missing", () => {
    const providerSetupRows = [
      providerSetup({
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      }),
      providerSetup({
        providerKind: "claude",
        authMode: "claude_code_oauth",
        state: "missing",
        updatedAt: new Date("2026-01-03T00:00:00Z"),
      }),
    ];
    const activeConfig = multiProviderReviewConfig();
    const effectiveProviderSetupStateByRepositoryId =
      buildEffectiveProviderSetupStateByRepositoryId({
        providerSetup: providerSetupRows,
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig,
      });

    expect(
      buildConfiguredProviderSetupByRepositoryId({
        providerSetup: providerSetupRows,
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig,
      }).has("repo_1"),
    ).toBe(false);
    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds:
          buildProviderSetupMismatchRepositoryIds({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [],
            activeConfig,
          }),
      }),
    ).toBe("provider_needs_setup");
  });

  it("does not treat a multi-auth repository as configured after only one provider is confirmed", () => {
    const providerSetupRows = [
      providerSetup({
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ];
    const activeConfig = multiProviderReviewConfig();
    const effectiveProviderSetupStateByRepositoryId =
      buildEffectiveProviderSetupStateByRepositoryId({
        providerSetup: providerSetupRows,
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig,
      });

    expect(
      buildConfiguredProviderSetupByRepositoryId({
        providerSetup: providerSetupRows,
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig,
      }).has("repo_1"),
    ).toBe(false);
    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds:
          buildProviderSetupMismatchRepositoryIds({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [],
            activeConfig,
          }),
      }),
    ).toBe("provider_needs_setup");
  });

  it("uses repository overrides when matching provider setup rows", () => {
    const openRouterConfig = reviewConfigFor(
      "openrouter",
      "openrouter_api_key",
    );
    const configured = buildConfiguredProviderSetupByRepositoryId({
      providerSetup: [
        providerSetup({
          authMode: "codex_subscription_oauth_rotating",
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        }),
        providerSetup({
          providerKind: "openrouter",
          authMode: "openrouter_api_key",
          updatedAt: new Date("2026-01-02T00:00:00Z"),
        }),
      ],
      repositories: [{ id: "repo_1" }],
      repositoryConfigs: [
        {
          repositoryId: "repo_1",
          config: { config: openRouterConfig },
        },
      ],
      activeConfig: workspacePolicy,
    });

    expect(configured.get("repo_1")?.updatedAt).toEqual(
      new Date("2026-01-02T00:00:00Z"),
    );
  });

  it("downgrades healthy reports when provider setup no longer matches policy", () => {
    const providerSetupRows = [
      providerSetup({
        authMode: "codex_subscription_oauth",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ];
    const effectiveProviderSetupStateByRepositoryId =
      buildEffectiveProviderSetupStateByRepositoryId({
        providerSetup: providerSetupRows,
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig: workspacePolicy,
      });

    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds:
          buildProviderSetupMismatchRepositoryIds({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [],
            activeConfig: workspacePolicy,
          }),
      }),
    ).toBe("provider_needs_setup");
  });

  it("downgrades healthy reports when matching provider setup is missing", () => {
    const providerSetupRows = [
      providerSetup({
        authMode: "codex_subscription_oauth_rotating",
        state: "missing",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ];
    const effectiveProviderSetupStateByRepositoryId =
      buildEffectiveProviderSetupStateByRepositoryId({
        providerSetup: providerSetupRows,
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig: workspacePolicy,
      });

    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds:
          buildProviderSetupMismatchRepositoryIds({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [],
            activeConfig: workspacePolicy,
          }),
      }),
    ).toBe("provider_needs_setup");
  });

  it("downgrades healthy reports when setup metadata is absent for the effective policy", () => {
    const effectiveProviderSetupStateByRepositoryId =
      buildEffectiveProviderSetupStateByRepositoryId({
        providerSetup: [],
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig: workspacePolicy,
      });

    expect(effectiveProviderSetupStateByRepositoryId.get("repo_1")).toEqual({
      state: "missing",
      updatedAt: new Date(0),
    });
    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds: new Set(),
      }),
    ).toBe("provider_needs_setup");
  });

  it("downgrades healthy reports when only an unrelated old provider setup row exists", () => {
    const providerSetupRows = [
      providerSetup({
        authMode: "codex_subscription_oauth_rotating",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
    ];
    const openRouterConfig = reviewConfigFor(
      "openrouter",
      "openrouter_api_key",
    );

    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId:
          buildEffectiveProviderSetupStateByRepositoryId({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [
              {
                repositoryId: "repo_1",
                config: { config: openRouterConfig },
              },
            ],
            activeConfig: workspacePolicy,
          }),
        providerSetupMismatchRepositoryIds:
          buildProviderSetupMismatchRepositoryIds({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [
              {
                repositoryId: "repo_1",
                config: { config: openRouterConfig },
              },
            ],
            activeConfig: workspacePolicy,
          }),
      }),
    ).toBe("provider_needs_setup");
  });

  it("keeps healthy reports when a matching provider setup row exists beside unrelated old setup", () => {
    const providerSetupRows = [
      providerSetup({
        authMode: "codex_subscription_oauth_rotating",
        updatedAt: new Date("2026-01-01T00:00:00Z"),
      }),
      providerSetup({
        providerKind: "openrouter",
        authMode: "openrouter_api_key",
        updatedAt: new Date("2026-01-02T00:00:00Z"),
      }),
    ];
    const openRouterConfig = reviewConfigFor(
      "openrouter",
      "openrouter_api_key",
    );

    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId:
          buildEffectiveProviderSetupStateByRepositoryId({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [
              {
                repositoryId: "repo_1",
                config: { config: openRouterConfig },
              },
            ],
            activeConfig: workspacePolicy,
          }),
        providerSetupMismatchRepositoryIds:
          buildProviderSetupMismatchRepositoryIds({
            providerSetup: providerSetupRows,
            repositories: [{ id: "repo_1" }],
            repositoryConfigs: [
              {
                repositoryId: "repo_1",
                config: { config: openRouterConfig },
              },
            ],
            activeConfig: workspacePolicy,
          }),
      }),
    ).toBe("healthy");
  });
  it("treats an active hosted workspace pool session as provider-ready", () => {
    const effectiveProviderSetupStateByRepositoryId =
      buildEffectiveProviderSetupStateByRepositoryId({
        providerSetup: [],
        repositories: [{ id: "repo_1" }],
        repositoryConfigs: [],
        activeConfig: workspacePolicy,
      });

    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "healthy",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds: new Set(),
        hostedSessionReady: true,
      }),
    ).toBe("healthy");
    expect(
      repositoryHealthStatusWithProviderSetupReadiness({
        repositoryId: "repo_1",
        healthStatus: "provider_needs_setup",
        effectiveProviderSetupStateByRepositoryId,
        providerSetupMismatchRepositoryIds: new Set(),
        hostedSessionReady: true,
      }),
    ).toBe("healthy");
  });
});

function providerSetup(input: {
  readonly providerKind?: string;
  readonly authMode: string;
  readonly state?: string;
  readonly updatedAt: Date;
}) {
  return {
    repositoryId: "repo_1",
    providerKind: input.providerKind ?? "codex",
    authMode: input.authMode,
    state: input.state ?? "configured",
    updatedAt: input.updatedAt,
  };
}

function reviewConfigFor(
  kind: "codex" | "openrouter",
  authMode: "codex_subscription_oauth_rotating" | "openrouter_api_key",
): ReviewConfiguration {
  return parseReviewConfiguration({
    ...workspacePolicy,
    schemaVersion: 3,
    providers: [
      {
        kind,
        authMode,
        model: kind === "codex" ? "gpt-5.5" : "poolside/laguna-m.1:free",
        reasoningEffort: "medium",
        agenticContext: true,
        fastMode: false,
      },
    ],
    execution: {
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    },
    blockingPolicy: { failOnSeverity: "critical" },
    limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  });
}

function multiProviderReviewConfig(): ReviewConfiguration {
  return parseReviewConfiguration({
    ...workspacePolicy,
    schemaVersion: 3,
    providers: [
      {
        kind: "openrouter",
        authMode: "openrouter_api_key",
        model: "poolside/laguna-m.1:free",
        reasoningEffort: "medium",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: true,
      },
      {
        kind: "claude",
        authMode: "claude_code_oauth",
        model: "sonnet",
        reasoningEffort: "medium",
        agenticContext: true,
        fastMode: false,
        requiredHealthy: false,
      },
    ],
    execution: {
      providerLimit: 2,
      providerMaxParallel: 2,
      inlineMinAgreement: 1,
    },
    blockingPolicy: { failOnSeverity: "critical" },
    limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  });
}
