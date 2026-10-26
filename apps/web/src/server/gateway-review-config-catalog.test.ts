import { expect, test } from "vitest";
import type { ReviewProviderConfiguration } from "@reviewrouter/features-review-config";
import type { AccountProfileView } from "./account-gateway-accounts";
import {
  assertGatewayReviewConfigCatalogAllowed,
  assertGatewayReviewAgentProfileContextAllowed,
} from "./gateway-review-config-catalog";

const gateway = {
  kind: "codex",
  authMode: "codex_account_gateway",
  gatewayBindingId: "fixture-binding",
  gatewayProfileRef: "fixture-responses",
  model: "fixture-model",
  reasoningEffort: "high",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} satisfies ReviewProviderConfiguration;
const profile = {
  id: "fixture-responses",
  label: "Fixture",
  protocol: "openai-responses",
  models: ["fixture-model"],
} satisfies AccountProfileView;

test("server saves reject known OCR without native context and preserve other saved engines", () => {
  const profiles = [
    {
      profileRef: "ocr-managed-v2",
      agentKind: "ocr" as const,
      label: "OCR",
      description: "OCR",
    },
    {
      profileRef: "codex-default",
      agentKind: "codex" as const,
      label: "Codex",
      description: "Codex",
    },
  ];
  expect(() =>
    assertGatewayReviewAgentProfileContextAllowed(
      {
        providers: [
          {
            ...gateway,
            agentProfileRef: "ocr-managed-v2",
            agenticContext: false,
          },
        ],
      },
      () => profiles,
    ),
  ).toThrow("agent_profile_requires_agentic_context");
  for (const agentProfileRef of [
    undefined,
    "codex-default",
    "historical-unavailable",
  ]) {
    expect(() =>
      assertGatewayReviewAgentProfileContextAllowed(
        {
          providers: [
            {
              ...gateway,
              ...(agentProfileRef ? { agentProfileRef } : {}),
              agenticContext: false,
            },
          ],
        },
        () => profiles,
      ),
    ).not.toThrow();
  }
  expect(() =>
    assertGatewayReviewAgentProfileContextAllowed(
      {
        providers: [
          {
            ...gateway,
            agentProfileRef: "ocr-managed-v2",
            agenticContext: true,
          },
        ],
      },
      () => profiles,
    ),
  ).not.toThrow();
});

// RED if a later Gateway row can bypass catalog admission, or membership is
// checked globally instead of on the selected profile and supported protocol.
test.each([
  { ...gateway, model: "fixture-other-model" },
  { ...gateway, gatewayProfileRef: "fixture-missing" },
])("refuses an unsupported secondary Gateway selection: %o", async (row) => {
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [gateway, row] },
      async () => [
        profile,
        { ...profile, id: "fixture-other", models: ["fixture-other-model"] },
      ],
    ),
  ).rejects.toThrow("gateway_review_model_unsupported");
});

test("refuses an advertised model on an unsupported protocol", async () => {
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [gateway] },
      async () => [{ ...profile, protocol: "openai-chat" }],
    ),
  ).rejects.toThrow("gateway_review_model_unsupported");
});

test("accepts a current advertised Responses model", async () => {
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [gateway] },
      async () => [profile],
    ),
  ).resolves.toBe(true);
});

test("enforces qualified MiMo Gateway reasoning without changing Codex or OpenRouter", async () => {
  const mimo = { ...gateway, model: "mimo-v2.6-pro" };
  const profiles = [
    { ...profile, models: [mimo.model, "gpt-6.1-sol", "openai/gpt-5-nano"] },
  ];
  for (const reasoningEffort of ["low", "medium", "high"] as const) {
    await expect(
      assertGatewayReviewConfigCatalogAllowed(
        { providers: [{ ...mimo, reasoningEffort }] },
        async () => profiles,
      ),
    ).resolves.toBe(true);
  }
  for (const reasoningEffort of ["xhigh", "max", "ultra"] as const) {
    await expect(
      assertGatewayReviewConfigCatalogAllowed(
        { providers: [{ ...mimo, reasoningEffort }] },
        async () => profiles,
      ),
    ).rejects.toThrow("gateway_review_reasoning_effort_unsupported");
    for (const model of ["gpt-6.1-sol", "openai/gpt-5-nano"]) {
      await expect(
        assertGatewayReviewConfigCatalogAllowed(
          { providers: [{ ...gateway, model, reasoningEffort }] },
          async () => profiles,
        ),
      ).resolves.toBe(true);
    }
  }
});

