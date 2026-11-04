import {
  createHash,
  createHmac,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import {
  assertCanonicalCodexRotatingProviderId,
  codexRotatingProviderIdSchema,
} from "./provider-mutation-fence";
import { type VersionedProviderSecretNamespace } from "./provider-secret-namespace";
import sodium from "libsodium-wrappers";
import {
  codexRotatingAuthJsonMaxBytes,
  codexRotatingOidcMaxTokenAgeSeconds,
  repoFullNamePattern,
  fullShaPattern,
  base64Pattern,
  base64UrlPattern,
  safeOpaqueIdPattern,
  type CodexRotatingRunState,
  assertSafeActionRef,
  shellQuote,
} from "./codex-contract";

export {
  codexRotatingAuthMode,
  codexRotatingSetupKind,
  codexRotatingRuntimeAuthMode,
  codexRotatingRefreshRuntimeMode,
  codexForkAgenticSandboxRuntimeMode,
  codexRotatingSecretName,
  mimoTokenPlanApiKeySecretName,
  codexRotatingProtocolVersion,
  codexRotatingReviewDraftsVariableName,
  codexRotatingMaxChangedLinesVariableName,
  codexRotatingTimeoutMinutesVariableName,
  CodexRotatingT0WorkflowSchemaVersion,
  codexRotatingWorkflowSchemaVersion,
  codexRotatingCanonicalT0WorkflowSchemaVersions,
  isCertifiedForkCodexWorkflowSchemaVersion,
  isClientTriggeredT0WorkflowSchemaVersion,
  isVersionedSecretNamespaceCodexWorkflowSchemaVersion,
  isTrustedDefaultBranchTriggeredCodexWorkflowSchemaVersion,
  codexRotatingT0DefaultTimeoutMinutesForSchema,
  codexForkAgenticSandboxCertificationVariable,
  codexForkAgenticSandboxCertificationValue,
  codexRotatingAuthJsonMaxBytes,
  codexRotatingDefaultRunner,
  codexRotatingDefaultTimeoutMinutes,
  codexRotatingDefaultRefreshScheduleCron,
  codexRotatingOidcMaxTokenAgeSeconds,
  codexRotatingProviderStateValues,
  type CodexRotatingProviderState,
  codexRotatingRunStateValues,
  type CodexRotatingRunState,
  codexRotatingPermissionIssues,
  type CodexRotatingPermissionIssue,
  createCodexRotatingSalt,
} from "./codex-contract";
export * from "./codex-workflow";

const codexTokensSchema = z
  .object({
    refresh_token: z.string().min(1),
    access_token: z.string().min(1).optional(),
    id_token: z.string().min(1).optional(),
    expiry: z.union([z.string(), z.number()]).optional(),
  })
  .passthrough();

const codexAuthJsonSchema = z
  .object({
    auth_mode: z.literal("chatgpt"),
    tokens: codexTokensSchema,
    last_refresh: z.string().optional(),
  })
  .passthrough();

export type ValidatedCodexAuthJson = z.infer<typeof codexAuthJsonSchema>;

export type CodexStableAccountIdentity = Readonly<{
  issuer: string;
  subject: string;
  chatgptAccountId: string;
}>;

/** Refresh/token lifecycle claims are intentionally excluded. */
export function deriveCodexStableAccountIdentityFromIdToken(
  idToken: string,
): CodexStableAccountIdentity {
  let claims: Record<string, unknown>;
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("jwt_shape");
    claims = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    throw new Error("codex_account_identity_token_invalid");
  }
  const auth =
    claims["https://api.openai.com/auth"] &&
    typeof claims["https://api.openai.com/auth"] === "object"
      ? (claims["https://api.openai.com/auth"] as Record<string, unknown>)
      : {};
  const issuer = requireStableIdentityClaim(claims.iss);
  const subject = requireStableIdentityClaim(claims.sub);
  const accountIds = [
    claims.chatgpt_account_id,
    claims.account_id,
    auth.chatgpt_account_id,
    auth.account_id,
  ].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (new Set(accountIds).size !== 1) {
    throw new Error("codex_account_identity_account_id_invalid");
  }
  return Object.freeze({
    issuer,
    subject,
    chatgptAccountId: accountIds[0]!,
  });
}

