import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import { reviewRouterApiUrlsMatch } from "@reviewrouter/shared";
import {
  ManagedReviewV2WorkflowInventory,
  readManagedReviewRouterCallerSource,
} from "@reviewrouter/features-workflow-provisioning";
import { reviewRouterWorkflowContract } from "@reviewrouter/protocol-review-workflow";
import { App } from "@octokit/app";
import { request as githubRequest } from "@octokit/request";
import { createHash } from "node:crypto";
import {
  assertCanonicalCodexRotatingProviderId,
  canonicalCodexRotatingProviderId,
  areManagedWorkflowDocumentsAttested,
  areWorkflowDocumentsSemanticallyEqual,
  readCanonicalCodexRotatingT0WorkflowSourceMetadata,
  readCanonicalIsolatedQualityWorkflowSourceMetadata,
  codexWorkflowPathForRepository,
  isolatedQualityWorkflowPath,
  isolatedQualityWorkflowRepository,
  isolatedQualityWorkflowRepositoryId,
  isCodexWorkflowRepositoryIdentityAdmitted,
  createVersionedSecretWorkflowSourceAttestation,
  serializeVersionedProviderSecretNamespaceMetadata,
  workflowDocumentSemanticSha256,
  WorkflowSourceTrust,
  renderCanonicalCodexRotatingT0WorkflowV4,
  renderCanonicalCodexRotatingT0WorkflowV5,
  CodexRotatingT0WorkflowSchemaVersion,
  type VersionedProviderSecretNamespace,
} from "@reviewrouter/features-codex-oauth-rotating";
import {
  renderCanonicalCodexRotatingInteractionWorkflowV1,
  renderCanonicalCodexRotatingInteractionWorkflowV2,
  renderCanonicalCodexRotatingInteractionWorkflowV3,
} from "@reviewrouter/features-workflow-provisioning";
import { isLoopbackHostname } from "@reviewrouter/platform-config";
import {
  managedCodexWorkflowPath,
  managedInteractionWorkflowPath,
  CodexRotatingSecretPutPreDispatchError,
  type ActionRepositoryContext,
  type CodexRotatingGitHubSecretTokenIssuerPort,
  type CodexRotatingGitHubSecretWriterPort,
  type CodexRotatingGitHubCheckoutTokenIssuerPort,
  type CodexRotatingWorkflowSourceVerifierPort,
  type CodexRotatingSecretWriteTarget,
  type CodexRotatingVersionedWorkflowPublisherPort,
} from "@reviewrouter/features-action-control-plane";
import type { HostedReviewPullRequestFactsPort } from "../hosted-review-prelease-gate.js";
import {
  putGitHubSecretExactlyOnce,
  type OneShotGitHubSecretPut,
} from "./one-shot-github-secret-put.js";
type InstallationTokenResponse = {
  readonly type?: unknown;
  readonly tokenType?: unknown;
  readonly token?: unknown;
  readonly expiresAt?: unknown;
  readonly permissions?: {
    readonly actions?: unknown;
    readonly contents?: unknown;
    readonly pull_requests?: unknown;
    readonly secrets?: unknown;
  };
};

type SecretPermission = "read" | "write";
type InstallationPermission = {
  readonly actions?: "read";
  readonly secrets?: SecretPermission;
  readonly contents?: "read" | "write";
  readonly pull_requests?: "read";
};

type ContentsResponse = {
  readonly data?: unknown;
};

type ContentsWriteResponse = {
  readonly data?: {
    readonly commit?: { readonly sha?: unknown };
  };
};

type WorkflowRunResponse = {
  readonly data?: unknown;
};

type RepositoryResponse = {
  readonly data?: unknown;
};

type PullRequestResponse = {
  readonly data?: unknown;
};

type BranchResponse = {
  readonly data?: unknown;
};

type CompareResponse = {
  readonly data?: unknown;
};

type RepositoryActionsPublicKeyResponse = {
  readonly data?: {
    readonly key_id?: unknown;
    readonly key?: unknown;
  };
};

