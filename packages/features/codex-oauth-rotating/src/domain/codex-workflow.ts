/** Workflow render/scan/attestation policy, independent of OAuth secrets and leases. */
import {
  createHash,
  randomUUID,
} from "node:crypto";
import { z } from "zod";
import { parseDocument } from "yaml";
import { isLoopbackHostname } from "@reviewrouter/shared";
import {
  codexRuntimeMigrationBindingSchema,
  type CodexRuntimeMigrationBinding,
} from "./runtime-migration";
import {
  canonicalCodexRotatingProviderId,
  codexRotatingProviderIdSchema,
} from "./provider-mutation-fence";
import { createReviewExecutionBudget } from "./review-execution-budget";
import {
  ProviderSecretNamespaceMode,
  parseVersionedProviderSecretName,
  serializeVersionedProviderSecretNamespaceMetadata,
  type VersionedProviderSecretNamespace,
} from "./provider-secret-namespace";
import {
  codexRotatingAuthMode,
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
  codexRotatingDefaultRunner,
  codexRotatingDefaultTimeoutMinutes,
  codexRotatingDefaultRefreshScheduleCron,
  codexRotatingLegacySchemaOneTimeoutMinutes,
  repoFullNamePattern,
  sha256HexPattern,
  base64UrlPattern,
  safeOpaqueIdPattern,
  safeVersionPattern,
  createCodexRotatingSalt,
  assertSafeActionRef,
  isSafeActionRef,
  shellQuote,
} from "./codex-contract";

export const codexRotatingSetupManifestSchema = z
  .object({
    protocolVersion: z.literal(codexRotatingProtocolVersion),
    repositoryFullName: z.string().regex(repoFullNamePattern),
    repositoryId: z.string().regex(/^[0-9]+$/),
    repositoryIdentityVersion: z.number().int().positive(),
    providerInstanceId: z.string().regex(safeOpaqueIdPattern),
    setupNonce: z.string().regex(safeOpaqueIdPattern),
    authMode: z.literal(codexRotatingAuthMode),
    generatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    installer: z
      .object({
        url: z.string().url(),
        version: z.string().regex(safeVersionPattern),
        sha256: z.string().regex(sha256HexPattern),
      })
      .strict(),
    generationHashSalt: z.string().regex(base64UrlPattern),
    accountFingerprintSalt: z.string().regex(base64UrlPattern),
    runtimeMigration: codexRuntimeMigrationBindingSchema.optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      !codexRotatingProviderIdSchema.safeParse(manifest.providerInstanceId)
        .success ||
      manifest.providerInstanceId !==
        canonicalCodexRotatingProviderId(manifest.repositoryId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerInstanceId"],
        message: "protocol v2 requires canonical provider identity",
      });
    }
  });

export type CodexRotatingSetupManifest = z.infer<
  typeof codexRotatingSetupManifestSchema
>;

export function buildCodexRotatingSetupManifest(input: {
  readonly repositoryFullName: string;
  readonly repositoryId: string;
  readonly repositoryIdentityVersion: number;
  readonly providerInstanceId?: string;
  readonly setupNonce?: string;
  readonly installerUrl: string;
  readonly installerVersion: string;
  readonly installerSha256: string;
  readonly now?: Date;
  readonly ttlSeconds?: number;
  readonly generationHashSalt?: string;
  readonly accountFingerprintSalt?: string;
  readonly runtimeMigration?: CodexRuntimeMigrationBinding;
}): CodexRotatingSetupManifest {
  const now = input.now ?? new Date();
  const ttlSeconds = input.ttlSeconds ?? 15 * 60;
  const manifest = {
    protocolVersion: codexRotatingProtocolVersion,
    repositoryFullName: input.repositoryFullName,
    repositoryId: input.repositoryId,
    repositoryIdentityVersion: input.repositoryIdentityVersion,
    providerInstanceId:
      input.providerInstanceId ??
      canonicalCodexRotatingProviderId(input.repositoryId),
    setupNonce: input.setupNonce ?? `stp:${randomUUID()}`,
    authMode: codexRotatingAuthMode,
    generatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlSeconds * 1000).toISOString(),
    installer: {
      url: input.installerUrl,
      version: input.installerVersion,
      sha256: input.installerSha256,
    },
    generationHashSalt: input.generationHashSalt ?? createCodexRotatingSalt(),
    accountFingerprintSalt:
      input.accountFingerprintSalt ?? createCodexRotatingSalt(),
    ...(input.runtimeMigration
      ? { runtimeMigration: input.runtimeMigration }
      : {}),
  } satisfies CodexRotatingSetupManifest;

  return codexRotatingSetupManifestSchema.parse(manifest);
}

export function encodeCodexRotatingSetupManifest(
  manifest: CodexRotatingSetupManifest,
): string {
  return Buffer.from(
    JSON.stringify(codexRotatingSetupManifestSchema.parse(manifest)),
  ).toString("base64url");
}

export function decodeCodexRotatingSetupManifest(
  encoded: string,
): CodexRotatingSetupManifest {
  if (!base64UrlPattern.test(encoded)) {
    throw new Error("setup_manifest_invalid_encoding");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("setup_manifest_invalid_json");
  }
  return codexRotatingSetupManifestSchema.parse(decoded);
}

export function assertCodexRotatingSetupManifestUsable(input: {
  readonly manifest: CodexRotatingSetupManifest;
  readonly expectedRepositoryFullName: string;
  readonly expectedInstallerUrl: string;
  readonly expectedInstallerVersion: string;
  readonly expectedInstallerSha256: string;
  readonly now?: Date;
}): void {
  if (input.manifest.repositoryFullName !== input.expectedRepositoryFullName) {
    throw new Error("setup_manifest_repository_mismatch");
  }
  if (
    input.manifest.installer.url !== input.expectedInstallerUrl ||
    input.manifest.installer.version !== input.expectedInstallerVersion ||
    input.manifest.installer.sha256.toLowerCase() !==
      input.expectedInstallerSha256.toLowerCase()
  ) {
    throw new Error("setup_manifest_installer_tuple_mismatch");
  }
  const expiresAt = Date.parse(input.manifest.expiresAt);
  if (!Number.isFinite(expiresAt)) {
    throw new Error("setup_manifest_invalid_expiry");
  }
  if (expiresAt <= (input.now ?? new Date()).getTime()) {
    throw new Error("setup_manifest_expired");
  }
}

export function renderCodexRotatingInstallerCommand(input: {
  readonly manifest: CodexRotatingSetupManifest;
  readonly manifestBase64?: string;
  readonly setupManifestUrl?: string;
  readonly setupPrepareUrl?: string;
  readonly setupDispatchUrl?: string;
  readonly setupDispatchOutcomeUrl?: string;
  readonly setupStatusUrl?: string;
  readonly installerArguments?: readonly CodexRotatingInstallerArgument[];
}): string {
  const manifestBase64 =
    input.manifestBase64 ?? encodeCodexRotatingSetupManifest(input.manifest);
  const installerUrl = shellQuote(input.manifest.installer.url);
  const installerVersion = shellQuote(input.manifest.installer.version);
  const installerSha256 = shellQuote(input.manifest.installer.sha256);
  const manifest = shellQuote(manifestBase64);
  const setupNonce = shellQuote(input.manifest.setupNonce);
  const providerInstanceId = shellQuote(input.manifest.providerInstanceId);
  const repositoryFullName = shellQuote(input.manifest.repositoryFullName);
  const setupManifestUrl = input.setupManifestUrl
    ? shellQuote(input.setupManifestUrl)
    : null;
  const setupPrepareUrl = input.setupPrepareUrl
    ? shellQuote(input.setupPrepareUrl)
    : null;
  const setupDispatchUrl = input.setupDispatchUrl
    ? shellQuote(input.setupDispatchUrl)
    : null;
  const setupDispatchOutcomeUrl = input.setupDispatchOutcomeUrl
    ? shellQuote(input.setupDispatchOutcomeUrl)
    : null;
  const setupStatusUrl = input.setupStatusUrl
    ? shellQuote(input.setupStatusUrl)
    : null;

  const envLines = [
    `REVIEW_ROUTER_INSTALLER_URL=${installerUrl} \\`,
    `REVIEW_ROUTER_INSTALLER_VERSION=${installerVersion} \\`,
    `REVIEW_ROUTER_INSTALLER_SHA256=${installerSha256} \\`,
    `REVIEW_ROUTER_REPO=${repositoryFullName} \\`,
    `REVIEW_ROUTER_CODEX_ROTATING_PROVIDER_INSTANCE_ID=${providerInstanceId} \\`,
    ...(setupManifestUrl
      ? [
          `REVIEW_ROUTER_CODEX_ROTATING_SETUP_URL=${setupManifestUrl} \\`,
          ...(setupPrepareUrl
            ? [
                `REVIEW_ROUTER_CODEX_ROTATING_SETUP_PREPARE_URL=${setupPrepareUrl} \\`,
              ]
            : []),
          ...(setupDispatchUrl
            ? [
                `REVIEW_ROUTER_CODEX_ROTATING_SETUP_DISPATCH_URL=${setupDispatchUrl} \\`,
              ]
            : []),
          ...(setupDispatchOutcomeUrl
            ? [
                `REVIEW_ROUTER_CODEX_ROTATING_SETUP_DISPATCH_OUTCOME_URL=${setupDispatchOutcomeUrl} \\`,
              ]
            : []),
          ...(setupStatusUrl
            ? [
                `REVIEW_ROUTER_CODEX_ROTATING_SETUP_STATUS_URL=${setupStatusUrl} \\`,
              ]
            : []),
          `REVIEW_ROUTER_CODEX_ROTATING_SETUP_NONCE=${setupNonce} \\`,
        ]
      : [`REVIEW_ROUTER_CODEX_ROTATING_SETUP_MANIFEST_B64=${manifest} \\`]),
  ];

  return [
    "bash <<'REVIEW_ROUTER_INSTALL'",
    "set -euo pipefail",
    'tmp="$(mktemp)"',
    "trap 'rm -f \"$tmp\"' EXIT",
    `curl -q --fail --silent --show-error --max-redirs 0 --connect-timeout 10 --max-time 30 --retry 0 ${installerUrl} -o "$tmp"`,
    `expected_sha256=${installerSha256}`,
    "if command -v shasum >/dev/null 2>&1; then",
    "  actual_sha256=\"$(shasum -a 256 \"$tmp\" | sed 's/[[:space:]].*$//' | tr '[:upper:]' '[:lower:]')\"",
    "elif command -v sha256sum >/dev/null 2>&1; then",
    "  actual_sha256=\"$(sha256sum \"$tmp\" | sed 's/[[:space:]].*$//' | tr '[:upper:]' '[:lower:]')\"",
    "else",
    '  echo "Missing required checksum command: shasum or sha256sum" >&2',
    "  exit 1",
    "fi",
    'if [ "$actual_sha256" != "$expected_sha256" ]; then',
    '  echo "Installer SHA256 mismatch. Reopen the ReviewRouter dashboard and copy a fresh command." >&2',
    "  exit 1",
    "fi",
    ...envLines,
    ['bash "$tmp" --confirm-write', ...(input.installerArguments ?? [])].join(
      " ",
    ),
    "REVIEW_ROUTER_INSTALL",
  ].join("\n");
}