function requireStableIdentityClaim(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("codex_account_identity_claim_invalid");
  }
  return value;
}

export type CodexAuthJsonValidationResult = {
  readonly parsed: ValidatedCodexAuthJson;
  readonly byteLength: number;
  readonly exactBytesSha256: string;
  readonly warnings: readonly string[];
};

export function validateCodexAuthJsonBytes(input: {
  readonly authJsonBytes: string;
  readonly maxBytes?: number;
  readonly staleWarningDays?: number;
  readonly now?: Date;
}): CodexAuthJsonValidationResult {
  const maxBytes = input.maxBytes ?? codexRotatingAuthJsonMaxBytes;
  const byteLength = Buffer.byteLength(input.authJsonBytes, "utf8");
  if (byteLength === 0) {
    throw new Error("codex_auth_json_empty");
  }
  if (byteLength > maxBytes) {
    throw new Error("codex_auth_json_too_large");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(input.authJsonBytes);
  } catch {
    throw new Error("codex_auth_json_invalid_json");
  }
  const parsed = codexAuthJsonSchema.parse(parsedJson);
  const warnings = collectCodexAuthJsonWarnings({
    parsed,
    staleWarningDays: input.staleWarningDays ?? 30,
    now: input.now ?? new Date(),
  });

  return {
    parsed,
    byteLength,
    exactBytesSha256: createHash("sha256")
      .update(input.authJsonBytes, "utf8")
      .digest("hex"),
    warnings,
  };
}

export function compactCodexAuthJson(input: {
  readonly authJsonBytes: string;
  readonly maxBytes?: number;
}): {
  readonly compactAuthJsonBytes: string;
  readonly byteLength: number;
} {
  const validation = validateCodexAuthJsonBytes(input);
  const compactAuthJsonBytes = JSON.stringify(validation.parsed);
  const byteLength = Buffer.byteLength(compactAuthJsonBytes, "utf8");
  if (byteLength > (input.maxBytes ?? codexRotatingAuthJsonMaxBytes)) {
    throw new Error("codex_auth_json_too_large_after_compact");
  }
  return { compactAuthJsonBytes, byteLength };
}

export function computeCodexAuthGenerationHash(input: {
  readonly authJsonBytes: string;
  readonly generationHashSalt: string;
}): string {
  const salt = decodeBase64OrBase64Url(input.generationHashSalt);
  if (salt.length < 16) {
    throw new Error("generation_hash_salt_too_short");
  }
  return createHmac("sha256", salt)
    .update(input.authJsonBytes, "utf8")
    .digest("base64url");
}

export const codexRotatingOidcClaimsSchema = z
  .object({
    iss: z.literal("https://token.actions.githubusercontent.com"),
    aud: z.union([z.string(), z.array(z.string())]),
    sub: z.string().min(1).optional(),
    repository: z.string().regex(repoFullNamePattern),
    repository_id: z.string().regex(/^[0-9]+$/),
    repository_owner: z.string().min(1).optional(),
    repository_owner_id: z.string().min(1).optional(),
    repository_visibility: z.enum(["public", "private", "internal"]),
    event_name: z.enum([
      "pull_request",
      "pull_request_target",
      "workflow_dispatch",
      "schedule",
    ]),
    ref: z.string().min(1).optional(),
    run_id: z.string().min(1),
    run_attempt: z.string().min(1),
    workflow_ref: z.string().min(1),
    workflow_sha: z.string().regex(fullShaPattern),
    job_workflow_ref: z.string().min(1).optional(),
    job_workflow_sha: z.string().regex(fullShaPattern).optional(),
    actor: z.string().min(1),
    runner_environment: z.literal("github-hosted"),
    iat: z.number(),
    nbf: z.number(),
    exp: z.number(),
    jti: z.string().min(8),
  })
  .strict();

