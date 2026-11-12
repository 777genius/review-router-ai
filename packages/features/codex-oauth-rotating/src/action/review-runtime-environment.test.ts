import { describe, expect, it } from "vitest";
import { buildFullReviewRuntimeEnv } from "./review-runtime-environment";
import type { ActionInputs, PullRequestEvent } from "./action-contract";

const inputs: ActionInputs = {
  mode: "codex-oauth-rotating",
  apiUrl: "https://api.reviewrouter.test",
  providerInstanceId: "provider-instance-1234",
  workflowSchemaVersion: 4,
  reviewDrafts: false,
  maxChangedLines: 1000,
  reviewTimeoutMinutes: 60,
  providerSecrets: {},
};

const event: PullRequestEvent = {
  number: 42,
  repositoryId: "123456",
  repository: "example/repository",
  owner: "example",
  repo: "repository",
  headSha: "a".repeat(40),
  baseSha: "b".repeat(40),
};

function build(
  runtimeEnv: Record<string, string>,
  overrides: {
    readonly sourceEnv?: NodeJS.ProcessEnv;
    readonly inputs?: ActionInputs;
    readonly providerMode?: "codex-oauth-rotating" | "hosted-relay";
  } = {},
): Record<string, string> {
  return buildFullReviewRuntimeEnv({
    sourceEnv: overrides.sourceEnv ?? { PATH: "/usr/bin" },
    inputs: overrides.inputs ?? inputs,
    leaseId: "lease-123",
    event,
    workspace: "/safe/workspace",
    tempHome: "/safe/home",
    tempCodexHome: "/safe/codex-home",
    codexBinDir: "/safe/bin",
    commentToken: "github-comment-token",
    runtimeConfigVersion: 1,
    runtimeEnv,
    executionDeadlineEpochMs: 1_800_000_000_000,
    commentTokenRefreshMode: overrides.providerMode,
  });
}