export class OctokitCodexRotatingGitHubSecretGateway
  implements
    CodexRotatingGitHubSecretTokenIssuerPort,
    CodexRotatingGitHubSecretWriterPort,
    CodexRotatingGitHubCheckoutTokenIssuerPort,
    CodexRotatingWorkflowSourceVerifierPort,
    CodexRotatingVersionedWorkflowPublisherPort,
    HostedReviewPullRequestFactsPort
{
  private readonly app: App;
  private readonly expectedApiUrl: string;
  private readonly trustedActionRefs: ReadonlySet<string>;
  private readonly secretPut: OneShotGitHubSecretPut;
  private readonly secretPutBaseUrl: string;
  private readonly secretPutTimeoutMs: number;

  constructor(options: {
    readonly appId: string;
    readonly privateKey: string;
    readonly expectedApiUrl: string;
    readonly trustedActionRefs?: readonly string[];
    readonly secretPut?: OneShotGitHubSecretPut;
    readonly secretPutBaseUrl?: string;
    readonly secretPutTimeoutMs?: number;
  }) {
    this.expectedApiUrl = normalizeWorkflowApiUrl(options.expectedApiUrl);
    this.app = new App({
      appId: options.appId,
      privateKey: options.privateKey,
    });
    this.trustedActionRefs = new Set(
      (options.trustedActionRefs ?? []).map((ref) => ref.toLowerCase()),
    );
    this.secretPut = options.secretPut ?? putGitHubSecretExactlyOnce;
    this.secretPutBaseUrl =
      options.secretPutBaseUrl ?? "https://api.github.com";
    this.secretPutTimeoutMs = options.secretPutTimeoutMs ?? 15_000;
  }

  async issueSecretsReadToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
  }): Promise<{
    readonly token: string;
    readonly expiresAt: Date;
    readonly permissions: { readonly secrets: "read" };
  }> {
    const token = await this.mintRepositorySecretsToken({
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      permission: "read",
    });
    return {
      token: token.token,
      expiresAt: token.expiresAt,
      permissions: { secrets: "read" },
    };
  }

  async assertCanWriteRepositorySecret(
    input: CodexRotatingSecretWriteTarget,
  ): Promise<{ readonly status: "ready" }> {
    assertCanonicalCodexRotatingProviderId({
      providerInstanceId:
        input.expectedProviderInstanceId ??
        canonicalCodexRotatingProviderId(input.githubRepositoryId),
      githubRepositoryId: input.githubRepositoryId,
    });
    await this.mintRepositorySecretsToken({
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      permission: "write",
    });
    return { status: "ready" };
  }

  async getRepositoryActionsPublicKey(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
  }): Promise<{ readonly keyId: string; readonly key: string }> {
    const token = await this.mintRepositorySecretsToken({
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      permission: "read",
    });
    const response = (await githubRequest(
      "GET /repos/{owner}/{repo}/actions/secrets/public-key",
      {
        owner: input.owner,
        repo: input.repo,
        headers: {
          authorization: `Bearer ${token.token}`,
        },
      },
    )) as RepositoryActionsPublicKeyResponse;
    if (
      typeof response.data?.key_id !== "string" ||
      response.data.key_id.length === 0 ||
      typeof response.data.key !== "string" ||
      response.data.key.length === 0
    ) {
      throw new Error("provider_api_key_public_key_invalid_response");
    }
    return { keyId: response.data.key_id, key: response.data.key };
  }

  async issueContentsReadToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
  }): Promise<{
    readonly token: string;
    readonly expiresAt: Date;
    readonly permissions: {
      readonly contents: "read";
      readonly pullRequests: "read";
    };
  }> {
    const token = await this.mintRepositoryToken({
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      permissions: { contents: "read", pull_requests: "read" },
    });
    return {
      token: token.token,
      expiresAt: token.expiresAt,
      permissions: { contents: "read", pullRequests: "read" },
    };
  }

  async putEncryptedRepositorySecret(
    input: CodexRotatingSecretWriteTarget & {
      readonly encryptedValue: string;
      readonly keyId: string;
    },
  ): Promise<{
    readonly status: "accepted";
    readonly statusCode: 201 | 204;
  }> {
    let token;
    try {
      assertCanonicalCodexRotatingProviderId({
        providerInstanceId:
          input.expectedProviderInstanceId ??
          canonicalCodexRotatingProviderId(input.githubRepositoryId),
        githubRepositoryId: input.githubRepositoryId,
      });
      token = await this.mintRepositorySecretsToken({
        githubInstallationId: input.githubInstallationId,
        githubRepositoryId: input.githubRepositoryId,
        permission: "write",
      });
    } catch {
      // No repository-secret request has been dispatched yet, so this is the
      // only failure class that may safely permit an in-place recovery.
      throw new CodexRotatingSecretPutPreDispatchError();
    }
    // This is deliberately not Octokit request machinery: the one-shot port
    // constructs one native ClientRequest, disables connection reuse, and has
    // no redirect or retry path.
    const response = await this.secretPut({
      baseUrl: this.secretPutBaseUrl,
      owner: input.owner,
      repo: input.repo,
      secretName: input.secretName,
      encryptedValue: input.encryptedValue,
      keyId: input.keyId,
      token: token.token,
      timeoutMs: this.secretPutTimeoutMs,
    });

    if (response.status !== 201 && response.status !== 204) {
      throw new Error("codex_rotating_secret_put_unexpected_status");
    }
    return { status: "accepted", statusCode: response.status };
  }

  async publishAndVerifyVersionedWorkflow(input: {
    readonly repository: ActionRepositoryContext;
    readonly providerInstanceId: string;
    readonly namespace: VersionedProviderSecretNamespace;
  }) {
    if (
      !isCodexWorkflowRepositoryIdentityAdmitted({
        repositoryId: input.repository.githubRepositoryId,
        repositoryFullName: input.repository.fullName,
      })
    ) {
      throw new Error("codex_rotating_workflow_repository_identity_mismatch");
    }
    assertCanonicalCodexRotatingProviderId({
      providerInstanceId: input.providerInstanceId,
      githubRepositoryId: input.repository.githubRepositoryId,
    });
    const workflowPath = codexWorkflowPathForRepository({
      repositoryId: input.repository.githubRepositoryId,
      repositoryFullName: input.repository.fullName,
    });
    const repo = repoNameFromFullName(input.repository.fullName);
    const token = await this.mintRepositoryToken({
      githubInstallationId: input.repository.githubInstallationId,
      githubRepositoryId: input.repository.githubRepositoryId,
      permissions: { contents: "write" },
    });
    const headers = { authorization: `Bearer ${token.token}` };
    const repositoryResponse = (await githubRequest(
      "GET /repos/{owner}/{repo}",
      {
        owner: input.repository.owner,
        repo,
        headers,
      },
    )) as RepositoryResponse;
    const defaultBranch = decodeRepositoryDefaultBranch(
      repositoryResponse.data,
      input.repository.githubRepositoryId,
      input.repository.fullName,
    );
    const defaultBranchHead = await this.readBranchHead({
      token: token.token,
      owner: input.repository.owner,
      repo,
      branch: defaultBranch,
    });
    const currentResponse = (await githubRequest(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: input.repository.owner,
        repo,
        path: workflowPath,
        ref: defaultBranchHead,
        headers,
      },
    )) as ContentsResponse;
    const currentSource = decodeWorkflowContent(currentResponse.data);
    const currentBlobSha = decodeWorkflowBlobSha(currentResponse.data);
    const isolatedQualitySource = workflowPath === isolatedQualityWorkflowPath;
    const metadata = isolatedQualitySource
      ? readCanonicalIsolatedQualityWorkflowSourceMetadata(currentSource)
      : readCanonicalCodexRotatingT0WorkflowSourceMetadata(currentSource);
    if (
      metadata.providerInstanceId !== input.providerInstanceId ||
      !reviewRouterApiUrlsMatch(metadata.apiUrl, this.expectedApiUrl) ||
      !this.trustedActionRefs.has(metadata.actionRef.toLowerCase())
    ) {
      throw new Error("codex_rotating_workflow_publish_source_untrusted");
    }
    const refreshScheduleCron = isolatedQualitySource
      ? null
      : extractCanonicalRefreshCron(currentSource);
    const renderVersionedWorkflow =
      metadata.workflowSchemaVersion ===
      CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV4
        ? renderCanonicalCodexRotatingT0WorkflowV4
        : metadata.workflowSchemaVersion ===
            CodexRotatingT0WorkflowSchemaVersion.VersionedSecretNamespaceV5
          ? renderCanonicalCodexRotatingT0WorkflowV5
          : null;
    if (!renderVersionedWorkflow) {
      throw new Error("codex_rotating_workflow_publish_source_untrusted");
    }
    const workflowSchemaVersion = metadata.workflowSchemaVersion;
    const nextSource = isolatedQualitySource
      ? currentSource
          .replace(
            serializeVersionedProviderSecretNamespaceMetadata(
              metadata.secretNamespace!,
            ),
            serializeVersionedProviderSecretNamespaceMetadata(input.namespace),
          )
          .replaceAll(metadata.secretNamespace!.name, input.namespace.name)
      : renderVersionedWorkflow({
          actionRef: metadata.actionRef,
          apiUrl: metadata.apiUrl,
          providerInstanceId: input.providerInstanceId,
          refreshScheduleCron,
          claudeCodeOAuthTokenSecret: currentSource.includes(
            "CLAUDE_CODE_OAUTH_TOKEN:",
          ),
          openRouterApiKeySecret: currentSource.includes("OPENROUTER_API_KEY:"),
          activeSecretNamespace: input.namespace,
        });
    // Reparse before publication so malformed rendering can never reach the
    // trusted branch even if a future template change regresses.
    const nextMetadata = isolatedQualitySource
      ? readCanonicalIsolatedQualityWorkflowSourceMetadata(nextSource)
      : readCanonicalCodexRotatingT0WorkflowSourceMetadata(nextSource);
    if (
      nextMetadata.workflowSchemaVersion !== workflowSchemaVersion ||
      !nextMetadata.secretNamespace ||
      nextMetadata.secretNamespace.namespaceId !==
        input.namespace.namespaceId ||
      nextMetadata.secretNamespace.epoch !== input.namespace.epoch ||
      nextMetadata.secretNamespace.name !== input.namespace.name ||
      !nextSource.includes(`secrets.${input.namespace.name}`)
    ) {
      throw new Error("codex_rotating_workflow_publish_render_invalid");
    }

    const commitSha = areWorkflowDocumentsSemanticallyEqual(
      currentSource,
      nextSource,
    )
      ? defaultBranchHead
      : decodeContentsWriteCommitSha(
          (
            (await githubRequest("PUT /repos/{owner}/{repo}/contents/{path}", {
              owner: input.repository.owner,
              repo,
              path: workflowPath,
              branch: defaultBranch,
              sha: currentBlobSha,
              message: "chore: rotate ReviewRouter Codex auth namespace",
              content: Buffer.from(nextSource, "utf8").toString("base64"),
              headers,
            })) as ContentsWriteResponse
          ).data,
        );
    const verified = await this.verifyWorkflowSource({
      repository: input.repository,
      workflowSha: commitSha,
      workflowRef: `${input.repository.fullName}/${workflowPath}@refs/heads/${defaultBranch}`,
      workflowPath,
      expectedActionOwnerRepo: metadata.actionRef.split("@")[0]!,
      expectedProviderInstanceId: input.providerInstanceId,
      expectedWorkflowSchemaVersion: workflowSchemaVersion,
    });
    if (!verified.attestation) {
      throw new Error("codex_rotating_workflow_publish_attestation_missing");
    }
    return verified.attestation;
  }

  async verifyWorkflowSource(input: {
    readonly repository: {
      readonly githubInstallationId: string;
      readonly githubRepositoryId: string;
      readonly fullName: string;
      readonly owner: string;
    };
    readonly workflowSha: string;
    readonly workflowRef: string;
    readonly workflowPath: string;
    readonly expectedActionOwnerRepo: string;
    readonly expectedProviderInstanceId: string;
    readonly expectedWorkflowSchemaVersion: number;
  }) {
    if (
      !isCodexWorkflowRepositoryIdentityAdmitted({
        repositoryId: input.repository.githubRepositoryId,
        repositoryFullName: input.repository.fullName,
      })
    ) {
      throw new Error("codex_rotating_workflow_repository_identity_mismatch");
    }
    assertCanonicalCodexRotatingProviderId({
      providerInstanceId: input.expectedProviderInstanceId,
      githubRepositoryId: input.repository.githubRepositoryId,
    });
    const token = await this.mintRepositoryToken({
      githubInstallationId: input.repository.githubInstallationId,
      githubRepositoryId: input.repository.githubRepositoryId,
      permissions: { contents: "read" },
    });
    const response = (await githubRequest(
      "GET /repos/{owner}/{repo}/contents/{path}",
      {
        owner: input.repository.owner,
        repo: repoNameFromFullName(input.repository.fullName),
        path: input.workflowPath,
        ref: input.workflowSha,
        headers: {
          authorization: `Bearer ${token.token}`,
        },
      },
    )) as ContentsResponse;
    const workflow = decodeWorkflowContent(response.data);
    const isolatedQualitySource =
      input.repository.githubRepositoryId ===
        isolatedQualityWorkflowRepositoryId &&
      input.repository.fullName === isolatedQualityWorkflowRepository &&
      input.workflowPath === isolatedQualityWorkflowPath;
    const metadata = isolatedQualitySource
      ? readCanonicalIsolatedQualityWorkflowSourceMetadata(workflow)
      : readCanonicalCodexRotatingT0WorkflowSourceMetadata(workflow);
    if (
      metadata.actionRef.split("@")[0]!.toLowerCase() !==
      input.expectedActionOwnerRepo.toLowerCase()
    ) {
      throw new Error("codex_rotating_workflow_action_ref_not_allowed");
    }
    if (!this.trustedActionRefs.has(metadata.actionRef.toLowerCase())) {
      throw new Error("codex_rotating_workflow_action_ref_not_trusted");
    }
    if (metadata.providerInstanceId !== input.expectedProviderInstanceId) {
      throw new Error("codex_rotating_workflow_provider_instance_mismatch");
    }
    if (!reviewRouterApiUrlsMatch(metadata.apiUrl, this.expectedApiUrl)) {
      throw new Error("codex_rotating_workflow_api_url_mismatch");
    }
    if (
      metadata.workflowSchemaVersion !== input.expectedWorkflowSchemaVersion
    ) {
      throw new Error("codex_rotating_workflow_schema_mismatch");
    }
    if (!metadata.secretNamespace) {
      throw new Error("codex_rotating_workflow_secret_namespace_missing");
    }
    const repositoryResponse = (await githubRequest(
      "GET /repos/{owner}/{repo}",
      {
        owner: input.repository.owner,
        repo: repoNameFromFullName(input.repository.fullName),
        headers: { authorization: `Bearer ${token.token}` },
      },
    )) as RepositoryResponse;
    const defaultBranch = decodeRepositoryDefaultBranch(
      repositoryResponse.data,
      input.repository.githubRepositoryId,
      input.repository.fullName,
    );
    const workflowBranch = readWorkflowBranchRef({
      workflowRef: input.workflowRef,
      repositoryFullName: input.repository.fullName,
      workflowPath: input.workflowPath,
    });
    const workflowBranchHead = await this.readBranchHead({
      token: token.token,
      owner: input.repository.owner,
      repo: repoNameFromFullName(input.repository.fullName),
      branch: workflowBranch,
    });
    await this.assertWorkflowRevisionOnBranchHistory({
      token: token.token,
      owner: input.repository.owner,
      repo: repoNameFromFullName(input.repository.fullName),
      workflowSha: input.workflowSha,
      branchHead: workflowBranchHead,
    });
    const workflowSourceSha256 = createHash("sha256")
      .update(workflow, "utf8")
      .digest("hex");
    const workflowSourceBlobSha = decodeWorkflowBlobSha(response.data);
    const computedWorkflowBlobSha = createHash(
      workflowSourceBlobSha.length === 40 ? "sha1" : "sha256",
    )
      .update(`blob ${Buffer.byteLength(workflow, "utf8")}\0`, "utf8")
      .update(workflow, "utf8")
      .digest("hex");
    if (computedWorkflowBlobSha !== workflowSourceBlobSha) {
      throw new Error("codex_rotating_workflow_blob_sha_mismatch");
    }
    const attestation = createVersionedSecretWorkflowSourceAttestation({
      repositoryId: input.repository.githubRepositoryId,
      workflowPath: input.workflowPath,
      workflowSourceCommitSha: input.workflowSha,
      workflowSourceBlobSha,
      workflowSourceSha256,
      workflowSemanticSha256: workflowDocumentSemanticSha256(workflow),
      workflowSchemaVersion: metadata.workflowSchemaVersion,
      sourceTrust:
        workflowBranch === defaultBranch
          ? WorkflowSourceTrust.TrustedDefaultBranchRevision
          : WorkflowSourceTrust.TrustedCanonicalBranchMirrorRevision,
      secretNamespace: metadata.secretNamespace,
    });

    return {
      binding: {
        providerInstanceId: metadata.providerInstanceId,
        repositoryFullName: input.repository.fullName,
        githubRepositoryId: input.repository.githubRepositoryId,
        actionRef: metadata.actionRef,
        workflowPath: input.workflowPath,
        workflowSchemaVersion: metadata.workflowSchemaVersion,
        activeSecretNamespace: metadata.secretNamespace,
      },
      attestation,
    };
  }

  async verifyManagedV2SessionBootstrapSource(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly owner: string;
    readonly workflowPath: string;
    readonly workflowSha: string;
    readonly expectedProviderApiActionCommitSha?: string;
  }): Promise<{
    readonly compatible: boolean;
    readonly providerApiAuthMode?: ProviderApiAuthMode;
    readonly mcpSecrets?: Readonly<Record<string, string>>;
  }> {
    if (input.workflowPath === reviewRouterWorkflowContract.callerPath) {
      let source: string | null;
      try {
        const token = await this.mintRepositoryToken({
          githubInstallationId: input.githubInstallationId,
          githubRepositoryId: input.githubRepositoryId,
          permissions: { contents: "read" },
        });
        source = await this.readWorkflowAtRef({
          token: token.token,
          owner: input.owner,
          repo: repoNameFromFullName(input.repositoryFullName),
          path: reviewRouterWorkflowContract.callerPath,
          ref: input.workflowSha,
          missingAllowed: true,
        });
      } catch {
        throw new Error("managed_workflow_source_temporarily_unavailable");
      }
      if (!source) return { compatible: false };
      try {
        const caller = readManagedReviewRouterCallerSource(source);
        // Source proves the installation ABI, never the executed release.
        // Signed executable SHA and registry state are checked by admission.
        const compatible =
          (input.expectedProviderApiActionCommitSha !== undefined
            ? caller.modelTransport === "provider_api" &&
              caller.runtimeRef === input.expectedProviderApiActionCommitSha
            : caller.modelTransport === "account_gateway") &&
          reviewRouterApiUrlsMatch(caller.controlPlaneUrl, this.expectedApiUrl);
        if (!compatible) return { compatible: false };
        return {
          compatible: true,
          ...(caller.mcpSecrets ? { mcpSecrets: caller.mcpSecrets } : {}),
          ...(caller.providerApiAuthMode
            ? { providerApiAuthMode: caller.providerApiAuthMode }
            : {}),
        };
      } catch {
        return { compatible: false };
      }
    }
    const isolatedQualitySource =
      input.githubRepositoryId === isolatedQualityWorkflowRepositoryId &&
      input.repositoryFullName === isolatedQualityWorkflowRepository &&
      input.workflowPath === isolatedQualityWorkflowPath;
    if (
      input.workflowPath !== managedCodexWorkflowPath &&
      input.workflowPath !== managedInteractionWorkflowPath &&
      !isolatedQualitySource
    ) {
      return { compatible: false };
    }
    let codexWorkflow: string | null;
    let claimedWorkflow: string | null;
    try {
      const token = await this.mintRepositoryToken({
        githubInstallationId: input.githubInstallationId,
        githubRepositoryId: input.githubRepositoryId,
        permissions: { contents: "read" },
      });
      const repo = repoNameFromFullName(input.repositoryFullName);
      [codexWorkflow, claimedWorkflow] = await Promise.all([
        isolatedQualitySource
          ? Promise.resolve(null)
          : this.readWorkflowAtRef({
              token: token.token,
              owner: input.owner,
              repo,
              path: managedCodexWorkflowPath,
              ref: input.workflowSha,
              missingAllowed: true,
            }),
        input.workflowPath === managedCodexWorkflowPath
          ? Promise.resolve(null)
          : this.readWorkflowAtRef({
              token: token.token,
              owner: input.owner,
              repo,
              path: input.workflowPath,
              ref: input.workflowSha,
              missingAllowed: true,
            }),
      ]);
    } catch {
      throw new Error("managed_workflow_source_temporarily_unavailable");
    }
    if (isolatedQualitySource) {
      if (!claimedWorkflow) return { compatible: false };
      try {
        const quality =
          readCanonicalIsolatedQualityWorkflowSourceMetadata(claimedWorkflow);
        return {
          compatible:
            reviewRouterApiUrlsMatch(quality.apiUrl, this.expectedApiUrl) &&
            quality.providerInstanceId ===
              `codex-rotating:${input.githubRepositoryId}` &&
            this.trustedActionRefs.has(quality.actionRef.toLowerCase()),
        };
      } catch {
        return { compatible: false };
      }
    }
    if (!codexWorkflow) {
      return { compatible: false };
    }

    let metadata;
    try {
      metadata =
        readCanonicalCodexRotatingT0WorkflowSourceMetadata(codexWorkflow);
    } catch {
      return { compatible: false };
    }
    if (
      !reviewRouterApiUrlsMatch(metadata.apiUrl, this.expectedApiUrl) ||
      metadata.providerInstanceId !==
        `codex-rotating:${input.githubRepositoryId}` ||
      !this.trustedActionRefs.has(metadata.actionRef.toLowerCase())
    ) {
      return { compatible: false };
    }
    if (input.workflowPath === managedCodexWorkflowPath) {
      return { compatible: true };
    }
    const expectedInteractionWorkflows = [
      renderCanonicalCodexRotatingInteractionWorkflowV3({
        actionRef: metadata.actionRef,
        apiUrl: metadata.apiUrl,
        runtimeConfigMode: "oidc",
      }),
      renderCanonicalCodexRotatingInteractionWorkflowV2({
        actionRef: metadata.actionRef,
        apiUrl: metadata.apiUrl,
        runtimeConfigMode: "oidc",
      }),
      renderCanonicalCodexRotatingInteractionWorkflowV1({
        actionRef: metadata.actionRef,
        apiUrl: metadata.apiUrl,
        runtimeConfigMode: "oidc",
      }),
    ];
    return {
      compatible:
        claimedWorkflow !== null &&
        expectedInteractionWorkflows.some((expectedInteractionWorkflow) =>
          areManagedWorkflowDocumentsAttested(
            claimedWorkflow,
            expectedInteractionWorkflow,
          ),
        ),
    };
  }

  async inspectReviewV2ManagedWorkflowInventory(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly owner: string;
  }) {
    return new ManagedReviewV2WorkflowInventory({
      expectedApiUrl: this.expectedApiUrl,
      access: {
        request: (route, parameters) =>
          githubRequest(route as never, parameters as never),
        issueRepositoryReadToken: (target) =>
          this.mintRepositoryToken({
            ...target,
            permissions: { contents: "read", pull_requests: "read" },
          }),
      },
    }).inspectReviewV2ManagedWorkflowInventory(input);
  }

  async resolveWorkflowRunPullRequest(input: {
    readonly repository: {
      readonly githubInstallationId: string;
      readonly githubRepositoryId: string;
      readonly fullName: string;
      readonly owner: string;
    };
    readonly githubRunId: string;
    readonly githubRunAttempt: string;
    readonly eventName: "pull_request_target";
  }): Promise<number> {
    const token = await this.mintRepositoryToken({
      githubInstallationId: input.repository.githubInstallationId,
      githubRepositoryId: input.repository.githubRepositoryId,
      permissions: { actions: "read" },
    });
    const response = (await githubRequest(
      "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
      {
        owner: input.repository.owner,
        repo: repoNameFromFullName(input.repository.fullName),
        run_id: parsePositiveSafeInteger(
          input.githubRunId,
          "codex_rotating_workflow_run_id_invalid",
        ),
        headers: { authorization: `Bearer ${token.token}` },
      },
    )) as WorkflowRunResponse;
    return decodeWorkflowRunPullRequest(response.data, {
      eventName: input.eventName,
      githubRepositoryId: input.repository.githubRepositoryId,
      githubRunAttempt: input.githubRunAttempt,
    });
  }

  async resolve(input: {
    readonly repository: ActionRepositoryContext;
    readonly pullRequestNumber: number;
  }) {
    const token = await this.mintRepositoryToken({
      githubInstallationId: input.repository.githubInstallationId,
      githubRepositoryId: input.repository.githubRepositoryId,
      permissions: { pull_requests: "read" },
    });
    const response = (await githubRequest(
      "GET /repos/{owner}/{repo}/pulls/{pull_number}",
      {
        owner: input.repository.owner,
        repo: repoNameFromFullName(input.repository.fullName),
        pull_number: input.pullRequestNumber,
        headers: { authorization: `Bearer ${token.token}` },
      },
    )) as PullRequestResponse;
    return decodePullRequestReviewFacts(response.data, {
      githubRepositoryId: input.repository.githubRepositoryId,
      pullRequestNumber: input.pullRequestNumber,
    });
  }

  private async mintRepositorySecretsToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly permission: SecretPermission;
  }): Promise<{
    readonly token: string;
    readonly expiresAt: Date;
  }> {
    const data = (await this.app.octokit.auth({
      type: "installation",
      installationId: parsePositiveSafeInteger(
        input.githubInstallationId,
        "codex_rotating_secret_installation_id_invalid",
      ),
      repositoryIds: [
        parsePositiveSafeInteger(
          input.githubRepositoryId,
          "codex_rotating_secret_repository_id_invalid",
        ),
      ],
      permissions: {
        secrets: input.permission,
      },
    })) as InstallationTokenResponse;
    if (typeof data.token !== "string" || data.token.length === 0) {
      throw new Error("codex_rotating_secret_token_invalid_response");
    }
    if (typeof data.expiresAt !== "string") {
      throw new Error("codex_rotating_secret_token_invalid_response");
    }
    const expiresAt = new Date(data.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error("codex_rotating_secret_token_invalid_response");
    }
    if (data.permissions?.secrets !== input.permission) {
      throw new Error("codex_rotating_secret_token_permissions_mismatch");
    }

    return { token: data.token, expiresAt };
  }

  private async mintRepositoryToken(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly permissions: InstallationPermission;
  }): Promise<{
    readonly token: string;
    readonly expiresAt: Date;
  }> {
    const data = (await this.app.octokit.auth({
      type: "installation",
      installationId: parsePositiveSafeInteger(
        input.githubInstallationId,
        "codex_rotating_installation_id_invalid",
      ),
      repositoryIds: [
        parsePositiveSafeInteger(
          input.githubRepositoryId,
          "codex_rotating_repository_id_invalid",
        ),
      ],
      permissions: input.permissions,
    })) as InstallationTokenResponse;
    if (typeof data.token !== "string" || data.token.length === 0) {
      throw new Error("codex_rotating_installation_token_invalid_response");
    }
    if (typeof data.expiresAt !== "string") {
      throw new Error("codex_rotating_installation_token_invalid_response");
    }
    const expiresAt = new Date(data.expiresAt);
    if (!Number.isFinite(expiresAt.getTime())) {
      throw new Error("codex_rotating_installation_token_invalid_response");
    }
    if (
      input.permissions.actions &&
      data.permissions?.actions !== input.permissions.actions
    ) {
      throw new Error("codex_rotating_installation_token_permissions_mismatch");
    }
    if (
      input.permissions.contents &&
      data.permissions?.contents !== input.permissions.contents
    ) {
      throw new Error("codex_rotating_installation_token_permissions_mismatch");
    }
    if (
      input.permissions.pull_requests &&
      data.permissions?.pull_requests !== input.permissions.pull_requests
    ) {
      throw new Error("codex_rotating_installation_token_permissions_mismatch");
    }
    if (
      input.permissions.contents === "read" &&
      input.permissions.pull_requests === "read" &&
      (typeof data.permissions !== "object" ||
        Object.entries(data.permissions).some(
          ([permission, level]) =>
            !(
              (permission === "contents" && level === "read") ||
              (permission === "pull_requests" && level === "read") ||
              (permission === "metadata" && level === "read")
            ),
        ))
    ) {
      throw new Error("codex_rotating_installation_token_permissions_mismatch");
    }
    return { token: data.token, expiresAt };
  }

  private async readBranchHead(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly branch: string;
  }): Promise<string> {
    const response = (await githubRequest(
      "GET /repos/{owner}/{repo}/branches/{branch}",
      {
        owner: input.owner,
        repo: input.repo,
        branch: input.branch,
        headers: { authorization: `Bearer ${input.token}` },
      },
    )) as BranchResponse;
    return decodeBranchHead(response.data, input.branch);
  }

  private async assertWorkflowRevisionOnBranchHistory(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly workflowSha: string;
    readonly branchHead: string;
  }): Promise<void> {
    const workflowSha = requireCommitSha(input.workflowSha);
    const branchHead = requireCommitSha(input.branchHead);
    if (workflowSha === branchHead) {
      return;
    }

    const response = (await githubRequest(
      "GET /repos/{owner}/{repo}/compare/{basehead}",
      {
        owner: input.owner,
        repo: input.repo,
        basehead: `${workflowSha}...${branchHead}`,
        headers: { authorization: `Bearer ${input.token}` },
      },
    )) as CompareResponse;
    if (decodeCompareStatus(response.data) !== "ahead") {
      throw new Error("codex_rotating_workflow_source_not_current_branch_head");
    }
  }

  private async readWorkflowAtRef(input: {
    readonly token: string;
    readonly owner: string;
    readonly repo: string;
    readonly path: string;
    readonly ref: string;
    readonly missingAllowed?: boolean;
  }): Promise<string | null> {
    try {
      const response = (await githubRequest(
        "GET /repos/{owner}/{repo}/contents/{path}",
        {
          owner: input.owner,
          repo: input.repo,
          path: input.path,
          ref: input.ref,
          headers: { authorization: `Bearer ${input.token}` },
        },
      )) as ContentsResponse;
      return decodeWorkflowContent(response.data);
    } catch (error) {
      if (
        input.missingAllowed === true &&
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        error.status === 404
      ) {
        return null;
      }
      throw error;
    }
  }
}