export type CodexRotatingOidcClaims = z.infer<
  typeof codexRotatingOidcClaimsSchema
>;

export type CodexRotatingProviderBinding = {
  readonly providerInstanceId: string;
  readonly repositoryFullName: string;
  readonly githubRepositoryId: string;
  readonly actionRef: string;
  readonly allowedActionRefs?: readonly string[] | undefined;
  readonly workflowPath: string;
  readonly workflowSchemaVersion: number;
  readonly activeSecretNamespace?: VersionedProviderSecretNamespace;
  readonly activeWorkflowSource?: Readonly<{
    workflowPath: string;
    workflowSourceCommitSha: string;
    workflowSourceBlobSha: string;
    workflowSourceSha256: string;
    workflowSemanticSha256: string;
    sourceTrust: "trusted_default_branch_revision";
    repositoryId: string;
  }>;
  readonly retiringWorkflowSource?: Readonly<{
    workflowPath: string;
    workflowSourceCommitSha: string;
    workflowSourceBlobSha: string;
    workflowSourceSha256: string;
    workflowSemanticSha256: string;
    sourceTrust: "trusted_default_branch_revision";
    repositoryId: string;
    workflowSchemaVersion: 4;
    retireAt: Date;
  }>;
};

export function validateCodexRotatingPrelease(input: {
  readonly claims: CodexRotatingOidcClaims;
  readonly binding: CodexRotatingProviderBinding;
  readonly requestedProviderInstanceId: string;
  readonly requestedWorkflowSchemaVersion: number;
  readonly now?: Date;
  readonly maxTokenAgeSeconds?: number;
}): {
  readonly leaseKey: string;
  readonly runKey: string;
} {
  const claims = codexRotatingOidcClaimsSchema.parse(input.claims);
  assertCanonicalCodexRotatingProviderId({
    providerInstanceId: input.binding.providerInstanceId,
    githubRepositoryId: claims.repository_id,
  });
  assertCanonicalCodexRotatingProviderId({
    providerInstanceId: input.requestedProviderInstanceId,
    githubRepositoryId: claims.repository_id,
  });
  if (claims.repository !== input.binding.repositoryFullName) {
    throw new Error("oidc_repository_mismatch");
  }
  if (claims.repository_id !== input.binding.githubRepositoryId) {
    throw new Error("oidc_repository_id_mismatch");
  }
  if (input.requestedProviderInstanceId !== input.binding.providerInstanceId) {
    throw new Error("provider_instance_mismatch");
  }
  if (
    input.requestedWorkflowSchemaVersion !== input.binding.workflowSchemaVersion
  ) {
    throw new Error("workflow_schema_mismatch");
  }
  const workflowRefSuffix = `/${input.binding.workflowPath}@`;
  if (!claims.workflow_ref.includes(workflowRefSuffix)) {
    throw new Error("workflow_path_mismatch");
  }
  if (/^dependabot(?:-preview)?\[bot\]$/i.test(claims.actor)) {
    throw new Error("dependabot_actor_not_allowed");
  }
  assertSafeActionRef(input.binding.actionRef);
  assertOidcFreshness({
    claims,
    now: input.now ?? new Date(),
    maxTokenAgeSeconds:
      input.maxTokenAgeSeconds ?? codexRotatingOidcMaxTokenAgeSeconds,
  });
  return {
    leaseKey: `${input.binding.providerInstanceId}:${claims.run_id}:${claims.run_attempt}`,
    runKey: `${claims.repository_id}:${claims.run_id}:${claims.run_attempt}`,
  };
}