export type CodexRotatingInstallerArgument =
  | "--force-reseed"
  | "--reuse-existing-auth-i-know-it-is-current";

export type CodexRotatingWorkflowOptions = {
  readonly actionRef: string;
  readonly apiUrl: string;
  readonly providerInstanceId: string;
  readonly claudeCodeOAuthTokenSecret?: boolean;
  readonly openRouterApiKeySecret?: boolean;
  readonly mimoTokenPlanApiKeySecret?: boolean;
  readonly forkAgenticSandboxEnabled?: boolean;
  readonly runnerLabel?: string;
  readonly timeoutMinutes?: number;
  readonly workflowSchemaVersion?: number;
  readonly refreshScheduleCron?: string | null;
  readonly reviewActionV2Mode?: CodexRotatingReviewActionV2Mode;
  readonly activeSecretNamespace?: VersionedProviderSecretNamespace;
};

export enum CodexRotatingReviewActionV2Mode {
  Disabled = "disabled",
  T0 = "t0",
}

export function renderCodexRotatingAdvisoryWorkflow(
  options: CodexRotatingWorkflowOptions,
): string {
  assertSafeActionRef(options.actionRef);
  const runnerLabel = options.runnerLabel ?? codexRotatingDefaultRunner;
  const timeoutMinutes = createReviewExecutionBudget(
    options.timeoutMinutes ?? codexRotatingDefaultTimeoutMinutes,
  ).jobTimeoutMinutes;
  const reviewJobTimeout =
    options.timeoutMinutes === undefined
      ? `\${{ fromJSON(vars.${codexRotatingTimeoutMinutesVariableName} || '${timeoutMinutes}') }}`
      : String(timeoutMinutes);
  const reviewActionTimeout =
    options.timeoutMinutes === undefined
      ? `\${{ vars.${codexRotatingTimeoutMinutesVariableName} || '${timeoutMinutes}' }}`
      : JSON.stringify(String(timeoutMinutes));
  const schemaVersion =
    options.workflowSchemaVersion ?? codexRotatingWorkflowSchemaVersion;
  if (isCertifiedForkCodexWorkflowSchemaVersion(schemaVersion)) {
    throw new Error("codex_rotating_t0_workflow_schema_unsupported");
  }
  if (
    options.activeSecretNamespace &&
    options.activeSecretNamespace.mode !==
      ProviderSecretNamespaceMode.VersionedNeverReused
  ) {
    throw new Error("codex_rotating_versioned_secret_namespace_required");
  }
  if (
    options.activeSecretNamespace &&
    !isVersionedSecretNamespaceCodexWorkflowSchemaVersion(schemaVersion)
  ) {
    throw new Error(
      "codex_rotating_versioned_secret_namespace_schema_required",
    );
  }
  if (
    isVersionedSecretNamespaceCodexWorkflowSchemaVersion(schemaVersion) &&
    !options.activeSecretNamespace
  ) {
    throw new Error("codex_rotating_active_secret_namespace_required");
  }
  const refreshScheduleCron =
    options.refreshScheduleCron === null
      ? null
      : (options.refreshScheduleCron ??
        codexRotatingDefaultRefreshScheduleCron);
  const concurrencyGroup = renderCodexRotatingConcurrencyGroup(
    options.providerInstanceId,
  );
  const providerSecretInputs = [
    options.claudeCodeOAuthTokenSecret === true
      ? "          claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n"
      : "",
    options.openRouterApiKeySecret === true
      ? "          openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}\n"
      : "",
    options.mimoTokenPlanApiKeySecret === true
      ? `          mimo-token-plan-api-key: \${{ secrets.${mimoTokenPlanApiKeySecretName} }}\n`
      : "",
  ].join("");
  const reviewActionV2Mode =
    options.reviewActionV2Mode ?? CodexRotatingReviewActionV2Mode.Disabled;
  if (
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0 &&
    options.forkAgenticSandboxEnabled === true
  ) {
    throw new Error("codex_rotating_t0_fork_sandbox_not_supported");
  }
  if (
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0 &&
    isVersionedSecretNamespaceCodexWorkflowSchemaVersion(schemaVersion)
  ) {
    const renderVersionedWorkflow =
      schemaVersion ===
      CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4
        ? renderCanonicalCodexRotatingT0WorkflowV4
        : renderCanonicalCodexRotatingT0WorkflowV5;
    return renderVersionedWorkflow({
      actionRef: options.actionRef,
      apiUrl: options.apiUrl,
      providerInstanceId: options.providerInstanceId,
      refreshScheduleCron,
      claudeCodeOAuthTokenSecret: options.claudeCodeOAuthTokenSecret === true,
      openRouterApiKeySecret: options.openRouterApiKeySecret === true,
      activeSecretNamespace: options.activeSecretNamespace!,
    });
  }
  if (
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0 &&
    schemaVersion === CodexRotatingT0WorkflowSchemaVersion.DurableDispatchV1
  ) {
    return renderCanonicalCodexRotatingT0WorkflowV1({
      actionRef: options.actionRef,
      apiUrl: options.apiUrl,
      providerInstanceId: options.providerInstanceId,
      refreshScheduleCron,
      claudeCodeOAuthTokenSecret: options.claudeCodeOAuthTokenSecret === true,
      openRouterApiKeySecret: options.openRouterApiKeySecret === true,
    });
  }
  if (
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0 &&
    schemaVersion === CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2
  ) {
    return renderCanonicalCodexRotatingT0WorkflowV2({
      actionRef: options.actionRef,
      apiUrl: options.apiUrl,
      providerInstanceId: options.providerInstanceId,
      refreshScheduleCron,
      claudeCodeOAuthTokenSecret: options.claudeCodeOAuthTokenSecret === true,
      openRouterApiKeySecret: options.openRouterApiKeySecret === true,
    });
  }
  if (
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0 &&
    schemaVersion ===
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3
  ) {
    return renderCanonicalCodexRotatingT0WorkflowV3({
      actionRef: options.actionRef,
      apiUrl: options.apiUrl,
      providerInstanceId: options.providerInstanceId,
      refreshScheduleCron,
      claudeCodeOAuthTokenSecret: options.claudeCodeOAuthTokenSecret === true,
      openRouterApiKeySecret: options.openRouterApiKeySecret === true,
    });
  }
  assertSupportedT0WorkflowSchema(reviewActionV2Mode, schemaVersion);
  const reviewJob =
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0
      ? renderCodexRotatingT0ReviewJob({
          actionRef: options.actionRef,
          apiUrl: options.apiUrl,
          providerInstanceId: options.providerInstanceId,
          workflowSchemaVersion: schemaVersion,
          reviewJobTimeout,
          claudeCodeOAuthTokenSecret:
            options.claudeCodeOAuthTokenSecret === true,
          openRouterApiKeySecret: options.openRouterApiKeySecret === true,
        })
      : `  codex-review:
    name: codex-review
    runs-on: ${runnerLabel}
    timeout-minutes: ${reviewJobTimeout}
    concurrency:
      group: ${concurrencyGroup}
      cancel-in-progress: false
    if: \${{ ((github.event_name == 'pull_request' && github.event.pull_request.draft == false) || (github.event_name == 'pull_request_target' && github.event.pull_request.draft == true && vars.${codexRotatingReviewDraftsVariableName} == 'true')) && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.type != 'Bot' }}
    permissions:
      id-token: write
    steps:
      - name: ReviewRouter Codex OAuth review
        id: run_codex
        uses: ${options.actionRef}
        with:
          mode: codex-oauth-rotating
          api-url: ${JSON.stringify(options.apiUrl)}
          provider-instance-id: ${JSON.stringify(options.providerInstanceId)}
          workflow-schema-version: "${schemaVersion}"
          review-drafts: \${{ vars.${codexRotatingReviewDraftsVariableName} == 'true' }}
          max-changed-lines: \${{ vars.${codexRotatingMaxChangedLinesVariableName} }}
          review-timeout-minutes: ${reviewActionTimeout}
          auth-json: \${{ secrets.${codexRotatingSecretName} }}
${providerSecretInputs}`;
  const triggers =
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0
      ? `  workflow_dispatch:
    inputs:
      review_request_id:
        description: Durable ReviewRouter request identity
        required: false
        type: string
      pr_number:
        description: Pull request number selected by ReviewRouter
        required: false
        type: string
      review_head_sha:
        description: Expected pull request head selected by ReviewRouter
        required: false
        type: string${
          refreshScheduleCron
            ? `
  schedule:
    - cron: ${JSON.stringify(refreshScheduleCron)}`
            : ""
        }`
      : `  pull_request:
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]
  pull_request_target:
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]${
      refreshScheduleCron
        ? `
  workflow_dispatch:
  schedule:
    - cron: ${JSON.stringify(refreshScheduleCron)}`
        : ""
    }`;
  const runName =
    reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0
      ? `run-name: \${{ inputs.review_request_id != '' && format('ReviewRouter review {0}', inputs.review_request_id) || 'ReviewRouter Codex OAuth maintenance' }}

`
      : "";
  return `name: ReviewRouter Codex OAuth

${runName}on:
${triggers}

permissions: {}

jobs:
${reviewJob}${
    options.forkAgenticSandboxEnabled === true
      ? `

  fork-sandbox-review:
    name: fork-sandbox-review
    runs-on: ${runnerLabel}
    timeout-minutes: ${reviewJobTimeout}
    concurrency:
      group: ${concurrencyGroup}
      cancel-in-progress: false
    if: \${{ github.event_name == 'pull_request_target' && github.event.pull_request.draft == false && github.event.pull_request.head.repo.full_name != github.repository && vars.${codexForkAgenticSandboxCertificationVariable} == '${codexForkAgenticSandboxCertificationValue}' }}
    permissions:
      contents: read
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - name: Checkout fork pull request head
        uses: actions/checkout@v6
        with:
          repository: \${{ github.event.pull_request.head.repo.full_name }}
          ref: \${{ github.event.pull_request.head.sha }}
          path: safe-workspace
          persist-credentials: false
          fetch-depth: 0

      - name: Verify fork sandbox checkout
        shell: bash
        run: |
          set -euo pipefail
          if [ "\${{ github.event.pull_request.head.repo.full_name }}" = "\${{ github.repository }}" ]; then
            echo "::error::ReviewRouter fork sandbox is only for fork pull requests."
            exit 1
          fi
          if [ "\${{ vars.${codexForkAgenticSandboxCertificationVariable} }}" != "${codexForkAgenticSandboxCertificationValue}" ]; then
            echo "::error::ReviewRouter fork sandbox requires ${codexForkAgenticSandboxCertificationVariable}=${codexForkAgenticSandboxCertificationValue}."
            exit 1
          fi
          case "\${{ github.event.pull_request.head.sha }}" in
            ""|*[!0-9a-fA-F]*)
              echo "::error::ReviewRouter fork sandbox requires an exact pull request head SHA."
              exit 1
              ;;
          esac
          if git -C safe-workspace config --local --get-regexp 'http\\..*\\.extraheader|credential\\.helper|url\\..*\\.insteadOf' >/tmp/reviewrouter-unsafe-git-config 2>/dev/null; then
            cat /tmp/reviewrouter-unsafe-git-config
            echo "::error::ReviewRouter fork sandbox checkout persisted credentials."
            exit 1
          fi
          if find safe-workspace -type l -print -quit | grep -q .; then
            echo "::error::ReviewRouter fork sandbox does not support symlinks yet."
            exit 1
          fi

      - name: ReviewRouter fork sandbox review
        id: run_fork_sandbox
        uses: ${options.actionRef}
        with:
          mode: ${codexForkAgenticSandboxRuntimeMode}
          api-url: ${JSON.stringify(options.apiUrl)}
          provider-instance-id: ${JSON.stringify(options.providerInstanceId)}
          workflow-schema-version: "${schemaVersion}"
          review-timeout-minutes: ${reviewActionTimeout}
          auth-json: \${{ secrets.${codexRotatingSecretName} }}