describe("review runtime environment security boundary", () => {
  it("retains the exact repository and execution identity without source token leakage", () => {
    const env = build(
      { REVIEW_PROVIDERS: "codex/example-model" },
      {
        sourceEnv: {
          PATH: "/usr/bin",
          ACTIONS_ID_TOKEN_REQUEST_TOKEN: "oidc-secret",
          CODEX_AUTH_JSON: "private-json",
          HOME: "/unsafe/home",
        },
      },
    );
    expect(env.REVIEWROUTER_REPOSITORY_EXTERNAL_ID).toBe("123456");
    expect(env.REVIEWROUTER_REPOSITORY_FULL_NAME).toBe("example/repository");
    expect(env.REVIEWROUTER_HEAD_SHA).toBe("a".repeat(40));
    expect(env.REVIEWROUTER_EXECUTION_DEADLINE_EPOCH_MS).toBe("1800000000000");
    expect(env.HOME).toBe("/safe/home");
    expect(env.CODEX_HOME).toBe("/safe/codex-home");
    expect(env.GITHUB_TOKEN).toBe("github-comment-token");
    expect(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN).toBeUndefined();
    expect(env.CODEX_AUTH_JSON).toBeUndefined();
  });

  it("never injects credentials for an unselected provider", () => {
    const env = build(
      { REVIEW_PROVIDERS: "codex/example-model" },
      {
        inputs: {
          ...inputs,
          providerSecrets: {
            claudeCodeOAuthToken: "claude-private",
            openRouterApiKey: "router-private",
            mimoTokenPlanApiKey: "mimo-private",
          },
        },
      },
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(env.MIMO_TOKEN_PLAN_API_KEY).toBeUndefined();
  });

  it("provides only secrets for selected providers", () => {
    const env = build(
      {
        REVIEW_PROVIDERS:
          "codex-mimo/model,openrouter/vendor/model,claude/sonnet",
      },
      {
        inputs: {
          ...inputs,
          providerSecrets: {
            claudeCodeOAuthToken: "claude-private",
            openRouterApiKey: "router-private",
            mimoTokenPlanApiKey: "mimo-private",
          },
        },
      },
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("claude-private");
    expect(env.OPENROUTER_API_KEY).toBe("router-private");
    expect(env.MIMO_TOKEN_PLAN_API_KEY).toBe("mimo-private");
  });

  it("forwards only the planner-selected Claude OAuth secret in rotating runtime", () => {
    const env = build(
      {
        REVIEW_PROVIDERS: "claude/sonnet",
        REVIEWROUTER_CLAUDE_AUTH_MODE: "claude-oauth",
      },
      {
        inputs: {
          ...inputs,
          providerSecrets: {
            claudeCodeOAuthToken: "sk-ant-oat01-selected-synthetic",
          },
        },
        sourceEnv: {
          PATH: "/usr/bin",
          ANTHROPIC_API_KEY: "sk-ant-api03-stale-synthetic",
        },
      },
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("sk-ant-oat01-selected-synthetic");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it.each([
    {
      runtimeMode: "codex-oauth" as const,
      claudeAuthMode: "claude_code_api_key" as const,
    },
    {
      runtimeMode: "claude-api-key" as const,
      claudeAuthMode: "claude_code_api_key" as const,
    },
    {
      runtimeMode: "codex-oauth" as const,
      claudeAuthMode: "claude-api-key" as const,
    },
  ])(
    "rejects unqualified Claude API-key Action routing even with a stale OAuth token ($runtimeMode)",
    ({ runtimeMode, claudeAuthMode }) => {
      expect(() =>
        build(
          {
            REVIEW_AUTH_MODE: runtimeMode,
            REVIEW_PROVIDERS: "claude/sonnet",
            REVIEWROUTER_CLAUDE_AUTH_MODE: claudeAuthMode,
          },
          {
            inputs: {
              ...inputs,
              providerSecrets: {
                claudeCodeOAuthToken: "sk-ant-oat01-synthetic-unselected",
              },
            },
            sourceEnv: {
              PATH: "/usr/bin",
              ANTHROPIC_API_KEY: "sk-ant-api03-inherited",
              CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-inherited",
            },
          },
        ),
      ).toThrow("claude_api_key_rotating_transport_unsupported");
    },
  );

  it("does not inject subscription OAuth into a Claude runtime with an unrecognized auth mode", () => {
    const env = build(
      {
        REVIEW_PROVIDERS: "claude/sonnet",
        REVIEWROUTER_CLAUDE_AUTH_MODE: "unqualified",
      },
      {
        inputs: {
          ...inputs,
          providerSecrets: {
            claudeCodeOAuthToken: "sk-ant-oat01-not-selected",
          },
        },
      },
    );
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("rejects missing required mimo-token-plan credentials before launching a runtime", () => {
    expect(() => build({ REVIEW_PROVIDERS: "codex-mimo/model" })).toThrow(
      "missing_mimo_token_plan_api_key",
    );
  });

  it("rejects secret-bearing runtime config keys without exposing their values", () => {
    expect(() =>
      build({
        REVIEW_PROVIDERS: "codex/model",
        CLAUDE_CODE_OAUTH_TOKEN: "should-not-log",
      }),
    ).toThrow("unsafe_runtime_env_key:CLAUDE_CODE_OAUTH_TOKEN");
    expect(() =>
      build({ REVIEW_PROVIDERS: "codex/model", "bad key": "secret" }),
    ).toThrow("unsafe_runtime_env_key:<invalid-env-key>");
  });

  it("does not reintroduce caller reasoning settings for protected Account Gateway", () => {
    const env = build(
      {
        REVIEW_AUTH_MODE: "codex-account-gateway",
        REVIEW_PROVIDERS: "codex/model",
      },
      {
        sourceEnv: {
          PATH: "/usr/bin",
          CODEX_REASONING_EFFORT: "xhigh",
          CODEX_FAST_MODE: "true",
        },
      },
    );
    expect(env.CODEX_REASONING_EFFORT).toBeUndefined();
    expect(env.CODEX_FAST_MODE).toBeUndefined();
    expect(env.REVIEW_AUTH_MODE).toBe("codex-account-gateway");
  });
});