export type CodexRotatingLeaseStatus =
  | "preleased"
  | "finalized"
  | "completed"
  | "expired"
  | "conflict";

export type CodexRotatingLeaseRecord = {
  readonly leaseId: string;
  readonly providerInstanceId: string;
  readonly runId: string;
  readonly runAttempt: string;
  readonly restoredGenerationHash?: string;
  readonly nextGeneration?: number;
  readonly status: CodexRotatingLeaseStatus;
  readonly expiresAt: Date;
};

export class InMemoryCodexRotatingLeaseStore {
  private readonly records = new Map<string, CodexRotatingLeaseRecord>();

  acquire(input: {
    readonly providerInstanceId: string;
    readonly runId: string;
    readonly runAttempt: string;
    readonly now: Date;
    readonly ttlSeconds: number;
  }): CodexRotatingLeaseRecord {
    codexRotatingProviderIdSchema.parse(input.providerInstanceId);
    const active = [...this.records.values()].find(
      (record) =>
        record.providerInstanceId === input.providerInstanceId &&
        record.status !== "completed" &&
        record.expiresAt > input.now,
    );
    if (active) {
      if (
        active.runId === input.runId &&
        active.runAttempt === input.runAttempt &&
        active.status === "preleased"
      ) {
        return active;
      }
      if (
        active.runId === input.runId &&
        active.runAttempt !== input.runAttempt
      ) {
        this.records.set(active.leaseId, {
          ...active,
          status: "expired",
          expiresAt: input.now,
        });
      } else {
        return { ...active, status: "conflict" };
      }
    }
    const lease: CodexRotatingLeaseRecord = {
      leaseId: `lease:${randomUUID()}`,
      providerInstanceId: input.providerInstanceId,
      runId: input.runId,
      runAttempt: input.runAttempt,
      status: "preleased",
      expiresAt: new Date(input.now.getTime() + input.ttlSeconds * 1000),
    };
    this.records.set(lease.leaseId, lease);
    return lease;
  }

  finalize(input: {
    readonly leaseId: string;
    readonly restoredGenerationHash: string;
    readonly nextGeneration: number;
    readonly now: Date;
  }): CodexRotatingLeaseRecord {
    const current = this.records.get(input.leaseId);
    if (!current || current.expiresAt <= input.now) {
      throw new Error("lease_not_active");
    }
    if (current.status !== "preleased") {
      throw new Error("lease_invalid_state");
    }
    const finalized: CodexRotatingLeaseRecord = {
      ...current,
      status: "finalized",
      restoredGenerationHash: input.restoredGenerationHash,
      nextGeneration: input.nextGeneration,
    };
    this.records.set(finalized.leaseId, finalized);
    return finalized;
  }

  complete(input: {
    readonly leaseId: string;
    readonly now: Date;
  }): CodexRotatingLeaseRecord {
    const current = this.records.get(input.leaseId);
    if (!current || current.expiresAt <= input.now) {
      throw new Error("lease_not_active");
    }
    if (current.status !== "finalized") {
      throw new Error("lease_invalid_state");
    }
    const completed = { ...current, status: "completed" as const };
    this.records.set(completed.leaseId, completed);
    return completed;
  }

  retire(input: {
    readonly leaseId: string;
    readonly now: Date;
  }): CodexRotatingLeaseRecord {
    const current = this.records.get(input.leaseId);
    if (!current || current.status === "completed") {
      throw new Error("lease_not_active");
    }
    const retired = {
      ...current,
      status: "expired" as const,
      expiresAt: input.now,
    };
    this.records.set(retired.leaseId, retired);
    return retired;
  }
}