${providerSecretInputs}        env:
          REVIEW_ROUTER_PR_WORKSPACE: \${{ github.workspace }}/safe-workspace
          REVIEW_THREAD_LIFECYCLE_RESOLVE_TOKEN: \${{ secrets.REVIEW_THREAD_LIFECYCLE_RESOLVE_TOKEN }}
`
      : ""
  }${
    refreshScheduleCron
      ? `
  codex-refresh:
    name: codex-refresh
    runs-on: ${runnerLabel}
    timeout-minutes: ${timeoutMinutes}
    concurrency:
      group: ${concurrencyGroup}
      cancel-in-progress: false
    if: \${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && ${reviewActionV2Mode === CodexRotatingReviewActionV2Mode.T0 ? "inputs.review_request_id == ''" : "true"}) }}
    permissions:
      id-token: write
    steps:
      - name: ReviewRouter Codex OAuth refresh
        id: refresh_codex
        uses: ${options.actionRef}
        with:
          mode: ${codexRotatingRefreshRuntimeMode}
          api-url: ${JSON.stringify(options.apiUrl)}
          provider-instance-id: ${JSON.stringify(options.providerInstanceId)}
          workflow-schema-version: "${schemaVersion}"
          auth-json: \${{ secrets.${codexRotatingSecretName} }}
`
      : ""
  }`;
}

function renderCodexRotatingT0ReviewJob(input: {
  readonly actionRef: string;
  readonly apiUrl: string;
  readonly providerInstanceId: string;
  readonly workflowSchemaVersion: number;
  readonly reviewJobTimeout: string;
  readonly claudeCodeOAuthTokenSecret: boolean;
  readonly openRouterApiKeySecret: boolean;
}): string {
  const release = parseImmutableActionRelease(input.actionRef);
  const reusableWorkflowRef = `${release.repository}/.github/workflows/reviewrouter-t0-reusable.yml@${release.commitSha}`;
  return `  codex-review:
    name: codex-review
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.review_request_id != '' && inputs.pr_number != '' && inputs.review_head_sha != '' }}
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: ${reusableWorkflowRef}
    with:
      runtime_ref: ${JSON.stringify(release.commitSha)}
      api_url: ${JSON.stringify(input.apiUrl)}
      runtime_config_mode: oidc
      pr_number: \${{ inputs.pr_number }}
      review_head_sha: \${{ inputs.review_head_sha }}
      provider_instance_id: ${JSON.stringify(input.providerInstanceId)}
      workflow_schema_version: ${input.workflowSchemaVersion}
      max_changed_lines: \${{ vars.${codexRotatingMaxChangedLinesVariableName} }}
      review_timeout_minutes: ${input.reviewJobTimeout}
    secrets:
      CODEX_AUTH_JSON: \${{ secrets.${codexRotatingSecretName} }}
${input.claudeCodeOAuthTokenSecret ? "      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n" : ""}${input.openRouterApiKeySecret ? "      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}\n" : ""}`;
}

function parseImmutableActionRelease(actionRef: string): {
  readonly repository: string;
  readonly commitSha: string;
} {
  const match = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)@([a-fA-F0-9]{40})$/.exec(
    actionRef,
  );
  if (!match) {
    throw new Error("codex_rotating_t0_action_ref_must_be_full_sha");
  }
  return {
    repository: match[1]!,
    commitSha: match[2]!.toLowerCase(),
  };
}

function assertSupportedT0WorkflowSchema(
  mode: CodexRotatingReviewActionV2Mode,
  schemaVersion: number,
): void {
  if (
    mode === CodexRotatingReviewActionV2Mode.T0 &&
    !codexRotatingCanonicalT0WorkflowSchemaVersions.includes(
      schemaVersion as (typeof codexRotatingCanonicalT0WorkflowSchemaVersions)[number],
    )
  ) {
    throw new Error("codex_rotating_t0_workflow_schema_unsupported");
  }
}

function renderCodexRotatingConcurrencyGroup(
  providerInstanceId: string,
): string {
  const providerSegment =
    providerInstanceId
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "provider";
  return `reviewrouter-codex-oauth-\${{ github.repository_id }}-${providerSegment}`;
}

export type CodexRotatingWorkflowScanResult = {
  readonly valid: boolean;
  readonly errors: readonly string[];
};

type CodexWorkflowSourceIdentity = {
  readonly actionRef: string;
  readonly apiUrl: string;
  readonly providerInstanceId: string;
};

export type AccountGatewayWorkflowSourceMetadata =
  CodexWorkflowSourceIdentity & {
    readonly workflowSchemaVersion: CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2;
    readonly codexSessionMode: "account-gateway";
    readonly runtimeConfigMode: "oidc";
    readonly runtimeRef: string;
    readonly secretNamespace?: never;
  };

export type CodexRotatingWorkflowSourceMetadata =
  | AccountGatewayWorkflowSourceMetadata
  | (CodexWorkflowSourceIdentity & {
      readonly workflowSchemaVersion: number;
      readonly codexSessionMode?: never;
      readonly secretNamespace?: VersionedProviderSecretNamespace;
    });

function scanCodexForkAgenticSandboxMarkers(
  workflow: string,
): readonly string[] {
  const errors: string[] = [];
  const requiredMarkers = [
    "pull_request_target:",
    "fork-sandbox-review:",
    `vars.${codexForkAgenticSandboxCertificationVariable} == '${codexForkAgenticSandboxCertificationValue}'`,
    "github.event.pull_request.head.repo.full_name != github.repository",
    "repository: ${{ github.event.pull_request.head.repo.full_name }}",
    "ref: ${{ github.event.pull_request.head.sha }}",
    "path: safe-workspace",
    "persist-credentials: false",
    "fetch-depth: 0",
    "Verify fork sandbox checkout",
    "git -C safe-workspace config --local --get-regexp",
    "find safe-workspace -type l -print -quit",
    `mode: ${codexForkAgenticSandboxRuntimeMode}`,
    "REVIEW_ROUTER_PR_WORKSPACE: ${{ github.workspace }}/safe-workspace",
  ];
  for (const marker of requiredMarkers) {
    if (!workflow.includes(marker)) {
      errors.push(`fork_marker_missing:${marker}`);
    }
  }
  return errors;
}

type WorkflowPermissionEntry = {
  readonly name: string;
  readonly value: string;
};

type ParsedWorkflowPermissions =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "entries";
      readonly entries: readonly WorkflowPermissionEntry[];
    };

type ExtractedCodexRotatingWorkflowSourceMetadata = ReturnType<
  typeof extractCodexRotatingWorkflowSourceMetadata
>;

