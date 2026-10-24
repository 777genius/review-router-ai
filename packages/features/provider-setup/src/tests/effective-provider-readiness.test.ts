import { describe, expect, it } from "vitest";
import {
  resolveEffectiveProviderReadiness,
  type EffectiveProviderReadiness,
  type EffectiveProviderReadinessFacts,
  type ProviderSetupEvidence,
} from "../index";

const reportedAt = new Date("2026-01-02T00:00:00Z");
const before = new Date("2026-01-01T00:00:00Z");
const after = new Date("2026-01-03T00:00:00Z");

const rotating = [
  { kind: "codex", authMode: "codex_subscription_oauth_rotating" },
] as const;
const openRouter = [
  { kind: "openrouter", authMode: "openrouter_api_key" },
] as const;
const openRouterAndClaude = [
  { kind: "openrouter", authMode: "openrouter_api_key" },
  { kind: "claude", authMode: "claude_code_oauth" },
] as const;
const gateway = [{ kind: "codex", authMode: "codex_account_gateway" }] as const;
const hosted = [
  { kind: "codex", authMode: "codex_subscription_oauth_hosted_pool" },
] as const;

function row(
  providerKind: string,
  authMode: string,
  state = "configured",
  updatedAt = after,
): ProviderSetupEvidence {
  return { providerKind, authMode, state, updatedAt };
}

function facts(
  overrides: Partial<EffectiveProviderReadinessFacts> = {},
): EffectiveProviderReadinessFacts {
  return {
    providers: rotating,
    requiredWorkflowRequirement: null,
    installedWorkflowRequirement: null,
    setupStatus: "configured",
    setupNeedsAttention: false,
    healthStatus: "healthy",
    latestActionHealthReceivedAt: reportedAt,
    providerSetup: [],
    hostedSessionReady: false,
    gatewayAccountReady: false,
    gatewayAuthorizationReady: false,
    providerSecretCheckFailed: false,
    ...overrides,
  };
}

const ready = {
  healthStatus: "healthy",
  workflowCurrent: true,
  workflowUpdateRequired: false,
  step: "ready",
} as const satisfies EffectiveProviderReadiness;
const providerMissing = {
  healthStatus: "provider_needs_setup",
  workflowCurrent: true,
  workflowUpdateRequired: false,
  step: "provider",
} as const satisfies EffectiveProviderReadiness;