export const codexRotatingEncryptedWritebackSchema = z
  .object({
    protocolVersion: z.literal(1),
    leaseId: z.string().regex(safeOpaqueIdPattern),
    providerInstanceId: codexRotatingProviderIdSchema,
    generation: z.number().int().positive(),
    latestGenerationHash: z.string().min(32).max(128),
    accountIdentityHash: z.string().min(32).max(128),
    accountIdentityAlgorithm: z.literal("provider_issuer_subject_account_v1"),
    encryptedValue: z
      .string()
      .regex(base64Pattern)
      .max(96 * 1024),
    keyId: z.string().min(1).max(256),
    idempotencyKey: z.string().regex(safeOpaqueIdPattern),
  })
  .strict();

export type CodexRotatingEncryptedWritebackRequest = z.infer<
  typeof codexRotatingEncryptedWritebackSchema
>;

export async function encryptCodexRotatingAuthForGitHubSecret(input: {
  readonly authJsonBytes: string;
  readonly githubPublicKeyBase64: string;
  readonly githubKeyId: string;
  readonly generationHashSalt: string;
}): Promise<{
  readonly compactAuthJsonBytes: string;
  readonly compactByteLength: number;
  readonly latestGenerationHash: string;
  readonly encryptedValue: string;
  readonly keyId: string;
}> {
  const compact = compactCodexAuthJson({
    authJsonBytes: input.authJsonBytes,
    maxBytes: codexRotatingAuthJsonMaxBytes,
  });
  await sodium.ready;
  const publicKey = Buffer.from(input.githubPublicKeyBase64, "base64");
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error("github_secret_public_key_invalid");
  }

  const encrypted = sodium.crypto_box_seal(
    compact.compactAuthJsonBytes,
    publicKey,
  );
  return {
    compactAuthJsonBytes: compact.compactAuthJsonBytes,
    compactByteLength: compact.byteLength,
    latestGenerationHash: computeCodexAuthGenerationHash({
      authJsonBytes: compact.compactAuthJsonBytes,
      generationHashSalt: input.generationHashSalt,
    }),
    encryptedValue: Buffer.from(encrypted).toString("base64"),
    keyId: input.githubKeyId,
  };
}

export async function encryptApiKeyForGitHubSecret(input: {
  readonly apiKey: string;
  readonly githubPublicKeyBase64: string;
  readonly githubKeyId: string;
}): Promise<{ readonly encryptedValue: string; readonly keyId: string }> {
  await sodium.ready;
  const publicKey = Buffer.from(input.githubPublicKeyBase64, "base64");
  if (publicKey.length !== sodium.crypto_box_PUBLICKEYBYTES) {
    throw new Error("github_secret_public_key_invalid");
  }
  const encrypted = sodium.crypto_box_seal(
    Buffer.from(input.apiKey, "utf8"),
    publicKey,
  );
  return {
    encryptedValue: Buffer.from(encrypted).toString("base64"),
    keyId: input.githubKeyId,
  };
}

export function parseCodexRotatingEncryptedWritebackRequest(
  input: unknown,
): CodexRotatingEncryptedWritebackRequest {
  const request = codexRotatingEncryptedWritebackSchema.parse(input);
  if (looksLikePlaintextAuthJson(request.encryptedValue)) {
    throw new Error("writeback_plaintext_auth_rejected");
  }
  return request;
}

/**
 * Stable, salted identity of the subscription account. This deliberately
 * excludes refresh/access tokens and binds all three provider identifiers so
 * a subject or account switch cannot be mistaken for an ordinary refresh.
 */
export function computeCodexRotatingAccountIdentityHash(input: {
  readonly authJsonBytes: string;
  readonly accountFingerprintSalt: string;
}): string {
  const auth = JSON.parse(input.authJsonBytes) as {
    readonly tokens?: { readonly id_token?: unknown };
  };
  const idToken = auth.tokens?.id_token;
  if (typeof idToken !== "string") {
    throw new Error("codex_account_identity_id_token_required");
  }
  const identity = deriveCodexStableAccountIdentityFromIdToken(idToken);
  const salt = Buffer.from(input.accountFingerprintSalt, "base64url");
  if (salt.length < 16) {
    throw new Error("codex_account_identity_salt_invalid");
  }
  return createHmac("sha256", salt)
    .update(
      JSON.stringify({
        issuer: identity.issuer,
        subject: identity.subject,
        chatgptAccountId: identity.chatgptAccountId,
      }),
      "utf8",
    )
    .digest("base64url");
}