function decodeRepositoryDefaultBranch(
  data: unknown,
  expectedRepositoryId: string,
  expectedRepositoryFullName: string,
): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_repository_invalid_response");
  }
  const repository = data as {
    readonly id?: unknown;
    readonly full_name?: unknown;
    readonly default_branch?: unknown;
  };
  if (
    typeof repository.id !== "number" ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0 ||
    String(repository.id ?? "") !== expectedRepositoryId ||
    repository.full_name !== expectedRepositoryFullName ||
    typeof repository.default_branch !== "string" ||
    repository.default_branch.length === 0 ||
    repository.default_branch.trim() !== repository.default_branch
  ) {
    throw new Error("codex_rotating_repository_identity_mismatch");
  }
  return repository.default_branch;
}

function normalizeWorkflowApiUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("codex_rotating_workflow_api_url_invalid");
  }
  if (
    url.protocol !== "https:" ||
    isLoopbackHostname(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.pathname !== "/"
  ) {
    throw new Error("codex_rotating_workflow_api_url_invalid");
  }
  return url.toString().replace(/\/$/, "");
}

function requireCommitSha(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) {
    throw new Error("codex_rotating_workflow_source_commit_invalid");
  }
  return normalized;
}

function decodeCompareStatus(data: unknown): string {
  const status = (data as { readonly status?: unknown } | null)?.status;
  if (
    status !== "ahead" &&
    status !== "behind" &&
    status !== "diverged" &&
    status !== "identical"
  ) {
    throw new Error("codex_rotating_workflow_compare_invalid_response");
  }
  return status;
}

