import {
  providerApiAuthModes,
  providerApiDescriptors,
} from "@reviewrouter/shared";
import {
  assertProviderApiDirectConfigurationSupported,
  providerApiConfigurationMode,
} from "../domain/provider-api-t0-configuration";
import { expect, it } from "vitest";
import {
  assertOpenRouterDirectConfigurationSupported,
  isOpenRouterDirectConfiguration,
} from "../domain/provider-api-t0-configuration";
import { parseReviewConfigurationStrict } from "../domain/review-configuration";
import { mapConfigToRuntimeEnv } from "../application/use-cases/map-config-to-runtime-env";
import { workspacePolicyFixture } from "./current-policy-fixture";

const configuration = {
  ...workspacePolicyFixture,
  providers: [
    {
      kind: "openrouter" as const,
      authMode: "openrouter_api_key" as const,
      model: "openai/gpt-5.3-codex",
      reasoningEffort: "high" as const,
      agenticContext: true,
      fastMode: false,
      requiredHealthy: true,
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
};

it("accepts a single direct OpenRouter model without changing its policy", () => {
  const before = structuredClone(configuration);
  assertOpenRouterDirectConfigurationSupported(configuration);
  expect(isOpenRouterDirectConfiguration(configuration)).toBe(true);
  expect(configuration).toEqual(before);
});

it.each([
  {
    ...configuration,
    providers: [...configuration.providers, ...configuration.providers],
  },
  {
    ...configuration,
    providers: [
      ...configuration.providers,
      ...workspacePolicyFixture.providers,
    ],
  },
  {
    ...configuration,
    execution: { ...configuration.execution, inlineMinAgreement: 2 },
  },
  { ...configuration, providers: workspacePolicyFixture.providers },
  {
    ...configuration,
    providers: [{ ...configuration.providers[0]!, model: "unqualified-model" }],
  },
])(
  "rejects an incompatible policy instead of selecting its first provider",
  (policy) => {
    const before = structuredClone(policy);
    expect(() => assertOpenRouterDirectConfigurationSupported(policy)).toThrow(
      "openrouter_direct_requires_single_provider",
    );
    expect(policy).toEqual(before);
  },
);

it("keeps managed OpenRouter and secondary OpenRouter policies on their existing route", () => {
  const gateway = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex",
        authMode: "codex_account_gateway",
        model: "openai/gpt-5.3-codex",
        gatewayBindingId: "gateway-binding",
        gatewayProfileRef: "openrouter-openai-responses-apikey-v1",
      },
    ],
  });
  const hybrid = parseReviewConfigurationStrict({
    ...workspacePolicyFixture,
    providers: [
      {
        kind: "codex-mimo",
        authMode: "mimo_token_plan_api_key",
        model: "mimo-v2.6-pro",
      },
      ...configuration.providers,
    ],
    execution: {
      providerLimit: 2,
      providerMaxParallel: 2,
      inlineMinAgreement: 2,
    },
  });
  for (const policy of [gateway, hybrid]) {
    const before = structuredClone(policy);
    expect(isOpenRouterDirectConfiguration(policy)).toBe(false);
    expect(policy).toEqual(before);
  }
  expect(mapConfigToRuntimeEnv(hybrid).REVIEW_AUTH_MODE).toBe(
    "mimo-token-plan-api",
  );
  // Primary direct auth must reject the same mixed policy, never fall back.
  expect(() =>
    isOpenRouterDirectConfiguration({
      ...hybrid,
      providers: [...hybrid.providers].reverse(),
    }),
  ).toThrow("openrouter_direct_requires_single_provider");
});

it.each(providerApiAuthModes)(
  "captures only the finite single provider policy for %s",
  (mode) => {
    const descriptor = providerApiDescriptors[mode];
    const provider = {
      kind: descriptor.providerKind,
      authMode: descriptor.authMode,
      model: descriptor.defaultModel,
      ...(mode === "kimi-code-api" ? {} : { reasoningEffort: "high" }),
      fastMode: false,
      agenticContext: true,
      requiredHealthy: true,
    };
    const policy = parseReviewConfigurationStrict({
      ...configuration,
      providers: [provider],
    });
    expect(assertProviderApiDirectConfigurationSupported(policy)).toBe(mode);
    expect(providerApiConfigurationMode(policy)).toBe(mode);
    const env = mapConfigToRuntimeEnv(policy);
    expect(env.REVIEW_AUTH_MODE).toBe(mode);
    expect(env.REVIEW_PROVIDERS).toBe(
      `${descriptor.runtimePrefix}/${descriptor.defaultModel}`,
    );
    expect(env).not.toHaveProperty(descriptor.secretName);
    if (mode === "kimi-code-api") {
      expect(policy.providers[0]).not.toHaveProperty("reasoningEffort");
      expect(env).not.toHaveProperty("CODEX_REASONING_EFFORT");
    }
    expect(() =>
      assertProviderApiDirectConfigurationSupported({
        ...policy,
        providers: [...policy.providers, ...configuration.providers],
      }),
    ).toThrow();
  },
);
it.each([
  { reasoningEffort: "xhigh" },
  { fastMode: true },
  { model: "unqualified" },
])(
  "Kimi rejects unsupported tuning/model instead of adding defaults",
  (override) => {
    expect(() =>
      parseReviewConfigurationStrict({
        ...configuration,
        providers: [
          {
            kind: "kimi",
            authMode: "kimi_code_api_key",
            model: "k3-256k",
            agenticContext: true,
            fastMode: false,
            ...override,
          },
        ],
      }),
    ).toThrow();
  },
);