export function computeEncryptedPayloadDigest(input: {
  readonly encryptedValue: string;
  readonly hmacKey: string;
}): string {
  const key = decodeBase64OrUtf8(input.hmacKey);
  return createHmac("sha256", key)
    .update(input.encryptedValue, "utf8")
    .digest("base64url");
}

export function classifyCodexRuntimeFailure(
  message: string,
): CodexRotatingRunState {
  const normalized = message.toLowerCase();
  if (isCodexQuotaOrRateLimitFailure(normalized)) {
    return "quota_limited";
  }
  if (
    normalized.includes("unauthorized") ||
    normalized.includes("authentication_failed") ||
    normalized.includes("invalid_grant") ||
    normalized.includes("refresh token") ||
    normalized.includes("login required")
  ) {
    return "needs_reconnect";
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("forbidden") ||
    normalized.includes("resource not accessible")
  ) {
    return "permission_required";
  }
  return "unknown_auth_state";
}

function isCodexQuotaOrRateLimitFailure(normalizedMessage: string): boolean {
  return (
    /\b(?:429|too many requests|rate[_ -]?limit(?:ed| exceeded)?|rate_limit_exceeded)\b/.test(
      normalizedMessage,
    ) ||
    /\b(?:rate[_ -]?limits?|not enough retry quota|usage[_ -]?limit(?: reached| exceeded)?|limit reached)\b/.test(
      normalizedMessage,
    ) ||
    /\b(?:insufficient_quota|quota_exceeded|exceeded (?:your )?(?:current )?quota|quota (?:limit|exceeded))\b/.test(
      normalizedMessage,
    ) ||
    /\byou(?:'|’)ve hit your usage limit\b/.test(normalizedMessage) ||
    /\b(?:purchase|buy|add|get) more credits\b/.test(normalizedMessage) ||
    /\bout of credits\b/.test(normalizedMessage) ||
    /\b(?:billing_hard_limit|payment required|billing (?:limit|quota|hard limit|not active|required))\b/.test(
      normalizedMessage,
    )
  );
}

export function pruneCodexRotatingChildEnv(
  env: Readonly<Record<string, string | undefined>>,
): Record<string, string> {
  const allowed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (shouldDropChildEnvKey(key)) continue;
    allowed[key] = value;
  }
  return allowed;
}

export function buildCodexRefreshBootstrapPlan(input: {
  readonly codexBinaryPath: string;
  readonly tempHome: string;
  readonly tempCodexHome: string;
  readonly emptyWorkingDirectory: string;
  readonly authJsonPath: string;
}): {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
} {
  return {
    command: input.codexBinaryPath,
    args: ["exec", "--skip-git-repo-check", "--", "Respond with OK only."],
    cwd: input.emptyWorkingDirectory,
    env: {
      HOME: input.tempHome,
      CODEX_HOME: input.tempCodexHome,
      REVIEWROUTER_CODEX_AUTH_PATH: input.authJsonPath,
    },
  };
}

export function buildSafeCheckoutPlan(input: {
  readonly repositoryFullName: string;
  readonly headSha: string;
  readonly workspacePath: string;
}): {
  readonly commands: readonly string[];
} {
  if (!repoFullNamePattern.test(input.repositoryFullName)) {
    throw new Error("invalid_repository_full_name");
  }
  if (!fullShaPattern.test(input.headSha)) {
    throw new Error("invalid_head_sha");
  }
  const repoUrl = `https://github.com/${input.repositoryFullName}.git`;
  return {
    commands: [
      "git init .",
      "git config --local gc.auto 0",
      "git config --local core.hooksPath /dev/null",
      "git config --local advice.detachedHead false",
      `git remote add origin ${shellQuote(repoUrl)}`,
      `git -c protocol.file.allow=never -c protocol.ext.allow=never fetch --no-tags --no-recurse-submodules --depth=1 origin ${input.headSha}`,
      `git -c protocol.file.allow=never -c protocol.ext.allow=never checkout --detach ${input.headSha}`,
    ],
  };
}

