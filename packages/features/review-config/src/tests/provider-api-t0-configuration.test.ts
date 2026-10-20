import { expect, it } from "vitest";
import { assertOpenRouterDirectConfigurationSupported } from "../domain/provider-api-t0-configuration";
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
