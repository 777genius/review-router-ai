/** Sanitized runtime and provider-secret environment policy for Action subprocesses. */
import { join } from "node:path";
import {
  codexRotatingRuntimeAuthMode,
  pruneCodexRotatingChildEnv,
} from "../domain/codex-oauth-rotating";
import { createReviewExecutionDeadlineEpochMs } from "../domain/review-execution-budget";
import {
  reviewThreadLifecycleResolveTokenEnvKey,
  type ActionInputs,
  type ProviderSecretInputs,
  type PullRequestEvent,
} from "./action-contract.js";

const providerNeutralReviewFindingsArtifactFileName =
  "reviewrouter-findings.json";

export function buildFullReviewRuntimeEnv(input: {
  readonly sourceEnv: NodeJS.ProcessEnv;
  readonly inputs: ActionInputs;
  readonly leaseId: string;
  readonly event: PullRequestEvent;
  readonly workspace: string;
  readonly tempHome: string;
  readonly tempCodexHome: string;
  readonly codexBinDir: string;
  readonly commentToken: string;
  readonly commentTokenExpiresAt?: string | undefined;
  readonly runtimeConfigVersion: number;
  readonly runtimeEnv: Record<string, string>;
  readonly reviewThreadLifecycleResolveToken?: string | undefined;
  readonly reviewSnapshotInputPath?: string | undefined;
  readonly reviewSnapshotOutputPath?: string | undefined;
  readonly reviewCheckpointFinalizationPath?: string | undefined;
  readonly executionDeadlineEpochMs?: number | undefined;
  readonly commentTokenRefreshUrl?: string | undefined;
  readonly commentTokenRefreshMode?:
    | "codex-oauth-rotating"
    | "hosted-relay"
    | undefined;
  readonly sessionBindingId?: string | undefined;
  readonly sessionBindingVersion?: number | undefined;
}): Record<string, string> {
  const inherited = pruneCodexRotatingChildEnv(input.sourceEnv);
  const runtimeEnv = normalizeFullReviewRuntimeEnv(input.runtimeEnv);
  if (runtimeEnv.REVIEW_AUTH_MODE === "codex-account-gateway") {
    // The protected policy owns Gateway settings, including intentional absence.
    // Workflow defaults cannot reintroduce controls unqualified by the catalog.
    delete inherited.CODEX_REASONING_EFFORT;
    delete inherited.CODEX_FAST_MODE;
  }
  const reviewAuthMode =
    runtimeEnv.REVIEW_AUTH_MODE === codexRotatingRuntimeAuthMode
      ? "codex-oauth"
      : (runtimeEnv.REVIEW_AUTH_MODE ?? "codex-oauth");
  const providerSecretEnv = buildProviderSecretEnvForRuntime({
    runtimeEnv,
    providerSecrets: input.inputs.providerSecrets,
  });
  const reviewThreadLifecycleResolveEnv =
    input.reviewThreadLifecycleResolveToken
      ? {
          [reviewThreadLifecycleResolveTokenEnvKey]:
            input.reviewThreadLifecycleResolveToken,
        }
      : {};
  const executionDeadlineEpochMs =
    input.executionDeadlineEpochMs ??
    createReviewExecutionDeadlineEpochMs({
      jobTimeoutMinutes: input.inputs.reviewTimeoutMinutes,
      executionStartedAtEpochMs: Date.now(),
    });
  return {
    ...inherited,
    ...runtimeEnv,
    ...providerSecretEnv,
    ...reviewThreadLifecycleResolveEnv,
    HOME: input.tempHome,
    CODEX_HOME: input.tempCodexHome,
    GITHUB_WORKSPACE: input.workspace,
    CI: "true",
    PATH: `${input.codexBinDir}:${join(input.tempHome, ".local", "bin")}:${input.sourceEnv.PATH ?? process.env.PATH ?? ""}`,
    GITHUB_OUTPUT: join(input.tempHome, "github-output"),
    GITHUB_TOKEN: input.commentToken,
    PR_NUMBER: String(input.event.number),
    REVIEW_AUTH_MODE: reviewAuthMode,
    CODEX_AGENTIC_AUDIT: runtimeEnv.CODEX_AGENTIC_AUDIT ?? "rerun",
    FAIL_ON_NO_HEALTHY_PROVIDERS:
      runtimeEnv.FAIL_ON_NO_HEALTHY_PROVIDERS ?? "true",
    REVIEWROUTER_RUNTIME_CONFIG_MODE: "static",
    REVIEWROUTER_STATIC_CONFIG_FALLBACK: "false",
    REVIEWROUTER_COMMENT_TOKEN_MODE:
      input.commentTokenRefreshMode ?? "codex-oauth-rotating",
    REVIEWROUTER_COMMENT_TOKEN_REFRESH_URL:
      input.commentTokenRefreshUrl ??
      `${input.inputs.apiUrl}/api/action/v1/codex-oauth/comment-token`,
    REVIEWROUTER_COMMENT_TOKEN_LEASE_ID: input.leaseId,
    REVIEWROUTER_COMMENT_TOKEN_PROVIDER_INSTANCE_ID:
      input.inputs.providerInstanceId,
    ...(input.sessionBindingId
      ? { REVIEWROUTER_SESSION_BINDING_ID: input.sessionBindingId }
      : {}),
    ...(input.sessionBindingVersion !== undefined
      ? {
          REVIEWROUTER_SESSION_BINDING_VERSION: String(
            input.sessionBindingVersion,
          ),
        }
      : {}),
    ...(input.commentTokenExpiresAt
      ? {
          REVIEWROUTER_COMMENT_TOKEN_EXPIRES_AT: input.commentTokenExpiresAt,
        }
      : {}),
    REVIEWROUTER_SCM_PROVIDER: "github",
    REVIEWROUTER_FINDINGS_ARTIFACT_PATH:
      providerNeutralReviewFindingsArtifactFileName,
    REVIEWROUTER_REPOSITORY_EXTERNAL_ID:
      input.event.repositoryId ?? input.event.repository,
    REVIEWROUTER_REPOSITORY_FULL_NAME: input.event.repository,
    REVIEWROUTER_CHANGE_REQUEST_EXTERNAL_ID: String(input.event.number),
    REVIEWROUTER_HEAD_SHA: input.event.headSha,
    REVIEWROUTER_BASE_SHA: input.event.baseSha,
    REVIEWROUTER_REVIEW_MARKER: `reviewrouter:${
      input.commentTokenRefreshMode === "hosted-relay"
        ? "hosted-pool"
        : "codex-oauth-rotating"
    } head=${input.event.headSha}`,
    REVIEWROUTER_API_URL: input.inputs.apiUrl,
    REVIEWROUTER_CONTROL_PLANE_URL: input.inputs.apiUrl,
    REVIEWROUTER_CONFIG_VERSION: String(input.runtimeConfigVersion),
    REVIEWROUTER_EXECUTION_DEADLINE_EPOCH_MS: String(executionDeadlineEpochMs),
    REVIEWROUTER_REVIEW_CHECKPOINT_FINALIZATION_PATH:
      input.reviewCheckpointFinalizationPath ?? "",
    REVIEWROUTER_INCREMENTAL_SNAPSHOT_REQUIRED: "true",
    ...(input.reviewSnapshotInputPath
      ? {
          REVIEWROUTER_INCREMENTAL_SNAPSHOT_INPUT_PATH:
            input.reviewSnapshotInputPath,
        }
      : {}),
    ...(input.reviewSnapshotOutputPath
      ? {
          REVIEWROUTER_INCREMENTAL_SNAPSHOT_OUTPUT_PATH:
            input.reviewSnapshotOutputPath,
        }
      : {}),
  };
}