describe("resolveEffectiveProviderReadiness", () => {
  it.each<readonly [string, Partial<EffectiveProviderReadinessFacts>, object]>([
    [
      "no effective configuration keeps a healthy report from counting",
      { providers: null, providerSetup: [row("codex", rotating[0].authMode)] },
      providerMissing,
    ],
    [
      "a CI secret is ready once its exact provider row is configured",
      { providerSetup: [row("codex", rotating[0].authMode)] },
      ready,
    ],
    [
      "a row of another auth mode of the same kind is not evidence",
      { providerSetup: [row("codex", "codex_subscription_oauth")] },
      providerMissing,
    ],
    [
      "a matching row that is not configured blocks the provider",
      {
        providerSetup: [
          row("codex", rotating[0].authMode),
          row("codex", rotating[0].authMode, "stale_or_invalid", before),
        ],
      },
      providerMissing,
    ],
    [
      "an inherited secret default stays missing until this repository has the secret",
      { providers: openRouter, providerSetup: [] },
      providerMissing,
    ],
    [
      "every provider of a multi-provider policy needs its own row",
      {
        providers: openRouterAndClaude,
        providerSetup: [row("openrouter", "openrouter_api_key")],
      },
      providerMissing,
    ],
    [
      "a multi-provider policy is ready when every provider row is configured",
      {
        providers: openRouterAndClaude,
        providerSetup: [
          row("openrouter", "openrouter_api_key"),
          row("claude", "claude_code_oauth"),
        ],
      },
      ready,
    ],
    [
      "a stale report waits for setup confirmed after the latest run",
      {
        healthStatus: "provider_report_stale",
        providerSetup: [
          row("codex", rotating[0].authMode, "configured", before),
        ],
      },
      {
        healthStatus: "provider_report_stale",
        workflowCurrent: true,
        step: "provider",
      },
    ],
    [
      "a stale report completes with setup confirmed after the latest run",
      {
        healthStatus: "provider_report_stale",
        providerSetup: [row("codex", rotating[0].authMode)],
      },
      { healthStatus: "provider_report_stale", step: "ready" },
    ],
    [
      "a failed secret check withholds the provider confirmation",
      {
        healthStatus: "provider_report_stale",
        providerSecretCheckFailed: true,
        providerSetup: [row("codex", rotating[0].authMode)],
      },
      { healthStatus: "provider_report_stale", step: "provider" },
    ],
    [
      "an active hosted session replaces repository secrets",
      {
        providers: hosted,
        hostedSessionReady: true,
        healthStatus: "provider_needs_setup",
      },
      ready,
    ],
    [
      "an active hosted session reads a missing report as healthy",
      {
        providers: hosted,
        hostedSessionReady: true,
        healthStatus: undefined,
      },
      ready,
    ],
    [
      "an active hosted session keeps real provider failures",
      {
        providers: hosted,
        hostedSessionReady: true,
        healthStatus: "provider_unhealthy",
      },
      { healthStatus: "provider_unhealthy", step: "ready" },
    ],
    [
      "a hosted provider without an active session needs setup",
      { providers: hosted },
      providerMissing,
    ],
    [
      "a Gateway provider with a usable account and authorization is ready",
      {
        providers: gateway,
        gatewayAccountReady: true,
        gatewayAuthorizationReady: true,
      },
      ready,
    ],
    [
      "a Gateway provider waits for its review authorization",
      { providers: gateway, gatewayAccountReady: true },
      { healthStatus: "healthy", step: "provider" },
    ],
    [
      "a Gateway provider without a usable account needs setup",
      {
        providers: gateway,
        gatewayAuthorizationReady: true,
        providerSetup: [row("codex", "codex_account_gateway")],
        hostedSessionReady: true,
      },
      providerMissing,
    ],
    [
      "a Gateway provider keeps actual health failures",
      {
        providers: gateway,
        healthStatus: "missing_workflow",
        gatewayAccountReady: true,
        gatewayAuthorizationReady: true,
      },
      {
        healthStatus: "missing_workflow",
        workflowCurrent: false,
        step: "setup_pr",
      },
    ],
    [
      "an open setup PR is the merge step",
      { setupStatus: "setup_pr_open", healthStatus: undefined },
      { workflowCurrent: false, step: "merge_setup_pr" },
    ],
    [
      "a setup PR reported by health is the merge step",
      { setupStatus: "not_configured", healthStatus: "setup_pr_open" },
      { step: "merge_setup_pr" },
    ],
    [
      "a setup recovery issue returns to the first step even if healthy",
      {
        setupNeedsAttention: true,
        providerSetup: [row("codex", rotating[0].authMode)],
      },
      { healthStatus: "healthy", step: "setup_pr" },
    ],
    [
      "a generic setup failure does not hide an already current workflow",
      { setupStatus: "needs_attention", healthStatus: "provider_needs_setup" },
      providerMissing,
    ],
    [
      "an unknown installed transport never requires a workflow update",
      {
        requiredWorkflowRequirement: "rotating",
        providerSetup: [row("codex", rotating[0].authMode)],
      },
      ready,
    ],
    [
      "the same installed transport keeps the workflow current",
      {
        requiredWorkflowRequirement: "rotating",
        installedWorkflowRequirement: "rotating",
        providerSetup: [row("codex", rotating[0].authMode)],
      },
      ready,
    ],
    [
      "a different installed transport requires a workflow update",
      {
        requiredWorkflowRequirement: "gateway",
        installedWorkflowRequirement: "ci_secrets",
        providers: gateway,
        gatewayAccountReady: true,
        gatewayAuthorizationReady: true,
      },
      {
        healthStatus: "healthy",
        workflowCurrent: false,
        workflowUpdateRequired: true,
        step: "setup_pr",
      },
    ],
    [
      "an open setup PR carries the workflow update",
      {
        requiredWorkflowRequirement: "gateway",
        installedWorkflowRequirement: "ci_secrets",
        setupStatus: "setup_pr_open",
      },
      { workflowUpdateRequired: true, step: "merge_setup_pr" },
    ],
  ])("%s", (_name, overrides, expected) => {
    expect(resolveEffectiveProviderReadiness(facts(overrides))).toMatchObject(
      expected,
    );
  });
});