function normalizeCommitSha(value: unknown): string | null {
  return typeof value === "string" && isCommitSha(value)
    ? value.toLowerCase()
    : null;
}

function isCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

function decodeBranchHead(data: unknown, expectedBranch: string): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_branch_invalid_response");
  }
  const branch = data as {
    readonly name?: unknown;
    readonly commit?: { readonly sha?: unknown };
  };
  const sha = branch.commit?.sha;
  if (
    branch.name !== expectedBranch ||
    typeof sha !== "string" ||
    !isCommitSha(sha)
  ) {
    throw new Error("codex_rotating_branch_identity_mismatch");
  }
  return sha.toLowerCase();
}

function decodeWorkflowRunPullRequest(
  data: unknown,
  expected: {
    readonly eventName: "pull_request_target";
    readonly githubRepositoryId: string;
    readonly githubRunAttempt: string;
  },
): number {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_workflow_run_invalid_response");
  }
  const run = data as {
    readonly event?: unknown;
    readonly run_attempt?: unknown;
    readonly repository?: { readonly id?: unknown };
    readonly pull_requests?: readonly { readonly number?: unknown }[];
  };
  const expectedAttempt = parsePositiveSafeInteger(
    expected.githubRunAttempt,
    "codex_rotating_workflow_run_attempt_invalid",
  );
  if (
    run.event !== expected.eventName ||
    run.run_attempt !== expectedAttempt ||
    String(run.repository?.id ?? "") !== expected.githubRepositoryId ||
    !Array.isArray(run.pull_requests) ||
    run.pull_requests.length !== 1
  ) {
    throw new Error("codex_rotating_workflow_run_identity_mismatch");
  }
  const pullRequestNumber = run.pull_requests[0]?.number;
  if (
    !Number.isSafeInteger(pullRequestNumber) ||
    (pullRequestNumber as number) <= 0
  ) {
    throw new Error("codex_rotating_workflow_run_pull_request_invalid");
  }
  return pullRequestNumber as number;
}

