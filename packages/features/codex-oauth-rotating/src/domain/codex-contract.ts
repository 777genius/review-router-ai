/** Shared Codex Action and workflow contract; no OAuth/session or host dependencies. */
import { randomBytes } from "node:crypto";
import {
  defaultReviewJobTimeoutMinutes,
  defaultReviewT0LifecycleTimeoutMinutes,
} from "./review-execution-budget";
import { legacyCodexRotatingSecretName } from "./provider-secret-namespace";

export const codexRotatingAuthMode = "codex_subscription_oauth_rotating";
export const codexRotatingSetupKind = "codex_oauth_rotating";
export const codexRotatingRuntimeAuthMode = "codex-oauth-rotating";
export const codexRotatingRefreshRuntimeMode = "codex-oauth-refresh";
export const codexForkAgenticSandboxRuntimeMode = "fork-agentic-sandbox";
export const codexRotatingSecretName = legacyCodexRotatingSecretName;
export const mimoTokenPlanApiKeySecretName = "MIMO_TOKEN_PLAN_API_KEY";
export const codexRotatingProtocolVersion = 2 as const;
export const codexRotatingReviewDraftsVariableName =
  "REVIEW_ROUTER_REVIEW_DRAFTS";
export const codexRotatingMaxChangedLinesVariableName =
  "REVIEW_ROUTER_MAX_CHANGED_LINES";
export const codexRotatingTimeoutMinutesVariableName =
  "REVIEW_ROUTER_TIMEOUT_MINUTES";
export enum CodexRotatingT0WorkflowSchemaVersion {
  DurableDispatchV1 = 1,
  ClientTriggeredV2 = 2,
  ClientTriggeredLifecycleV3 = 3,
  VersionedSecretNamespaceV4 = 4,
  VersionedSecretNamespaceV5 = 5,
  /** Reserved contract; no certified external-fork renderer is available yet. */
  CertifiedForkReviewV6 = 6,
}

export const codexRotatingWorkflowSchemaVersion =
  CodexRotatingT0WorkflowSchemaVersion.DurableDispatchV1;
// Only implemented canonical workflows may enter provisioning/attestation.
export const codexRotatingCanonicalT0WorkflowSchemaVersions = [
  CodexRotatingT0WorkflowSchemaVersion.DurableDispatchV1,
  CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
  CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3,
  CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4,
  CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5,
] as const;

/** Contract recognition does not authorize rendering or provisioning. */
export function isCertifiedForkCodexWorkflowSchemaVersion(
  value: number | null | undefined,
): value is CodexRotatingT0WorkflowSchemaVersion.CertifiedForkReviewV6 {
  return value === CodexRotatingT0WorkflowSchemaVersion.CertifiedForkReviewV6;
}

export function isClientTriggeredT0WorkflowSchemaVersion(
  value: number | null | undefined,
): value is
  | CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2
  | CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3
  | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4
  | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5 {
  return (
    value === CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2 ||
    value === CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3 ||
    value === CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4 ||
    value === CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5
  );
}

export function isVersionedSecretNamespaceCodexWorkflowSchemaVersion(
  value: number | null | undefined,
): value is
  | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4
  | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5 {
  return (
    value === CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4 ||
    value === CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5
  );
}

export function isTrustedDefaultBranchTriggeredCodexWorkflowSchemaVersion(
  value: number | null | undefined,
): value is
  | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4
  | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5 {
  return isVersionedSecretNamespaceCodexWorkflowSchemaVersion(value);
}

export function codexRotatingT0DefaultTimeoutMinutesForSchema(
  value: CodexRotatingT0WorkflowSchemaVersion,
): number {
  return value ===
    CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3
    ? defaultReviewT0LifecycleTimeoutMinutes
    : defaultReviewJobTimeoutMinutes;
}
export const codexForkAgenticSandboxCertificationVariable =
  "REVIEW_ROUTER_FORK_AGENTIC_SANDBOX";
export const codexForkAgenticSandboxCertificationValue = "certified";
export const codexRotatingAuthJsonMaxBytes = 32 * 1024;
export const codexRotatingDefaultRunner = "ubuntu-24.04";
export const codexRotatingDefaultTimeoutMinutes =
  defaultReviewJobTimeoutMinutes;
export const codexRotatingDefaultRefreshScheduleCron = "17 */6 * * *";
export const codexRotatingOidcMaxTokenAgeSeconds = 10 * 60;

export const codexRotatingLegacySchemaOneTimeoutMinutes = new Set([
  30,
  codexRotatingDefaultTimeoutMinutes,
]);

export const repoFullNamePattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const sha256HexPattern = /^[a-f0-9]{64}$/i;
export const fullShaPattern = /^[a-f0-9]{40}$/i;
export const base64Pattern = /^[A-Za-z0-9+/]+={0,2}$/;
export const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
export const safeOpaqueIdPattern = /^[A-Za-z0-9_.:-]{8,160}$/;
export const safeVersionPattern = /^[A-Za-z0-9_.@/-]{1,120}$/;

export const codexRotatingProviderStateValues = [
  "setup_pending",
  "active",
  "permission_required",
  "workflow_update_required",
  "quota_limited",
  "needs_reconnect",
  "stale_queued_secret",
  "skipped_retryable",
  "policy_blocked",
  "unknown_auth_state",
] as const;

export type CodexRotatingProviderState =
  (typeof codexRotatingProviderStateValues)[number];

export const codexRotatingRunStateValues = [
  "prelease_acquired",
  "lease_finalized",
  "refresh_bootstrapped",
  "writeback_pending",
  "writeback_confirmed",
  "checkout_ready",
  "comment_posted",
  "permission_required",
  "needs_reconnect",
  "stale_queued_secret",
  "quota_limited",
  "skipped_retryable",
  "policy_blocked",
  "unknown_auth_state",
  "security_invariant_failed",
] as const;

export type CodexRotatingRunState =
  (typeof codexRotatingRunStateValues)[number];

export const codexRotatingPermissionIssues = [
  "missing_secrets_read",
  "missing_secrets_write",
  "missing_contents_read",
  "missing_pull_requests_read",
  "missing_pull_requests_write",
  "missing_issues_write",
  "repository_not_selected",
] as const;

export type CodexRotatingPermissionIssue =
  (typeof codexRotatingPermissionIssues)[number];

export function createCodexRotatingSalt(): string {
  return randomBytes(32).toString("base64url");
}

export function assertSafeActionRef(actionRef: string): void {
  if (!isSafeActionRef(actionRef)) {
    throw new Error("codex_rotating_action_ref_invalid");
  }
}

export function isSafeActionRef(actionRef: string): boolean {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+@[A-Za-z0-9_./-]{1,120}$/.test(
    actionRef,
  );
}

export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@?=&%-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

