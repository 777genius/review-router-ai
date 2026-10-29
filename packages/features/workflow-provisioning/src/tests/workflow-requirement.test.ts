import {
  mapConfigToRuntimeEnv,
  providerApiConfigurationMode,
  parseReviewConfigurationStrict,
  type ReviewProviderConfiguration,
} from "@reviewrouter/features-review-config";
import { describe, expect, it } from "vitest";
import {
  comparableWorkflowRequirement,
  renderedWorkflowRequirement,
  inspectRequiredWorkflowTransport,
  inspectRequiredWorkflowRequirement,
  requiredWorkflowRequirement,
  requiredWorkflowTransport,
  verifiedWorkflowRequirement,
} from "../domain/workflow-transport";

const settings = {
  reasoningEffort: "high",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} as const;

function config(providers: readonly ReviewProviderConfiguration[]) {
  return parseReviewConfigurationStrict({
    schemaVersion: 3,
    providers,
    execution: {
      providerLimit: providers.length,
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
}

const claude = config([
  {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    ...settings,
  },
]);
const mimo = config([
  {
    kind: "codex-mimo",
    authMode: "mimo_token_plan_api_key",
    model: "mimo-v2.6-pro",
    ...settings,
  },
]);
const hybridRotating = config([
  {
    kind: "codex",
    authMode: "codex_subscription_oauth_rotating",
    model: "gpt-5.6-sol",
    ...settings,
  },
  {
    kind: "claude",
    authMode: "claude_code_oauth",
    model: "sonnet",
    ...settings,
    requiredHealthy: false,
  },
]);

describe("workflow requirement", () => {
  it("accepts every all-Gateway roster and rejects a mixed transport without reducing it", () => {
    const gateway = {
      kind: "codex",
      authMode: "codex_account_gateway",
      model: "gpt-5.5",
      gatewayBindingId: "binding-1",
      gatewayProfileRef: "profile-1",
      ...settings,
    } as const;
    const plural = config([gateway, { ...gateway, model: "gpt-5.4" }]);
    expect(requiredWorkflowTransport(plural)).toBe("gateway");
    expect(requiredWorkflowRequirement(plural)).toBe("gateway");
    expect(() =>
      requiredWorkflowTransport(config([gateway, claude.providers[0]!])),
    ).toThrow("account_gateway_mixed_transport_unsupported");
  });

  it("tells CI-secret workflows of different secret providers apart", () => {
    // Both use GitHub secrets, but only the MiMo workflow forwards its key.
    expect(requiredWorkflowTransport(claude)).toBe("ci_secrets");
    expect(requiredWorkflowTransport(mimo)).toBe("provider_api");
    expect(requiredWorkflowRequirement(claude)).toBe("ci_secrets+claude");
    expect(requiredWorkflowRequirement(mimo)).toBe("provider_api+codex-mimo");
    expect(requiredWorkflowRequirement(hybridRotating)).toBe("rotating+claude");
  });

  it("records for an attempt what its rendered workflow requires", () => {
    for (const candidate of [claude, mimo, hybridRotating])
      expect(
        renderedWorkflowRequirement(
          requiredWorkflowTransport(candidate),
          mapConfigToRuntimeEnv(candidate),
          providerApiConfigurationMode(candidate),
        ),
      ).toBe(requiredWorkflowRequirement(candidate));
  });
  it("treats hosted and rotating workflows as one family only during a hosted pool transition", () => {
    for (const [required, installed] of [
      ["hosted_pool", "rotating"],
      ["rotating", "hosted_pool"],
      ["rotating+claude", "hosted_pool"],
    ]) {
      const transition = { hostedPoolTransition: true };
      expect(comparableWorkflowRequirement(required!, transition)).toBe(
        comparableWorkflowRequirement(installed!, transition),
      );
      const settled = { hostedPoolTransition: false };
      expect(comparableWorkflowRequirement(required!, settled)).not.toBe(
        comparableWorkflowRequirement(installed!, settled),
      );
    }
    expect(
      comparableWorkflowRequirement("ci_secrets+claude", {
        hostedPoolTransition: true,
      }),
    ).toBe("ci_secrets+claude");
  });

  it("records the verified artifact when a hosted pool switch changes the workflow first", () => {
    const hosted = config([
      {
        kind: "codex",
        authMode: "codex_subscription_oauth_hosted_pool",
        model: "gpt-5.6-sol",
        ...settings,
      },
    ]);
    const rotating = config([
      {
        kind: "codex",
        authMode: "codex_subscription_oauth_rotating",
        model: "gpt-5.6-sol",
        ...settings,
      },
    ]);
    // Hosted -> rotating: the hosted policy is switched only after confirm.
    expect(
      verifiedWorkflowRequirement({
        managedTransport: null,
        codexWorkflow: { hosted: false },
        config: hosted,
      }),
    ).toBe(requiredWorkflowRequirement(rotating));
    // Rotating -> hosted: activation switches the rotating policy afterwards.
    expect(
      verifiedWorkflowRequirement({
        managedTransport: null,
        codexWorkflow: { hosted: true },
        config: rotating,
      }),
    ).toBe(requiredWorkflowRequirement(hosted));
    expect(
      verifiedWorkflowRequirement({
        managedTransport: null,
        codexWorkflow: null,
        config: mimo,
      }),
    ).toBe("ci_secrets+codex-mimo");
  });
});

it("requires a different verified caller after changing direct provider, even on the same path", () => {
  const kimi = config([
    {
      kind: "kimi",
      authMode: "kimi_code_api_key",
      model: "k3-256k",
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
  ]);
  expect(requiredWorkflowRequirement(kimi)).toBe("provider_api+kimi");
  expect(requiredWorkflowRequirement(kimi)).not.toBe(
    requiredWorkflowRequirement(mimo),
  );
  expect(
    verifiedWorkflowRequirement({
      managedTransport: "provider_api",
      providerApiAuthMode: "mimo-token-plan-api",
      codexWorkflow: null,
      config: kimi,
    }),
  ).toBe("provider_api+codex-mimo");
  expect(
    verifiedWorkflowRequirement({
      managedTransport: "provider_api",
      codexWorkflow: null,
      config: kimi,
    }),
  ).toBe("provider_api");
});

it.each([
  {
    kind: "codex-mimo",
    authMode: "mimo_token_plan_api_key",
    model: "mimo-v2.6-pro",
    ...settings,
  },
  {
    kind: "kimi",
    authMode: "kimi_code_api_key",
    model: "k3-256k",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  },
] as const)(
  "keeps a saved $kind-first mixed policy readable without selecting a legacy workflow",
  (provider) => {
    const policy = config([provider, hybridRotating.providers[0]!]);
    const before = structuredClone(policy);
    const unsupported = {
      status: "unsupported",
      reason: "provider_api_direct_requires_single_provider",
    };
    expect(inspectRequiredWorkflowTransport(policy)).toEqual(unsupported);
    expect(inspectRequiredWorkflowRequirement(policy)).toEqual(unsupported);
    expect(() => requiredWorkflowTransport(policy)).toThrow(unsupported.reason);
    expect(() => requiredWorkflowRequirement(policy)).toThrow(
      unsupported.reason,
    );
    expect(policy).toEqual(before);
  },
);