function collectCodexAuthJsonWarnings(input: {
  readonly parsed: ValidatedCodexAuthJson;
  readonly staleWarningDays: number;
  readonly now: Date;
}): readonly string[] {
  const warnings: string[] = [];
  if (!input.parsed.last_refresh) {
    warnings.push("last_refresh_missing");
    return warnings;
  }
  const refreshedAt = Date.parse(input.parsed.last_refresh);
  if (!Number.isFinite(refreshedAt)) {
    warnings.push("last_refresh_unparseable");
    return warnings;
  }
  const ageDays = (input.now.getTime() - refreshedAt) / 86_400_000;
  if (ageDays > input.staleWarningDays) {
    warnings.push("last_refresh_stale");
  }
  return warnings;
}

function assertOidcFreshness(input: {
  readonly claims: CodexRotatingOidcClaims;
  readonly now: Date;
  readonly maxTokenAgeSeconds: number;
}): void {
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  if (input.claims.nbf > nowSeconds + 30) {
    throw new Error("oidc_token_not_yet_valid");
  }
  if (input.claims.exp <= nowSeconds) {
    throw new Error("oidc_token_expired");
  }
  if (input.claims.exp - input.claims.nbf > input.maxTokenAgeSeconds + 60) {
    throw new Error("oidc_token_lifetime_too_long");
  }
  if (nowSeconds - input.claims.iat > input.maxTokenAgeSeconds) {
    throw new Error("oidc_token_too_old");
  }
}

function shouldDropChildEnvKey(key: string): boolean {
  const normalizedKey = key.toUpperCase();
  return (
    key === "GITHUB_TOKEN" ||
    key === "GH_TOKEN" ||
    key === "ACTIONS_ID_TOKEN_REQUEST_URL" ||
    key === "ACTIONS_ID_TOKEN_REQUEST_TOKEN" ||
    key === "GITHUB_ENV" ||
    key === "GITHUB_OUTPUT" ||
    key === "GITHUB_PATH" ||
    key === "GITHUB_STEP_SUMMARY" ||
    key === "GITHUB_STATE" ||
    key === "NODE_OPTIONS" ||
    key === "BASH_ENV" ||
    key === "ENV" ||
    key.startsWith("GIT_") ||
    key.startsWith("INPUT_") ||
    normalizedKey.includes("CODEX_AUTH_JSON") ||
    normalizedKey.includes("REVIEWROUTER_CODEX_AUTH_JSON") ||
    normalizedKey.includes("REVIEW_ROUTER_COMMENT_TOKEN") ||
    normalizedKey.includes("REVIEWROUTER_PROXY_NONCE") ||
    /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|AUTH_JSON)/.test(normalizedKey)
  );
}

function looksLikePlaintextAuthJson(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.startsWith("{") ||
    trimmed.includes("refresh_token") ||
    trimmed.includes("access_token") ||
    trimmed.includes("auth_mode")
  );
}

function decodeBase64OrBase64Url(value: string): Buffer {
  if (base64UrlPattern.test(value)) {
    return Buffer.from(value, "base64url");
  }
  if (base64Pattern.test(value)) {
    return Buffer.from(value, "base64");
  }
  throw new Error("invalid_base64_value");
}

function decodeBase64OrUtf8(value: string): Buffer {
  try {
    return decodeBase64OrBase64Url(value);
  } catch {
    return Buffer.from(value, "utf8");
  }
}