function buildProviderSecretEnvForRuntime(input: {
  readonly runtimeEnv: Readonly<Record<string, string>>;
  readonly providerSecrets: ProviderSecretInputs;
}): Record<string, string> {
  assertProviderSecretInputsForRuntime(input);
  const env: Record<string, string> = {};
  // This Action supports Claude subscriptions only through the original CLI.
  // API-key Claude is approved on the standalone Secrets runtime, not through
  // rotating/hosted Action transports. Never silently inject an old OAuth token.
  if (
    (runtimeProvidersInclude(input.runtimeEnv, "claude/") ||
      input.runtimeEnv.REVIEW_AUTH_MODE === "claude-api-key") &&
    (input.runtimeEnv.REVIEWROUTER_CLAUDE_AUTH_MODE === "claude_code_api_key" ||
      input.runtimeEnv.REVIEW_AUTH_MODE === "claude-api-key")
  ) {
    throw new Error("claude_api_key_rotating_transport_unsupported");
  }
  if (
    runtimeProvidersInclude(input.runtimeEnv, "claude/") &&
    (!input.runtimeEnv.REVIEWROUTER_CLAUDE_AUTH_MODE ||
      input.runtimeEnv.REVIEWROUTER_CLAUDE_AUTH_MODE === "claude_code_oauth") &&
    input.providerSecrets.claudeCodeOAuthToken
  ) {
    env.CLAUDE_CODE_OAUTH_TOKEN = input.providerSecrets.claudeCodeOAuthToken;
  }
  if (
    runtimeProvidersInclude(input.runtimeEnv, "openrouter/") &&
    input.providerSecrets.openRouterApiKey
  ) {
    env.OPENROUTER_API_KEY = input.providerSecrets.openRouterApiKey;
  }
  if (
    runtimeProvidersInclude(input.runtimeEnv, "codex-mimo/") &&
    input.providerSecrets.mimoTokenPlanApiKey
  ) {
    env.MIMO_TOKEN_PLAN_API_KEY = input.providerSecrets.mimoTokenPlanApiKey;
  }
  return env;
}