// RED if availability errors become an admission bypass, or a legacy save
// depends on Accounts/Gateway availability.
test("refuses Gateway admission when the catalog is unavailable", async () => {
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [gateway] },
      async () => {
        throw new Error("fixture_catalog_unavailable");
      },
    ),
  ).rejects.toThrow("fixture_catalog_unavailable");
});

test("legacy-only configuration performs no catalog I/O", async () => {
  const legacy = {
    kind: "codex",
    authMode: "codex_subscription_oauth_rotating",
    model: "fixture-legacy",
    reasoningEffort: "high",
    agenticContext: true,
    fastMode: false,
    requiredHealthy: true,
  } satisfies ReviewProviderConfiguration;
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [legacy] },
      async () => {
        throw new Error("catalog_must_not_be_called");
      },
    ),
  ).resolves.toBe(false);
});

test("qualified models without reasoning/fast controls save only omitted settings", async () => {
  const connection = {
    provider: "kimi" as const,
    planLabel: "Kimi Code",
    regionLabel: "Global",
    completionInputKind: "none" as const,
    personalOnly: false,
    limitsContract: "account-limits/v2" as const,
    modelSettings: [
      {
        modelId: gateway.model,
        reasoning: null,
        fast: null,
        tools: {
          allowed: ["function_and_custom" as const],
          default: "function_and_custom" as const,
        },
      },
    ],
  };
  const profiles = [{ ...profile, connection }];
  const selection = { ...gateway, reasoningEffort: undefined };
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [selection] },
      async () => profiles,
    ),
  ).resolves.toBe(true);
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [gateway] },
      async () => profiles,
    ),
  ).rejects.toThrow("gateway_review_reasoning_effort_unsupported");
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [{ ...selection, fastMode: true }] },
      async () => profiles,
    ),
  ).rejects.toThrow("gateway_review_fast_mode_unsupported");
});

// RED if two accounts sharing one profile ID can authorize each other's models.
test("resolves catalog membership and reasoning separately for each binding", async () => {
  const other = {
    ...gateway,
    gatewayBindingId: "other-binding",
    model: "account-b-only",
  };
  const load = async (selection: { gatewayBindingId: string }) => [
    {
      ...profile,
      models:
        selection.gatewayBindingId === gateway.gatewayBindingId
          ? [gateway.model]
          : [other.model],
    },
  ];
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [gateway, other] },
      load,
    ),
  ).resolves.toBe(true);
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [{ ...other, model: gateway.model }] },
      load,
    ),
  ).rejects.toThrow("gateway_review_model_unsupported");
});

test("preserves a saved Codex Ultra selection against canonical Max capabilities", async () => {
  const selected = {
    ...gateway,
    gatewayProfileRef: "openai-codex-oauth-responses-v1",
    reasoningEffort: "ultra" as const,
  };
  const connection = {
    provider: "openai" as const,
    planLabel: "Codex",
    regionLabel: "Global",
    completionInputKind: "none" as const,
    personalOnly: false,
    limitsContract: "none" as const,
    modelSettings: [
      {
        modelId: gateway.model,
        reasoning: { allowed: ["max"], default: "max" },
        fast: { allowed: ["balanced"], default: "balanced" },
        tools: { allowed: ["function" as const], default: "function" as const },
      },
    ],
  };
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [selected] },
      async () => [{ ...profile, id: selected.gatewayProfileRef, connection }],
    ),
  ).resolves.toBe(true);
  expect(selected.reasoningEffort).toBe("ultra");
  await expect(
    assertGatewayReviewConfigCatalogAllowed(
      { providers: [{ ...selected, gatewayProfileRef: profile.id }] },
      async () => [{ ...profile, connection }],
    ),
  ).rejects.toThrow("gateway_review_reasoning_effort_unsupported");
});