function decodePullRequestReviewFacts(
  data: unknown,
  expected: {
    readonly githubRepositoryId: string;
    readonly pullRequestNumber: number;
  },
) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_pull_request_facts_invalid_response");
  }
  const pullRequest = data as {
    readonly number?: unknown;
    readonly additions?: unknown;
    readonly deletions?: unknown;
    readonly base?: { readonly repo?: { readonly id?: unknown } | null };
    readonly head?: { readonly sha?: unknown };
  };
  const headSha = normalizeCommitSha(pullRequest.head?.sha);
  if (
    pullRequest.number !== expected.pullRequestNumber ||
    String(pullRequest.base?.repo?.id ?? "") !== expected.githubRepositoryId ||
    headSha === null ||
    !Number.isSafeInteger(pullRequest.additions) ||
    (pullRequest.additions as number) < 0 ||
    !Number.isSafeInteger(pullRequest.deletions) ||
    (pullRequest.deletions as number) < 0
  ) {
    throw new Error("codex_rotating_pull_request_facts_identity_mismatch");
  }
  return {
    pullRequestNumber: expected.pullRequestNumber,
    headSha,
    additions: pullRequest.additions as number,
    deletions: pullRequest.deletions as number,
  };
}

function parsePositiveSafeInteger(value: string, errorCode: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(errorCode);
  }
  return parsed;
}