export function assertProviderSecretInputsForRuntime(input: {
  readonly runtimeEnv: Readonly<Record<string, string>>;
  readonly providerSecrets: ProviderSecretInputs;
}): void {
  if (
    runtimeProvidersInclude(input.runtimeEnv, "codex-mimo/") &&
    !input.providerSecrets.mimoTokenPlanApiKey
  ) {
    throw new Error("missing_mimo_token_plan_api_key");
  }
}

export function runtimeProvidersInclude(
  runtimeEnv: Readonly<Record<string, string>>,
  providerPrefix: string,
): boolean {
  return (runtimeEnv.REVIEW_PROVIDERS ?? "")
    .split(",")
    .some((provider) => provider.trim().startsWith(providerPrefix));
}

const forkRuntimeEnvAllowedKeys = new Set([
  "REVIEWROUTER_CONFIG_SCHEMA_VERSION",
  "REVIEW_AUTH_MODE",
  "INLINE_MAX_COMMENTS",
  "INLINE_MIN_SEVERITY",
  "TARGET_TOKENS_PER_BATCH",
  "FAIL_ON_SEVERITY",
  "REVIEW_OUTPUT_LANGUAGE",
  "CODEX_MODEL",
  "CODEX_REASONING_EFFORT",
  "CODEX_AGENTIC_CONTEXT",
  "CODEX_FAST_MODE",
  "CODEX_AGENTIC_AUDIT",
  "CODEX_EVENT_AUDIT",
  "CLAUDE_MODEL",
  "CLAUDE_AGENTIC_CONTEXT",
  "FAIL_ON_NO_HEALTHY_PROVIDERS",
]);

const certifiedForkAgenticProviderPrefixes = [
  "codex/",
  "claude/",
  "openrouter/",
  "codex-openrouter/",
] as const;

export function forkAgenticSandboxRuntimeEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const normalized = normalizeFullReviewRuntimeEnv(runtimeEnv);
  const forkProviders = parseRuntimeProviders(
    normalized.REVIEW_PROVIDERS,
  ).filter(isCertifiedForkAgenticProvider);
  if (forkProviders.length === 0) {
    throw new Error("fork_agentic_sandbox_requires_certified_provider");
  }
  const primaryProvider = forkProviders[0]!;
  const allowedRuntimeEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(normalized)) {
    if (forkRuntimeEnvAllowedKeys.has(key)) {
      allowedRuntimeEnv[key] = value;
    }
  }
  const providerLimit = Math.min(
    forkRuntimePositiveInteger(normalized.PROVIDER_LIMIT, forkProviders.length),
    forkProviders.length,
  );
  const providerMaxParallel = Math.min(
    forkRuntimePositiveInteger(normalized.PROVIDER_MAX_PARALLEL, providerLimit),
    providerLimit,
  );
  const requiredHealthyProviders = parseRuntimeProviders(
    normalized.REQUIRED_HEALTHY_PROVIDERS,
  ).filter((provider) => forkProviders.includes(provider));
  const synthesisModel = forkProviders.includes(
    normalized.SYNTHESIS_MODEL ?? "",
  )
    ? normalized.SYNTHESIS_MODEL!
    : primaryProvider;
  const inlineMinAgreement = Math.min(
    forkRuntimePositiveInteger(normalized.INLINE_MIN_AGREEMENT, 1),
    providerLimit,
  );
  const forkEnv: Record<string, string> = {
    ...allowedRuntimeEnv,
    REVIEW_PROVIDERS: forkProviders.join(","),
    REQUIRED_HEALTHY_PROVIDERS:
      requiredHealthyProviders.length > 0
        ? requiredHealthyProviders.join(",")
        : primaryProvider,
    SYNTHESIS_MODEL: synthesisModel,
    PROVIDER_LIMIT: String(providerLimit),
    PROVIDER_MAX_PARALLEL: String(providerMaxParallel),
    INLINE_MIN_AGREEMENT: String(inlineMinAgreement),
    REVIEWROUTER_FORK_AGENTIC_SANDBOX: "true",
  };
  if (forkProviders.some((provider) => provider.startsWith("claude/"))) {
    forkEnv.CLAUDE_AGENTIC_CONTEXT = "true";
  }
  return forkEnv;
}

function parseRuntimeProviders(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
}

function isCertifiedForkAgenticProvider(provider: string): boolean {
  return certifiedForkAgenticProviderPrefixes.some((prefix) =>
    provider.startsWith(prefix),
  );
}

function forkRuntimePositiveInteger(
  value: string | undefined,
  defaultValue: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return defaultValue;
  }
  return parsed;
}

export function codexModelForForkRuntime(
  runtimeEnv: Readonly<Record<string, string>>,
): string {
  const provider = (runtimeEnv.REVIEW_PROVIDERS ?? "")
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith("codex/"));
  const modelFromProvider = provider?.slice("codex/".length);
  return modelFromProvider || runtimeEnv.CODEX_MODEL || "gpt-5.5";
}

export function extractCodexAccessToken(authJson: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(authJson);
  } catch {
    throw new Error("codex_auth_json_invalid_json");
  }
  const accessToken =
    typeof parsed === "object" &&
    parsed !== null &&
    "tokens" in parsed &&
    typeof parsed.tokens === "object" &&
    parsed.tokens !== null &&
    "access_token" in parsed.tokens &&
    typeof parsed.tokens.access_token === "string"
      ? parsed.tokens.access_token
      : "";
  if (!accessToken) {
    throw new Error("codex_access_token_missing");
  }
  return accessToken;
}

function normalizeFullReviewRuntimeEnv(
  runtimeEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (!isSafeFullReviewRuntimeEnvKey(key)) {
      throw new Error(`unsafe_runtime_env_key:${safeEnvKeyLabel(key)}`);
    }
    if (typeof value !== "string") {
      throw new Error(`unsafe_runtime_env_value:${safeEnvKeyLabel(key)}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function isSafeFullReviewRuntimeEnvKey(key: string): boolean {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
    return false;
  }
  if (key === "TARGET_TOKENS_PER_BATCH") {
    return true;
  }
  return !/(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|AUTH_JSON)/.test(key);
}

function safeEnvKeyLabel(key: string): string {
  return /^[A-Z_][A-Z0-9_]{0,80}$/.test(key) ? key : "<invalid-env-key>";
}