function isLegacySchemaOneWorkflowUsingActionDefaults(input: {
  readonly workflow: string;
  readonly reviewJob: string;
  readonly source: ExtractedCodexRotatingWorkflowSourceMetadata;
}): boolean {
  const legacyTriggerTypes =
    "types: [opened, synchronize, reopened, ready_for_review]";
  const legacyTriggerCount = input.workflow
    .split("\n")
    .filter((line) => line.trim() === legacyTriggerTypes).length;
  const fixedJobTimeout = input.reviewJob.match(
    /^ {4}timeout-minutes:\s*["']?(\d+)["']?\s*$/m,
  )?.[1];
  return (
    input.source.workflowSchemaVersion === 1 &&
    legacyTriggerCount >= 1 &&
    legacyTriggerCount <= 2 &&
    !input.workflow.includes("converted_to_draft") &&
    !input.reviewJob.includes(
      `max-changed-lines: \${{ vars.${codexRotatingMaxChangedLinesVariableName} }}`,
    ) &&
    !input.reviewJob.includes("review-timeout-minutes:") &&
    !input.reviewJob.includes(codexRotatingMaxChangedLinesVariableName) &&
    !input.reviewJob.includes(codexRotatingTimeoutMinutesVariableName) &&
    fixedJobTimeout !== undefined &&
    codexRotatingLegacySchemaOneTimeoutMinutes.has(Number(fixedJobTimeout))
  );
}

function workflowJobUsesExpectedConcurrency(input: {
  readonly job: string;
  readonly expectedGroup: string | undefined;
}): boolean {
  if (!input.expectedGroup) {
    return false;
  }
  const groupValues = [...input.job.matchAll(/^ {6}group:\s*(.+?)\s*$/gm)].map(
    (match) => match[1],
  );
  const cancelValues = [
    ...input.job.matchAll(/^ {6}cancel-in-progress:\s*(\S+)\s*$/gm),
  ].map((match) => match[1]);
  const queueValues = [
    ...input.job.matchAll(/^ {6}queue:\s*([^\s#]+)\s*$/gm),
  ].map((match) => match[1]);
  return (
    groupValues.length === 1 &&
    groupValues[0] === input.expectedGroup &&
    cancelValues.length === 1 &&
    cancelValues[0] === "false" &&
    (queueValues.length === 0 ||
      (queueValues.length === 1 &&
        (queueValues[0] === "single" || queueValues[0] === "max")))
  );
}

export function scanCodexRotatingAdvisoryWorkflow(
  workflow: string,
): CodexRotatingWorkflowScanResult {
  try {
    if (readAccountGatewayMetadataIfPresent(workflow)) {
      return { valid: true, errors: [] };
    }
  } catch (error) {
    return {
      valid: false,
      errors: [
        error instanceof Error
          ? error.message
          : "account_gateway_workflow_invalid",
      ],
    };
  }
  if (
    /^ {4}uses:\s*[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/\.github\/workflows\/reviewrouter(?:-t0)?-reusable\.yml@/m.test(
      workflow,
    )
  ) {
    return scanCodexRotatingT0AdvisoryWorkflow(workflow);
  }
  const errors: string[] = [];
  const forkSandboxEnabled = workflow.includes(
    `mode: ${codexForkAgenticSandboxRuntimeMode}`,
  );
  const refreshEnabled = workflow.includes(
    `mode: ${codexRotatingRefreshRuntimeMode}`,
  );
  const secretMatches = workflow.match(
    new RegExp(codexRotatingSecretName, "g"),
  );
  const expectedRotatingSecretReferences =
    1 + (forkSandboxEnabled ? 1 : 0) + (refreshEnabled ? 1 : 0);
  if ((secretMatches?.length ?? 0) !== expectedRotatingSecretReferences) {
    errors.push("rotating_secret_reference_count_invalid");
  }
  if (
    !workflow.includes(`auth-json: \${{ secrets.${codexRotatingSecretName} }}`)
  ) {
    errors.push("rotating_secret_must_be_literal_auth_json_input");
  }
  const secretReferences = [...workflow.matchAll(/\bsecrets\.([A-Z0-9_]+)\b/g)]
    .map((match) => match[1]!)
    .filter((secretName, index, all) => all.indexOf(secretName) === index);
  const allowedSecretReferences = new Set([
    codexRotatingSecretName,
    "CLAUDE_CODE_OAUTH_TOKEN",
    "OPENROUTER_API_KEY",
    mimoTokenPlanApiKeySecretName,
    "REVIEW_THREAD_LIFECYCLE_RESOLVE_TOKEN",
  ]);
  for (const secretName of secretReferences) {
    if (!allowedSecretReferences.has(secretName)) {
      errors.push(`unknown_secret_reference:${secretName}`);
    }
  }
  if (/\bsecrets\s*\[/.test(workflow) || /\bsecrets\s*\*/.test(workflow)) {
    errors.push("dynamic_secret_reference_not_allowed");
  }
  if (
    workflow.includes("CLAUDE_CODE_OAUTH_TOKEN") &&
    !workflow.includes(
      "claude-code-oauth-token: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}",
    )
  ) {
    errors.push("claude_secret_must_be_literal_input");
  }
  if (
    workflow.includes("OPENROUTER_API_KEY") &&
    !workflow.includes("openrouter-api-key: ${{ secrets.OPENROUTER_API_KEY }}")
  ) {
    errors.push("openrouter_secret_must_be_literal_input");
  }
  if (
    workflow.includes("mimo-token-plan-api-key:") &&
    !workflow.includes(
      `mimo-token-plan-api-key: \${{ secrets.${mimoTokenPlanApiKeySecretName} }}`,
    )
  ) {
    errors.push("mimo_secret_must_be_literal_input");
  }
  for (const [pattern, code] of [
    [/\bmerge_group\s*:/, "merge_group_not_allowed"],
    [/^\s*strategy\s*:/m, "matrix_strategy_not_allowed"],
    [/^\s*container\s*:/m, "job_container_not_allowed"],
    [/^\s*services\s*:/m, "job_services_not_allowed"],
    [/^concurrency\s*:/m, "workflow_concurrency_not_allowed"],
    [/^ {4}uses:\s*/m, "reusable_job_not_allowed"],
    [/ubuntu-latest/i, "mutable_runner_label_not_allowed"],
    [/toJSON\s*\(\s*secrets\s*\)/, "tojson_secrets_not_allowed"],
    [
      /(^|[^A-Z0-9_])CODEX_AUTH_JSON([^A-Z0-9_]|$)/,
      "legacy_codex_auth_secret_not_allowed",
    ],
  ] as const) {
    if (pattern.test(workflow)) {
      errors.push(code);
    }
  }
  const hasRefreshTrigger =
    /\bworkflow_dispatch\s*:/.test(workflow) || /\bschedule\s*:/.test(workflow);
  if (hasRefreshTrigger && !refreshEnabled) {
    errors.push("refresh_job_required_for_manual_or_schedule_trigger");
  }
  if (refreshEnabled) {
    if (!/\bworkflow_dispatch\s*:/.test(workflow)) {
      errors.push("refresh_workflow_dispatch_required");
    }
    if (!/\bschedule\s*:/.test(workflow)) {
      errors.push("refresh_schedule_required");
    }
  }
  const source = extractCodexRotatingWorkflowSourceMetadata(workflow);
  const reviewJob = extractWorkflowJobSection(workflow, "codex-review") ?? "";
  const legacySchemaOneWorkflow = isLegacySchemaOneWorkflowUsingActionDefaults({
    workflow,
    reviewJob,
    source,
  });
  const expectedConcurrencyGroup = source.providerInstanceId
    ? renderCodexRotatingConcurrencyGroup(source.providerInstanceId)
    : undefined;
  if (
    !workflowJobUsesExpectedConcurrency({
      job: reviewJob,
      expectedGroup: expectedConcurrencyGroup,
    })
  ) {
    errors.push("review_job_provider_concurrency_required");
  }
  if (
    forkSandboxEnabled &&
    !workflowJobUsesExpectedConcurrency({
      job: extractWorkflowJobSection(workflow, "fork-sandbox-review") ?? "",
      expectedGroup: expectedConcurrencyGroup,
    })
  ) {
    errors.push("fork_job_provider_concurrency_required");
  }
  if (
    refreshEnabled &&
    !workflowJobUsesExpectedConcurrency({
      job: extractWorkflowJobSection(workflow, "codex-refresh") ?? "",
      expectedGroup: expectedConcurrencyGroup,
    })
  ) {
    errors.push("refresh_job_provider_concurrency_required");
  }
  if (!reviewJob.includes("github.event.pull_request.draft == false")) {
    errors.push("review_job_draft_guard_required");
  }
  if (
    reviewJob.includes(`vars.${codexRotatingReviewDraftsVariableName}`) &&
    !reviewJob.includes(
      `review-drafts: \${{ vars.${codexRotatingReviewDraftsVariableName} == 'true' }}`,
    )
  ) {
    errors.push("review_job_draft_input_required");
  }
  if (
    !legacySchemaOneWorkflow &&
    !reviewJob.includes(
      `max-changed-lines: \${{ vars.${codexRotatingMaxChangedLinesVariableName} }}`,
    )
  ) {
    errors.push("review_job_max_changed_lines_input_required");
  }
  if (
    !legacySchemaOneWorkflow &&
    !reviewJob.includes("review-timeout-minutes:")
  ) {
    errors.push("review_job_timeout_input_required");
  }
  if (
    reviewJob.includes(`vars.${codexRotatingTimeoutMinutesVariableName}`) &&
    !reviewJob.includes(
      `review-timeout-minutes: \${{ vars.${codexRotatingTimeoutMinutesVariableName} || '${codexRotatingDefaultTimeoutMinutes}' }}`,
    )
  ) {
    errors.push("review_job_timeout_variable_mismatch");
  }
  const fixedJobTimeout = reviewJob.match(
    /^ {4}timeout-minutes:\s*["']?(\d+)["']?$/m,
  )?.[1];
  const fixedActionTimeout = reviewJob.match(
    /^ {10}review-timeout-minutes:\s*["']?(\d+)["']?$/m,
  )?.[1];
  if (
    !legacySchemaOneWorkflow &&
    (fixedJobTimeout || fixedActionTimeout) &&
    fixedJobTimeout !== fixedActionTimeout
  ) {
    errors.push("review_job_timeout_value_mismatch");
  }
  if (
    reviewJob.includes(`vars.${codexRotatingTimeoutMinutesVariableName}`) &&
    !reviewJob.includes(
      `timeout-minutes: \${{ fromJSON(vars.${codexRotatingTimeoutMinutesVariableName} || '${codexRotatingDefaultTimeoutMinutes}') }}`,
    )
  ) {
    errors.push("review_job_timeout_variable_mismatch");
  }
  if (!forkSandboxEnabled) {
    for (const [pattern, code] of [
      [/\buses:\s*actions\/checkout@/i, "actions_checkout_not_allowed"],
      [/\brun:\s*[|>]?/i, "raw_run_step_not_allowed"],
    ] as const) {
      if (pattern.test(workflow)) {
        errors.push(code);
      }
    }
    if (/^\s*env\s*:/m.test(workflow)) {
      errors.push("workflow_env_not_allowed");
    }
  } else {
    errors.push(...scanCodexForkAgenticSandboxMarkers(workflow));
  }
  const actionRefs = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map(
    (match) => match[1]!,
  );
  const actionRef = actionRefs[0];
  const expectedActionStepCount =
    1 + (forkSandboxEnabled ? 2 : 0) + (refreshEnabled ? 1 : 0);
  if (actionRefs.length !== expectedActionStepCount) {
    errors.push("exactly_one_action_step_required");
  }
  if (!actionRef || !actionRefs.every(isSafeActionRef)) {
    errors.push("action_ref_invalid");
  }
  if (forkSandboxEnabled) {
    const checkoutRefs = actionRefs.filter(
      (ref) => ref.toLowerCase() === "actions/checkout@v6",
    );
    const reviewActionRefs = actionRefs.filter(
      (ref) => ref.toLowerCase() !== "actions/checkout@v6",
    );
    if (checkoutRefs.length !== 1) {
      errors.push("fork_checkout_action_ref_invalid");
    }
    if (
      reviewActionRefs.length !== (refreshEnabled ? 3 : 2) ||
      !reviewActionRefs.every((ref) => ref === reviewActionRefs[0])
    ) {
      errors.push("fork_review_action_refs_invalid");
    }
    if ((workflow.match(/^\s*run:\s*[|>]?/gm)?.length ?? 0) !== 1) {
      errors.push("fork_raw_run_step_count_invalid");
    }
    if ((workflow.match(/^\s*env\s*:/gm)?.length ?? 0) !== 1) {
      errors.push("fork_env_block_count_invalid");
    }
  }
  if (!source.providerInstanceId) {
    errors.push("provider_instance_id_required");
  }
  if (source.workflowSchemaVersion !== codexRotatingWorkflowSchemaVersion) {
    errors.push("workflow_schema_version_mismatch");
  }
  if (source.mode !== codexRotatingRuntimeAuthMode) {
    errors.push("rotating_mode_required");
  }
  const workflowPermissions = parseWorkflowPermissions(workflow, 0);
  const reviewJobPermissions = parseWorkflowPermissions(
    extractWorkflowJobSection(workflow, "codex-review") ?? "",
    4,
  );
  if (
    !(
      permissionsAreEmpty(workflowPermissions) ||
      permissionsExactly(workflowPermissions, [
        { name: "id-token", value: "write" },
      ])
    )
  ) {
    errors.push("workflow_permissions_must_grant_id_token_only");
  }
  if (
    !permissionsExactly(reviewJobPermissions, [
      { name: "id-token", value: "write" },
    ])
  ) {
    errors.push("review_job_requires_id_token_write");
  }
  if (forkSandboxEnabled) {
    const forkJobPermissions = parseWorkflowPermissions(
      extractWorkflowJobSection(workflow, "fork-sandbox-review") ?? "",
      4,
    );
    if (
      !permissionsExactly(forkJobPermissions, [
        { name: "contents", value: "read" },
        { name: "pull-requests", value: "write" },
        { name: "issues", value: "write" },
        { name: "id-token", value: "write" },
      ])
    ) {
      errors.push("fork_job_permissions_invalid");
    }
  }
  if (refreshEnabled) {
    const refreshJobPermissions = parseWorkflowPermissions(
      extractWorkflowJobSection(workflow, "codex-refresh") ?? "",
      4,
    );
    if (
      !permissionsExactly(refreshJobPermissions, [
        { name: "id-token", value: "write" },
      ])
    ) {
      errors.push("refresh_job_requires_id_token_write");
    }
  }
  return { valid: errors.length === 0, errors };
}

function scanCodexRotatingT0AdvisoryWorkflow(
  workflow: string,
): CodexRotatingWorkflowScanResult {
  const errors: string[] = [];
  const source = extractCodexRotatingWorkflowSourceMetadata(workflow);
  const reviewJob = extractWorkflowJobSection(workflow, "codex-review") ?? "";
  const refreshJob = extractWorkflowJobSection(workflow, "codex-refresh") ?? "";
  const refreshEnabled = refreshJob.length > 0;
  const reviewWith = parseWorkflowFlatMapping(reviewJob, "with", 4);
  const reviewSecrets = parseWorkflowFlatMapping(reviewJob, "secrets", 4);
  const clientTriggered = isClientTriggeredT0WorkflowSchemaVersion(
    source.workflowSchemaVersion,
  );
  const trustedDefaultBranchTriggered =
    isTrustedDefaultBranchTriggeredCodexWorkflowSchemaVersion(
      source.workflowSchemaVersion,
    );
  const versionedSecretName = workflow.match(
    /^name: ReviewRouter Codex OAuth \[namespace=[^;\]]+;epoch=[^;\]]+;secret=([A-Za-z0-9_]+)\]$/m,
  )?.[1];
  const expectedSecretName =
    isVersionedSecretNamespaceCodexWorkflowSchemaVersion(
      source.workflowSchemaVersion,
    )
      ? versionedSecretName
      : codexRotatingSecretName;
  if (!expectedSecretName) {
    errors.push("t0_versioned_secret_namespace_metadata_missing");
  } else if (
    isVersionedSecretNamespaceCodexWorkflowSchemaVersion(
      source.workflowSchemaVersion,
    )
  ) {
    try {
      parseVersionedProviderSecretName(expectedSecretName);
    } catch {
      errors.push("t0_versioned_secret_namespace_invalid");
    }
  }
  const expectedConcurrencyGroup = source.providerInstanceId
    ? renderCodexRotatingConcurrencyGroup(source.providerInstanceId)
    : undefined;

  if (
    !workflowJobIdsExactly(
      workflow,
      refreshEnabled ? ["codex-review", "codex-refresh"] : ["codex-review"],
    )
  ) {
    errors.push("t0_job_inventory_invalid");
  }
  if (
    !workflowMappingHasExactNames(reviewWith, [
      "runtime_ref",
      "api_url",
      "runtime_config_mode",
      "pr_number",
      "review_head_sha",
      "provider_instance_id",
      "workflow_schema_version",
      "max_changed_lines",
      "review_timeout_minutes",
    ])
  ) {
    errors.push("t0_review_with_invalid");
  }
  if (
    !workflowMappingHasAllowedNames(reviewSecrets, {
      required: ["CODEX_AUTH_JSON"],
      allowed: [
        "CODEX_AUTH_JSON",
        "CLAUDE_CODE_OAUTH_TOKEN",
        "OPENROUTER_API_KEY",
      ],
    })
  ) {
    errors.push("t0_review_secrets_invalid");
  }

  let release:
    | { readonly repository: string; readonly commitSha: string }
    | undefined;
  if (source.actionRef) {
    try {
      release = parseImmutableActionRelease(source.actionRef);
    } catch {
      errors.push("t0_action_ref_must_be_full_sha");
    }
  } else {
    errors.push("action_ref_invalid");
  }
  if (!source.providerInstanceId) {
    errors.push("provider_instance_id_required");
  }
  if (!source.apiUrl || !isSafeWorkflowApiUrl(source.apiUrl)) {
    errors.push("api_url_invalid");
  }
  if (
    !codexRotatingCanonicalT0WorkflowSchemaVersions.includes(
      source.workflowSchemaVersion as (typeof codexRotatingCanonicalT0WorkflowSchemaVersions)[number],
    )
  ) {
    errors.push("workflow_schema_version_mismatch");
  }
  if (source.mode !== CodexRotatingReviewActionV2Mode.T0) {
    errors.push("review_action_v2_t0_mode_required");
  }
  if (clientTriggered) {
    if (
      !workflowJobUsesExpectedConcurrency({
        job: reviewJob,
        expectedGroup: expectedConcurrencyGroup,
      })
    ) {
      errors.push("t0_review_provider_concurrency_required");
    }
    if (
      !reviewJob.includes(
        `github.event_name == '${trustedDefaultBranchTriggered ? "pull_request_target" : "pull_request"}'`,
      ) ||
      !reviewJob.includes(
        "github.event.pull_request.head.repo.full_name == github.repository",
      ) ||
      !reviewJob.includes("github.event.pull_request.user.type != 'Bot'") ||
      !reviewJob.includes(
        `vars.${codexRotatingReviewDraftsVariableName} == 'true'`,
      ) ||
      !reviewJob.includes(
        "pr_number: ${{ format('{0}', github.event.pull_request.number) }}",
      ) ||
      !reviewJob.includes(
        "review_head_sha: ${{ github.event.pull_request.head.sha }}",
      )
    ) {
      errors.push("t0_review_client_trigger_binding_required");
    }
    const expectedTrigger = trustedDefaultBranchTriggered
      ? "pull_request_target"
      : "pull_request";
    const forbiddenTrigger = trustedDefaultBranchTriggered
      ? "pull_request"
      : "pull_request_target";
    if (
      !new RegExp(`^ {2}${expectedTrigger}:`, "m").test(workflow) ||
      new RegExp(`^ {2}(?:workflow_dispatch|${forbiddenTrigger}):`, "m").test(
        workflow,
      ) ||
      !workflow.includes(
        "run-name: ${{ format('ReviewRouter review PR {0} at {1}'",
      )
    ) {
      errors.push(
        trustedDefaultBranchTriggered
          ? "t0_pull_request_target_ingress_required"
          : "t0_pull_request_ingress_required",
      );
    }
  } else {
    if (/^ {4}concurrency:/m.test(reviewJob)) {
      errors.push("t0_review_github_concurrency_forbidden");
    }
    if (
      !reviewJob.includes("github.event_name == 'workflow_dispatch'") ||
      !reviewJob.includes("inputs.review_request_id != ''") ||
      !reviewJob.includes("inputs.pr_number != ''") ||
      !reviewJob.includes("inputs.review_head_sha != ''") ||
      !reviewJob.includes("pr_number: ${{ inputs.pr_number }}") ||
      !reviewJob.includes("review_head_sha: ${{ inputs.review_head_sha }}")
    ) {
      errors.push("t0_review_durable_dispatch_required");
    }
    if (
      !workflow.includes("review_request_id:") ||
      !workflow.includes("review_head_sha:") ||
      !workflow.includes("run-name: ${{ inputs.review_request_id") ||
      /^ {2}pull_request(?:_target)?:/m.test(workflow)
    ) {
      errors.push("t0_workflow_dispatch_ingress_required");
    }
  }
  if (
    !reviewJob.includes(
      `max_changed_lines: \${{ vars.${codexRotatingMaxChangedLinesVariableName} }}`,
    )
  ) {
    errors.push("review_job_max_changed_lines_input_required");
  }
  if (!reviewJob.includes("review_timeout_minutes:")) {
    errors.push("review_job_timeout_input_required");
  }
  if (
    !reviewJob.includes(
      `CODEX_AUTH_JSON: \${{ secrets.${expectedSecretName ?? "INVALID"} }}`,
    )
  ) {
    errors.push("rotating_secret_must_be_literal_auth_json_input");
  }
  if (release) {
    const expectedReusableRef = `${release.repository}/.github/workflows/reviewrouter-t0-reusable.yml@${release.commitSha}`;
    if (!reviewJob.includes(`uses: ${expectedReusableRef}`)) {
      errors.push("t0_reusable_workflow_ref_mismatch");
    }
    if (
      !reviewJob.includes(`runtime_ref: ${JSON.stringify(release.commitSha)}`)
    ) {
      errors.push("t0_runtime_ref_mismatch");
    }
  }
  if (
    workflowMappingValue(reviewWith, "api_url") !==
      (source.apiUrl ? JSON.stringify(source.apiUrl) : undefined) ||
    workflowMappingValue(reviewWith, "runtime_config_mode") !== "oidc" ||
    workflowMappingValue(reviewWith, "pr_number") !==
      (clientTriggered
        ? "${{ format('{0}', github.event.pull_request.number) }}"
        : "${{ inputs.pr_number }}") ||
    workflowMappingValue(reviewWith, "review_head_sha") !==
      (clientTriggered
        ? "${{ github.event.pull_request.head.sha }}"
        : "${{ inputs.review_head_sha }}") ||
    workflowMappingValue(reviewWith, "provider_instance_id") !==
      (source.providerInstanceId
        ? JSON.stringify(source.providerInstanceId)
        : undefined) ||
    workflowMappingValue(reviewWith, "workflow_schema_version") !==
      String(source.workflowSchemaVersion)
  ) {
    errors.push("t0_review_binding_invalid");
  }
  if (
    workflowMappingValue(reviewSecrets, "CODEX_AUTH_JSON") !==
      `\${{ secrets.${expectedSecretName ?? "INVALID"} }}` ||
    (workflowMappingValue(reviewSecrets, "CLAUDE_CODE_OAUTH_TOKEN") !==
      undefined &&
      workflowMappingValue(reviewSecrets, "CLAUDE_CODE_OAUTH_TOKEN") !==
        "${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}") ||
    (workflowMappingValue(reviewSecrets, "OPENROUTER_API_KEY") !== undefined &&
      workflowMappingValue(reviewSecrets, "OPENROUTER_API_KEY") !==
        "${{ secrets.OPENROUTER_API_KEY }}")
  ) {
    errors.push("t0_review_secret_binding_invalid");
  }
  for (const marker of [
    "runtime_config_mode: oidc",
    "provider_instance_id:",
    "workflow_schema_version:",
  ]) {
    if (!reviewJob.includes(marker)) {
      errors.push(`t0_marker_missing:${marker}`);
    }
  }
  for (const [pattern, code] of [
    [/^ {4}runs-on:/m, "t0_review_runner_not_allowed"],
    [/^ {4}timeout-minutes:/m, "t0_review_job_timeout_not_allowed"],
    [/^ {4}steps:/m, "t0_review_steps_not_allowed"],
    [/^\s*run:\s*[|>]?/m, "raw_run_step_not_allowed"],
    [/^\s*env\s*:/m, "workflow_env_not_allowed"],
    [/^\s*strategy\s*:/m, "matrix_strategy_not_allowed"],
    [/^concurrency\s*:/m, "workflow_concurrency_not_allowed"],
  ] as const) {
    if (pattern.test(reviewJob)) {
      errors.push(code);
    }
  }
  const workflowPermissions = parseWorkflowPermissions(workflow, 0);
  if (!permissionsAreEmpty(workflowPermissions)) {
    errors.push("workflow_permissions_must_be_empty");
  }
  const reviewJobPermissions = parseWorkflowPermissions(reviewJob, 4);
  if (
    !permissionsExactly(reviewJobPermissions, [
      { name: "contents", value: "read" },
      { name: "pull-requests", value: "read" },
      { name: "id-token", value: "write" },
    ])
  ) {
    errors.push("t0_review_job_permissions_invalid");
  }
  if (refreshEnabled) {
    if (
      !workflowJobUsesExpectedConcurrency({
        job: refreshJob,
        expectedGroup: expectedConcurrencyGroup,
      })
    ) {
      errors.push("refresh_job_provider_concurrency_required");
    }
    if (
      !permissionsExactly(parseWorkflowPermissions(refreshJob, 4), [
        { name: "id-token", value: "write" },
      ])
    ) {
      errors.push("refresh_job_requires_id_token_write");
    }
    if (release && !refreshJob.includes(`uses: ${source.actionRef}`)) {
      errors.push("refresh_action_ref_mismatch");
    }
    for (const marker of [
      `api-url: ${JSON.stringify(source.apiUrl)}`,
      `provider-instance-id: ${JSON.stringify(source.providerInstanceId)}`,
      `workflow-schema-version: ${JSON.stringify(
        String(source.workflowSchemaVersion),
      )}`,
      `auth-json: \${{ secrets.${expectedSecretName ?? "INVALID"} }}`,
    ]) {
      if (!refreshJob.includes(marker)) {
        errors.push(`refresh_binding_missing:${marker}`);
      }
    }
  }
  const usesRefs = [...workflow.matchAll(/^\s*uses:\s*([^\s]+)$/gm)].map(
    (match) => match[1]!,
  );
  if (usesRefs.length !== (refreshEnabled ? 2 : 1)) {
    errors.push("t0_action_ref_count_invalid");
  }
  if (workflow.includes("fork-sandbox-review:")) {
    errors.push("t0_fork_sandbox_not_allowed");
  }
  for (const [pattern, code] of [
    [/(?:^|[\s{,])run\s*:/m, "t0_raw_run_not_allowed"],
    [/(?:^|[\s{,])env\s*:/m, "t0_env_not_allowed"],
    [/(?:^|[\s{,])strategy\s*:/m, "t0_strategy_not_allowed"],
    [
      /\b(?:issues|pull-requests):\s*write\b/m,
      "t0_write_permission_not_allowed",
    ],
  ] as const) {
    if (pattern.test(workflow)) {
      errors.push(code);
    }
  }
  return { valid: errors.length === 0, errors };
}

export function readCodexRotatingWorkflowSourceMetadata(
  workflow: string,
): CodexRotatingWorkflowSourceMetadata {
  const gatewayMetadata = readAccountGatewayMetadataIfPresent(workflow);
  if (gatewayMetadata) {
    return gatewayMetadata;
  }
  const scan = scanCodexRotatingAdvisoryWorkflow(workflow);
  if (!scan.valid) {
    throw new Error(`codex_rotating_workflow_invalid:${scan.errors.join(",")}`);
  }
  const metadata = extractCodexRotatingWorkflowSourceMetadata(workflow);
  if (
    !metadata.actionRef ||
    !metadata.apiUrl ||
    !metadata.providerInstanceId ||
    metadata.workflowSchemaVersion === undefined
  ) {
    throw new Error("codex_rotating_workflow_metadata_missing");
  }
  return {
    actionRef: metadata.actionRef,
    apiUrl: metadata.apiUrl,
    providerInstanceId: metadata.providerInstanceId,
    workflowSchemaVersion: metadata.workflowSchemaVersion,
  };
}

/**
 * Immutable schema-v1 authority contract. Add a new renderer and schema
 * version instead of changing this output; queued runs attest their own SHA.
 */
export function renderCanonicalCodexRotatingT0WorkflowV1(
  input: Pick<
    CodexRotatingWorkflowOptions,
    | "actionRef"
    | "apiUrl"
    | "providerInstanceId"
    | "refreshScheduleCron"
    | "claudeCodeOAuthTokenSecret"
    | "openRouterApiKeySecret"
  >,
): string {
  assertSafeActionRef(input.actionRef);
  const release = parseImmutableActionRelease(input.actionRef);
  const reusableWorkflowRef = `${release.repository}/.github/workflows/reviewrouter-t0-reusable.yml@${release.commitSha}`;
  const refreshScheduleCron =
    input.refreshScheduleCron === undefined
      ? "17 */6 * * *"
      : input.refreshScheduleCron;
  const providerSegment =
    input.providerInstanceId
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 96) || "provider";
  const concurrencyGroup = `reviewrouter-codex-oauth-\${{ github.repository_id }}-${providerSegment}`;

  return `name: ReviewRouter Codex OAuth

run-name: \${{ inputs.review_request_id != '' && format('ReviewRouter review {0}', inputs.review_request_id) || 'ReviewRouter Codex OAuth maintenance' }}

on:
  workflow_dispatch:
    inputs:
      review_request_id:
        description: Durable ReviewRouter request identity
        required: false
        type: string
      pr_number:
        description: Pull request number selected by ReviewRouter
        required: false
        type: string
      review_head_sha:
        description: Expected pull request head selected by ReviewRouter
        required: false
        type: string${
          refreshScheduleCron
            ? `
  schedule:
    - cron: ${JSON.stringify(refreshScheduleCron)}`
            : ""
        }

permissions: {}

jobs:
  codex-review:
    name: codex-review
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.review_request_id != '' && inputs.pr_number != '' && inputs.review_head_sha != '' }}
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: ${reusableWorkflowRef}
    with:
      runtime_ref: ${JSON.stringify(release.commitSha)}
      api_url: ${JSON.stringify(input.apiUrl)}
      runtime_config_mode: oidc
      pr_number: \${{ inputs.pr_number }}
      review_head_sha: \${{ inputs.review_head_sha }}
      provider_instance_id: ${JSON.stringify(input.providerInstanceId)}
      workflow_schema_version: 1
      max_changed_lines: \${{ vars.REVIEW_ROUTER_MAX_CHANGED_LINES }}
      review_timeout_minutes: \${{ fromJSON(vars.REVIEW_ROUTER_TIMEOUT_MINUTES || '60') }}
    secrets:
      CODEX_AUTH_JSON: \${{ secrets.REVIEWROUTER_CODEX_AUTH_JSON }}
${input.claudeCodeOAuthTokenSecret === true ? "      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n" : ""}${input.openRouterApiKeySecret === true ? "      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}\n" : ""}${
    refreshScheduleCron
      ? `
  codex-refresh:
    name: codex-refresh
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    concurrency:
      group: ${concurrencyGroup}
      cancel-in-progress: false
    if: \${{ github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.review_request_id == '') }}
    permissions:
      id-token: write
    steps:
      - name: ReviewRouter Codex OAuth refresh
        id: refresh_codex
        uses: ${input.actionRef}
        with:
          mode: codex-oauth-refresh
          api-url: ${JSON.stringify(input.apiUrl)}
          provider-instance-id: ${JSON.stringify(input.providerInstanceId)}
          workflow-schema-version: "1"
          auth-json: \${{ secrets.REVIEWROUTER_CODEX_AUTH_JSON }}
`
      : ""
  }`;
}

/**
 * Immutable schema-v2 contract for installations where GitHub starts the
 * review from a pull_request event. The control plane still authorizes the
 * exact revision and remains the only publication authority.
 */
export function renderCanonicalCodexRotatingT0WorkflowV2(
  input: Pick<
    CodexRotatingWorkflowOptions,
    | "actionRef"
    | "apiUrl"
    | "providerInstanceId"
    | "refreshScheduleCron"
    | "claudeCodeOAuthTokenSecret"
    | "openRouterApiKeySecret"
  >,
): string {
  return renderCanonicalCodexRotatingClientTriggeredT0Workflow({
    ...input,
    workflowSchemaVersion:
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
    defaultTimeoutMinutes: codexRotatingT0DefaultTimeoutMinutesForSchema(
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
    ),
  });
}

/**
 * Immutable schema-v3 contract. It preserves the client-triggered ingress from
 * schema v2 while reserving the complete T0 execution and publication lifecycle.
 */
export function renderCanonicalCodexRotatingT0WorkflowV3(
  input: Pick<
    CodexRotatingWorkflowOptions,
    | "actionRef"
    | "apiUrl"
    | "providerInstanceId"
    | "refreshScheduleCron"
    | "claudeCodeOAuthTokenSecret"
    | "openRouterApiKeySecret"
  >,
): string {
  return renderCanonicalCodexRotatingClientTriggeredT0Workflow({
    ...input,
    workflowSchemaVersion:
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3,
    defaultTimeoutMinutes: codexRotatingT0DefaultTimeoutMinutesForSchema(
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3,
    ),
  });
}

export function renderCanonicalCodexRotatingT0WorkflowV4(
  input: Pick<
    CodexRotatingWorkflowOptions,
    | "actionRef"
    | "apiUrl"
    | "providerInstanceId"
    | "refreshScheduleCron"
    | "claudeCodeOAuthTokenSecret"
    | "openRouterApiKeySecret"
  > & { readonly activeSecretNamespace: VersionedProviderSecretNamespace },
): string {
  return renderCanonicalCodexRotatingClientTriggeredT0Workflow({
    ...input,
    workflowSchemaVersion:
      CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4,
    defaultTimeoutMinutes: codexRotatingT0DefaultTimeoutMinutesForSchema(
      CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4,
    ),
  });
}

/**
 * Immutable schema-v5 contract. Its byte shape is deliberately identical to
 * schema v4 except for the workflow schema version markers.
 */
export function renderCanonicalCodexRotatingT0WorkflowV5(
  input: Pick<
    CodexRotatingWorkflowOptions,
    | "actionRef"
    | "apiUrl"
    | "providerInstanceId"
    | "refreshScheduleCron"
    | "claudeCodeOAuthTokenSecret"
    | "openRouterApiKeySecret"
  > & { readonly activeSecretNamespace: VersionedProviderSecretNamespace },
): string {
  return renderCanonicalCodexRotatingClientTriggeredT0Workflow({
    ...input,
    workflowSchemaVersion:
      CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5,
    defaultTimeoutMinutes: codexRotatingT0DefaultTimeoutMinutesForSchema(
      CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5,
    ),
  });
}

function renderCanonicalCodexRotatingClientTriggeredT0Workflow(
  input: Pick<
    CodexRotatingWorkflowOptions,
    | "actionRef"
    | "apiUrl"
    | "providerInstanceId"
    | "refreshScheduleCron"
    | "claudeCodeOAuthTokenSecret"
    | "openRouterApiKeySecret"
  > & {
    readonly workflowSchemaVersion:
      | CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2
      | CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredLifecycleV3
      | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4
      | CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5;
    readonly defaultTimeoutMinutes: number;
    readonly activeSecretNamespace?: VersionedProviderSecretNamespace;
  },
): string {
  assertSafeActionRef(input.actionRef);
  const release = parseImmutableActionRelease(input.actionRef);
  const reusableWorkflowRef = `${release.repository}/.github/workflows/reviewrouter-t0-reusable.yml@${release.commitSha}`;
  const refreshScheduleCron =
    input.refreshScheduleCron === undefined
      ? "17 */6 * * *"
      : input.refreshScheduleCron;
  const concurrencyGroup = renderCodexRotatingConcurrencyGroup(
    input.providerInstanceId,
  );
  const secretName =
    input.activeSecretNamespace?.name ?? codexRotatingSecretName;
  const workflowName = input.activeSecretNamespace
    ? `ReviewRouter Codex OAuth [${serializeVersionedProviderSecretNamespaceMetadata(input.activeSecretNamespace)}]`
    : "ReviewRouter Codex OAuth";
  const trustedDefaultBranchTriggered =
    isTrustedDefaultBranchTriggeredCodexWorkflowSchemaVersion(
      input.workflowSchemaVersion,
    );
  const reviewEventName = trustedDefaultBranchTriggered
    ? "pull_request_target"
    : "pull_request";

  return `name: ${workflowName}

run-name: \${{ format('ReviewRouter review PR {0} at {1}', github.event.pull_request.number, github.event.pull_request.head.sha) }}

on:
  ${reviewEventName}:
    types: [opened, synchronize, reopened, ready_for_review, converted_to_draft]${
      refreshScheduleCron
        ? `
  schedule:
    - cron: ${JSON.stringify(refreshScheduleCron)}`
        : ""
    }

permissions: {}

jobs:
  codex-review:
    name: codex-review
    if: \${{ github.event_name == '${reviewEventName}' && github.event.pull_request.head.repo.full_name == github.repository && github.event.pull_request.user.type != 'Bot' && (github.event.pull_request.draft == false || vars.${codexRotatingReviewDraftsVariableName} == 'true') }}
    concurrency:
      group: ${concurrencyGroup}
      cancel-in-progress: false
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: ${reusableWorkflowRef}
    with:
      runtime_ref: ${JSON.stringify(release.commitSha)}
      api_url: ${JSON.stringify(input.apiUrl)}
      runtime_config_mode: oidc
      pr_number: \${{ format('{0}', github.event.pull_request.number) }}
      review_head_sha: \${{ github.event.pull_request.head.sha }}
      provider_instance_id: ${JSON.stringify(input.providerInstanceId)}
      workflow_schema_version: ${input.workflowSchemaVersion}
      max_changed_lines: \${{ vars.${codexRotatingMaxChangedLinesVariableName} }}
      review_timeout_minutes: \${{ fromJSON(vars.${codexRotatingTimeoutMinutesVariableName} || '${input.defaultTimeoutMinutes}') }}
    secrets:
      CODEX_AUTH_JSON: \${{ secrets.${secretName} }}
${input.claudeCodeOAuthTokenSecret === true ? "      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}\n" : ""}${input.openRouterApiKeySecret === true ? "      OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}\n" : ""}${
    refreshScheduleCron
      ? `
  codex-refresh:
    name: codex-refresh
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    concurrency:
      group: ${concurrencyGroup}
      cancel-in-progress: false
    if: \${{ github.event_name == 'schedule' }}
    permissions:
      id-token: write
    steps:
      - name: ReviewRouter Codex OAuth refresh
        id: refresh_codex
        uses: ${input.actionRef}
        with:
          mode: codex-oauth-refresh
          api-url: ${JSON.stringify(input.apiUrl)}
          provider-instance-id: ${JSON.stringify(input.providerInstanceId)}
          workflow-schema-version: "${input.workflowSchemaVersion}"
          auth-json: \${{ secrets.${secretName} }}
`
      : ""
  }`;
}

function extractCodexRotatingWorkflowSourceMetadata(workflow: string): {
  readonly actionRef?: string;
  readonly apiUrl?: string;
  readonly providerInstanceId?: string;
  readonly workflowSchemaVersion?: number;
  readonly mode?: string;
} {
  const reviewJob = extractWorkflowJobSection(workflow, "codex-review") ?? "";
  const rawActionRef = reviewJob.match(/^\s*uses:\s*([^\s]+)$/m)?.[1];
  const reusableRelease = rawActionRef?.match(
    /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/\.github\/workflows\/reviewrouter(?:-t0)?-reusable\.yml@([a-fA-F0-9]{40})$/,
  );
  const isDedicatedT0Workflow =
    rawActionRef?.includes(
      "/.github/workflows/reviewrouter-t0-reusable.yml@",
    ) ?? false;
  const actionRef = reusableRelease
    ? `${reusableRelease[1]}@${reusableRelease[2]!.toLowerCase()}`
    : rawActionRef;
  const t0With = isDedicatedT0Workflow
    ? parseWorkflowFlatMapping(reviewJob, "with", 4)
    : undefined;
  const apiUrl = unquoteWorkflowScalar(
    isDedicatedT0Workflow
      ? workflowMappingValue(t0With, "api_url")
      : reviewJob.match(/^\s*api-url:\s*(.+)$/m)?.[1],
  );
  const providerInstanceId = unquoteWorkflowScalar(
    isDedicatedT0Workflow
      ? workflowMappingValue(t0With, "provider_instance_id")
      : reviewJob.match(/^\s*provider(?:-|_)instance(?:-|_)id:\s*(.+)$/m)?.[1],
  );
  const workflowSchemaVersionRaw = unquoteWorkflowScalar(
    isDedicatedT0Workflow
      ? workflowMappingValue(t0With, "workflow_schema_version")
      : reviewJob.match(
          /^\s*workflow(?:-|_)schema(?:-|_)version:\s*(.+)$/m,
        )?.[1],
  );
  const workflowSchemaVersion =
    workflowSchemaVersionRaw && /^[0-9]+$/.test(workflowSchemaVersionRaw)
      ? Number(workflowSchemaVersionRaw)
      : undefined;
  const mode =
    (isDedicatedT0Workflow ? CodexRotatingReviewActionV2Mode.T0 : undefined) ??
    unquoteWorkflowScalar(
      workflow.match(
        /^\s*(?:mode|review(?:-|_)action(?:-|_)v2(?:-|_)mode):\s*(.+)$/m,
      )?.[1],
    );
  return {
    ...(actionRef ? { actionRef } : {}),
    ...(apiUrl ? { apiUrl } : {}),
    ...(providerInstanceId ? { providerInstanceId } : {}),
    ...(workflowSchemaVersion !== undefined ? { workflowSchemaVersion } : {}),
    ...(mode ? { mode } : {}),
  };
}

function extractWorkflowJobSection(
  workflow: string,
  jobId: string,
): string | undefined {
  const jobMatch = new RegExp(`^ {2}${escapeRegExp(jobId)}:\\s*$`, "m").exec(
    workflow,
  );
  if (!jobMatch) {
    return undefined;
  }
  const start = jobMatch.index;
  const afterStart = start + jobMatch[0].length;
  const remainder = workflow.slice(afterStart);
  const nextPeerMatch = /^(?: {2}[A-Za-z0-9_-]+:\s*$|[A-Za-z0-9_-]+:\s*)/m.exec(
    remainder,
  );
  const end = nextPeerMatch
    ? afterStart + nextPeerMatch.index
    : workflow.length;
  return workflow.slice(start, end);
}

type WorkflowMappingEntry = {
  readonly name: string;
  readonly value: string;
};

type ParsedWorkflowFlatMapping =
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" }
  | {
      readonly kind: "entries";
      readonly entries: readonly WorkflowMappingEntry[];
    };

function parseWorkflowFlatMapping(
  workflowSection: string,
  mappingName: string,
  mappingIndent: number,
): ParsedWorkflowFlatMapping {
  const lines = workflowSection.split("\n");
  const mappingPattern = new RegExp(
    `^ {${mappingIndent}}${escapeRegExp(mappingName)}:\\s*(.*)$`,
  );
  const mappingIndexes = lines
    .map((line, index) => (mappingPattern.test(line) ? index : -1))
    .filter((index) => index >= 0);
  if (mappingIndexes.length === 0) {
    return { kind: "missing" };
  }
  if (mappingIndexes.length !== 1) {
    return { kind: "invalid" };
  }
  const mappingLineIndex = mappingIndexes[0]!;
  const mappingMatch = mappingPattern.exec(lines[mappingLineIndex] ?? "");
  if (!mappingMatch || mappingMatch[1]!.trim().length > 0) {
    return { kind: "invalid" };
  }

  const childIndent = mappingIndent + 2;
  const entries: WorkflowMappingEntry[] = [];
  const names = new Set<string>();
  for (const line of lines.slice(mappingLineIndex + 1)) {
    if (/^\s*(#.*)?$/.test(line)) {
      continue;
    }
    const indent = countLeadingSpaces(line);
    if (indent <= mappingIndent) {
      break;
    }
    const entryMatch = new RegExp(
      `^ {${childIndent}}([A-Za-z0-9_-]+):\\s*(.+?)\\s*$`,
    ).exec(line);
    if (!entryMatch || names.has(entryMatch[1]!)) {
      return { kind: "invalid" };
    }
    names.add(entryMatch[1]!);
    entries.push({ name: entryMatch[1]!, value: entryMatch[2]! });
  }
  return { kind: "entries", entries };
}

function workflowMappingValue(
  mapping: ParsedWorkflowFlatMapping | undefined,
  name: string,
): string | undefined {
  return mapping?.kind === "entries"
    ? mapping.entries.find((entry) => entry.name === name)?.value
    : undefined;
}

function workflowMappingHasExactNames(
  mapping: ParsedWorkflowFlatMapping,
  expectedNames: readonly string[],
): boolean {
  return (
    mapping.kind === "entries" &&
    mapping.entries.length === expectedNames.length &&
    expectedNames.every((name) =>
      mapping.entries.some((entry) => entry.name === name),
    )
  );
}

function workflowMappingHasAllowedNames(
  mapping: ParsedWorkflowFlatMapping,
  input: {
    readonly required: readonly string[];
    readonly allowed: readonly string[];
  },
): boolean {
  return (
    mapping.kind === "entries" &&
    input.required.every((name) =>
      mapping.entries.some((entry) => entry.name === name),
    ) &&
    mapping.entries.every((entry) => input.allowed.includes(entry.name))
  );
}

function workflowJobIdsExactly(
  workflow: string,
  expectedJobIds: readonly string[],
): boolean {
  const jobsMatch = /^jobs:\s*$/m.exec(workflow);
  if (!jobsMatch) {
    return false;
  }
  const jobsSection = workflow.slice(jobsMatch.index + jobsMatch[0].length);
  const nextTopLevel = /^\S.*$/m.exec(jobsSection);
  const boundedJobsSection = nextTopLevel
    ? jobsSection.slice(0, nextTopLevel.index)
    : jobsSection;
  const jobIds = [
    ...boundedJobsSection.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm),
  ].map((match) => match[1]!);
  return (
    jobIds.length === expectedJobIds.length &&
    expectedJobIds.every((jobId) => jobIds.includes(jobId))
  );
}

function isSafeWorkflowApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function parseWorkflowPermissions(
  workflowSection: string,
  permissionsIndent: number,
): ParsedWorkflowPermissions {
  const lines = workflowSection.split("\n");
  const permissionsLineIndex = lines.findIndex((line) => {
    const match = /^(\s*)permissions:\s*(.*)$/.exec(line);
    return match?.[1]?.length === permissionsIndent;
  });
  if (permissionsLineIndex === -1) {
    return { kind: "missing" };
  }

  const permissionsLine = lines[permissionsLineIndex] ?? "";
  const inlineValue = permissionsLine
    .slice(permissionsIndent + "permissions:".length)
    .trim();
  if (inlineValue === "{}") {
    return { kind: "entries", entries: [] };
  }
  if (inlineValue.length > 0) {
    return { kind: "invalid" };
  }

  const childIndent = permissionsIndent + 2;
  const entries: WorkflowPermissionEntry[] = [];
  for (const line of lines.slice(permissionsLineIndex + 1)) {
    if (/^\s*(#.*)?$/.test(line)) {
      continue;
    }
    const indent = countLeadingSpaces(line);
    if (indent <= permissionsIndent) {
      break;
    }
    if (indent !== childIndent) {
      return { kind: "invalid" };
    }
    const entryMatch = new RegExp(
      `^ {${childIndent}}([A-Za-z0-9_-]+):\\s*([A-Za-z0-9_-]+)\\s*(?:#.*)?$`,
    ).exec(line);
    if (!entryMatch) {
      return { kind: "invalid" };
    }
    entries.push({ name: entryMatch[1]!, value: entryMatch[2]! });
  }

  return { kind: "entries", entries };
}

function permissionsAreEmpty(permissions: ParsedWorkflowPermissions): boolean {
  return permissions.kind === "entries" && permissions.entries.length === 0;
}

function permissionsExactly(
  permissions: ParsedWorkflowPermissions,
  expectedEntries: readonly WorkflowPermissionEntry[],
): boolean {
  if (
    permissions.kind !== "entries" ||
    permissions.entries.length !== expectedEntries.length
  ) {
    return false;
  }
  return expectedEntries.every((expected) =>
    permissions.entries.some(
      (entry) => entry.name === expected.name && entry.value === expected.value,
    ),
  );
}

function countLeadingSpaces(value: string): number {
  return /^ */.exec(value)?.[0].length ?? 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function unquoteWorkflowScalar(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function validateAccountGatewayActionRef(
  actionRef: string | undefined,
): string {
  if (
    !actionRef ||
    !/^777genius\/review-router@[a-f0-9]{40}$/.test(actionRef)
  ) {
    throw new Error("account_gateway_requires_immutable_action_ref");
  }
  return actionRef;
}
/** Keyless gateway caller; authority remains in server run admission. */
export function renderCanonicalAccountGatewayWorkflow(options: {
  readonly actionRef: string;
  readonly apiUrl: string;
  readonly githubRepositoryId: string;
  readonly reviewTimeoutMinutes?: number;
}): string {
  const reviewTimeoutMinutes =
    options.reviewTimeoutMinutes ??
    codexRotatingT0DefaultTimeoutMinutesForSchema(
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
    );
  if (
    !Number.isSafeInteger(reviewTimeoutMinutes) ||
    reviewTimeoutMinutes < 10 ||
    reviewTimeoutMinutes > 360
  ) {
    throw new Error("account_gateway_review_timeout_invalid");
  }
  const runtimeRef = validateAccountGatewayActionRef(options.actionRef).split(
    "@",
  )[1]!;
  assertSafeAccountGatewayApiUrl(options.apiUrl);
  const providerInstanceId = canonicalCodexRotatingProviderId(
    options.githubRepositoryId,
  );
  return `name: ReviewRouter Codex
run-name: \${{ format('ReviewRouter review {0}', inputs.review_request_id) }}
on:
  workflow_dispatch:
    inputs:
      review_request_id:
        description: Durable ReviewRouter request identity
        required: true
        type: string
      pr_number:
        description: Pull request number selected by ReviewRouter
        required: true
        type: string
      review_head_sha:
        description: Expected pull request head selected by ReviewRouter
        required: true
        type: string
permissions: {}
jobs:
  codex-review:
    if: \${{ github.event_name == 'workflow_dispatch' && inputs.review_request_id != '' && inputs.pr_number != '' && inputs.review_head_sha != '' }}
    concurrency:
      group: reviewrouter-codex-\${{ github.repository_id }}
      cancel-in-progress: false
    permissions:
      contents: read
      pull-requests: read
      id-token: write
    uses: 777genius/review-router/.github/workflows/reviewrouter-t0-reusable.yml@${runtimeRef}
    with:
      runtime_ref: ${JSON.stringify(runtimeRef)}
      api_url: ${JSON.stringify(options.apiUrl)}
      pr_number: \${{ inputs.pr_number }}
      review_head_sha: \${{ inputs.review_head_sha }}
      provider_instance_id: ${JSON.stringify(providerInstanceId)}
      runtime_config_mode: oidc
      codex_session_mode: account-gateway
      workflow_schema_version: 2
      review_timeout_minutes: ${reviewTimeoutMinutes}
`;
}

/** Source recognition only: callers must still bind these values to trusted server configuration. */
export function readCanonicalAccountGatewayWorkflowSourceMetadata(
  workflow: string,
): AccountGatewayWorkflowSourceMetadata {
  const root = requireAccountGatewayMapping(
    readCanonicalWorkflowDocument(workflow),
  );
  const jobs = requireAccountGatewayMapping(root.jobs);
  const job = requireAccountGatewayMapping(jobs["codex-review"]);
  const inputs = requireAccountGatewayMapping(job.with);
  if (
    inputs.codex_session_mode !== "account-gateway" ||
    inputs.workflow_schema_version !==
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2
  ) {
    throw new Error("account_gateway_workflow_mode_or_schema_invalid");
  }
  const uses = typeof job.uses === "string" ? job.uses : "";
  const actionRef = validateAccountGatewayActionRef(
    uses.replace("/.github/workflows/reviewrouter-t0-reusable.yml@", "@"),
  );
  const apiUrl = typeof inputs.api_url === "string" ? inputs.api_url : "";
  const providerInstanceId =
    typeof inputs.provider_instance_id === "string"
      ? inputs.provider_instance_id
      : "";
  const repositoryId = codexRotatingProviderIdSchema
    .parse(providerInstanceId)
    .split(":")[1]!;
  const reviewTimeoutMinutes = inputs.review_timeout_minutes;
  if (typeof reviewTimeoutMinutes !== "number") {
    throw new Error("account_gateway_review_timeout_invalid");
  }
  const expectedWorkflow = renderCanonicalAccountGatewayWorkflow({
    actionRef,
    apiUrl,
    githubRepositoryId: repositoryId,
    reviewTimeoutMinutes,
  });
  if (!areWorkflowDocumentsSemanticallyEqual(workflow, expectedWorkflow)) {
    throw new Error("codex_rotating_t0_workflow_source_not_canonical");
  }
  return {
    actionRef,
    apiUrl,
    providerInstanceId,
    workflowSchemaVersion:
      CodexRotatingT0WorkflowSchemaVersion.ClientTriggeredV2,
    codexSessionMode: "account-gateway",
    runtimeConfigMode: "oidc",
    runtimeRef: actionRef.split("@")[1]!,
  };
}

/** An explicit session-mode input must never fall back to legacy secret scanning. */
function readAccountGatewayMetadataIfPresent(
  workflow: string,
): AccountGatewayWorkflowSourceMetadata | undefined {
  let inputs: Record<string, unknown>;
  try {
    const root = requireAccountGatewayMapping(
      readCanonicalWorkflowDocument(workflow),
    );
    const jobs = requireAccountGatewayMapping(root.jobs);
    const job = requireAccountGatewayMapping(jobs["codex-review"]);
    inputs = requireAccountGatewayMapping(job.with);
  } catch {
    // Leave legacy source recognition unchanged.
    return undefined;
  }
  return Object.hasOwn(inputs, "codex_session_mode")
    ? readCanonicalAccountGatewayWorkflowSourceMetadata(workflow)
    : undefined;
}

function requireAccountGatewayMapping(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("codex_rotating_workflow_mapping_required");
  }
  return value as Record<string, unknown>;
}

function assertSafeAccountGatewayApiUrl(apiUrl: string): void {
  if (apiUrl.includes("${{")) {
    throw new Error("invalid_workflow_api_url");
  }
  let parsed: URL;
  try {
    parsed = new URL(apiUrl);
  } catch {
    throw new Error("invalid_workflow_api_url");
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("invalid_workflow_api_url");
  }
  const local = isLoopbackHostname(parsed.hostname);
  if (parsed.protocol === "https:" && !local) {
    return;
  }
  if (parsed.protocol === "http:" && local) {
    return;
  }

  throw new Error("invalid_workflow_api_url");
}

export function areWorkflowDocumentsSemanticallyEqual(
  actual: string,
  expected: string,
): boolean {
  try {
    return (
      JSON.stringify(readCanonicalWorkflowDocument(actual)) ===
      JSON.stringify(readCanonicalWorkflowDocument(expected))
    );
  } catch {
    return false;
  }
}

/**
 * Managed-workflow attestation must survive repository Node tooling bumps:
 * `node-version` selects the runner toolchain and is not part of the attested
 * execution contract (pinned action revisions, steps, permissions, env), while
 * a mismatch there must never invalidate an otherwise trusted bootstrap.
 */
export function areManagedWorkflowDocumentsAttested(
  actual: string,
  expected: string,
): boolean {
  try {
    return (
      JSON.stringify(
        attestableWorkflowDocument(readCanonicalWorkflowDocument(actual)),
      ) ===
      JSON.stringify(
        attestableWorkflowDocument(readCanonicalWorkflowDocument(expected)),
      )
    );
  } catch {
    return false;
  }
}

function attestableWorkflowDocument(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(attestableWorkflowDocument);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        key === "node-version" || key === "node-version-file"
          ? "<node-toolchain>"
          : attestableWorkflowDocument(entry),
      ]),
    );
  }
  return value;
}

export function workflowDocumentSemanticSha256(source: string): string {
  return createHash("sha256")
    .update(JSON.stringify(readCanonicalWorkflowDocument(source)), "utf8")
    .digest("hex");
}

export function readCanonicalWorkflowDocument(source: string): unknown {
  const document = parseDocument(source, {
    schema: "core",
    strict: true,
    stringKeys: true,
    uniqueKeys: true,
    prettyErrors: false,
  });
  if (document.errors.length > 0 || document.warnings.length > 0) {
    throw new Error("codex_rotating_workflow_yaml_invalid");
  }
  return canonicalizeWorkflowDocument(document.toJS({ maxAliasCount: 0 }));
}

function canonicalizeWorkflowDocument(value: unknown): unknown {
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error("codex_rotating_workflow_non_finite_number");
  }
  if (Array.isArray(value)) {
    return value.map(canonicalizeWorkflowDocument);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalizeWorkflowDocument(entry)]),
    );
  }
  return value;
}