function repoNameFromFullName(fullName: string): string {
  const [, repo] = fullName.split("/");
  if (!repo) {
    throw new Error("codex_rotating_invalid_repository_full_name");
  }
  return repo;
}

function readWorkflowBranchRef(input: {
  readonly workflowRef: string;
  readonly repositoryFullName: string;
  readonly workflowPath: string;
}): string {
  const prefix = `${input.repositoryFullName}/${input.workflowPath}@refs/heads/`;
  if (!input.workflowRef.startsWith(prefix)) {
    throw new Error("codex_rotating_workflow_source_not_branch_revision");
  }
  const branch = input.workflowRef.slice(prefix.length);
  const branchComponents = branch.split("/");
  if (
    branch.length === 0 ||
    branch.length > 255 ||
    branch === "@" ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branchComponents.some(
      (component) => component.startsWith(".") || component.endsWith(".lock"),
    ) ||
    branch.includes("..") ||
    branch.includes("@{") ||
    branch.includes("//") ||
    Array.from(branch).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return (
        codePoint <= 0x20 ||
        codePoint === 0x7f ||
        "~^:?*[]\\".includes(character)
      );
    })
  ) {
    throw new Error("codex_rotating_workflow_branch_ref_invalid");
  }
  return branch;
}

function decodeWorkflowContent(data: unknown): string {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("codex_rotating_workflow_content_invalid_response");
  }
  const record = data as {
    readonly type?: unknown;
    readonly encoding?: unknown;
    readonly content?: unknown;
  };
  if (record.type !== "file" || record.encoding !== "base64") {
    throw new Error("codex_rotating_workflow_content_invalid_response");
  }
  if (typeof record.content !== "string") {
    throw new Error("codex_rotating_workflow_content_invalid_response");
  }
  const compacted = record.content.replace(/\s+/g, "");
  if (compacted.length === 0 || compacted.length > 128 * 1024) {
    throw new Error("codex_rotating_workflow_content_too_large");
  }
  return Buffer.from(compacted, "base64").toString("utf8");
}

function decodeWorkflowBlobSha(data: unknown): string {
  const sha = (data as { readonly sha?: unknown } | null)?.sha;
  if (
    typeof sha !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)
  ) {
    throw new Error("codex_rotating_workflow_blob_sha_invalid_response");
  }
  return sha.toLowerCase();
}

function decodeContentsWriteCommitSha(data: unknown): string {
  const sha = (data as ContentsWriteResponse["data"])?.commit?.sha;
  if (typeof sha !== "string" || !/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error("codex_rotating_workflow_commit_sha_invalid_response");
  }
  return sha.toLowerCase();
}

function extractCanonicalRefreshCron(source: string): string | null {
  if (!/^\s{2}codex-refresh:\s*$/mu.test(source)) return null;
  const match = /^\s{4}- cron: ("(?:[^"\\]|\\.)*")\s*$/mu.exec(source);
  if (!match?.[1]) {
    throw new Error("codex_rotating_workflow_refresh_cron_invalid");
  }
  const value = JSON.parse(match[1]);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("codex_rotating_workflow_refresh_cron_invalid");
  }
  return value;
}
