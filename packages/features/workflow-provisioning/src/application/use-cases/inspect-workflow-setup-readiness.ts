import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import { reviewRouterApiUrlsMatch } from "@reviewrouter/shared";
import type { RepositoryWorkflowProbePort } from "../ports/repository-workflow-probe-port";
import type { ProviderKind } from "@reviewrouter/features-review-providers";
import {
  areManagedWorkflowDocumentsAttested,
  areWorkflowDocumentsSemanticallyEqual,
  assertSameVersionedProviderSecretNamespace,
  type CodexRotatingReviewActionV2Mode,
  type CodexRotatingT0WorkflowSchemaVersion,
  type VersionedProviderSecretNamespace,
  isVersionedSecretNamespaceCodexWorkflowSchemaVersion,
  readCanonicalCodexRotatingT0WorkflowSourceMetadata,
  readCanonicalIsolatedQualityWorkflowSourceMetadata,
  scanCodexRotatingAdvisoryWorkflow,
  codexWorkflowPathForRepository,
  isolatedQualityWorkflowPath,
} from "@reviewrouter/features-codex-oauth-rotating";
import type { ReviewRouterMcpSecrets } from "@reviewrouter/protocol-review-workflow";
import {
  defaultCodexRotatingWorkflowPath,
  defaultInteractionWorkflowPath,
  defaultWorkflowPath,
  getCodexRotatingWorkflowSetupContentMarkerGroups,
  getWorkflowSetupContentMarkerGroups,
  renderCodexRotatingInteractionWorkflow,
  type ReviewRouterDiscussionMode,
  renderAccountGatewayWorkflow,
  renderAccountGatewayInteractionWorkflow,
  renderProviderApiWorkflow,
  renderClaudeSubscriptionWorkflow,
  renderReviewRouterSecretsCaller,
  readManagedReviewRouterCallerSource,
  readReviewRouterCallerSource,
  reviewRouterWorkflowContract,
} from "../../domain/workflow-template";

export type WorkflowSetupReadinessInput = {
  readonly secretsRuntimeActionRef?: string;
  readonly githubInstallationId: string;
  readonly githubRepositoryId: string;
  readonly repositoryFullName: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly actionRef: string;
  readonly codexSessionMode?: "account-gateway";
  readonly gatewayInteractionRuntimeSha?: string;
  readonly mcpSecrets?: ReviewRouterMcpSecrets;
  readonly providerApiAuthMode?: ProviderApiAuthMode;
  readonly subscriptionAuthMode?: "claude-oauth";
  readonly providerKind?: ProviderKind;
  readonly discussionMode?: ReviewRouterDiscussionMode;
  readonly conflictReviewFallbackEnabled?: boolean;
  readonly forkAgenticSandboxEnabled?: boolean;
  readonly codexRotatingProviderInstanceId?: string;
  readonly codexRotatingClaudeCodeOAuthTokenSecret?: boolean;
  readonly codexRotatingOpenRouterApiKeySecret?: boolean;
  readonly codexRotatingMimoTokenPlanApiKeySecret?: boolean;
  readonly codexRotatingReviewActionV2Mode?: CodexRotatingReviewActionV2Mode;
  readonly codexRotatingWorkflowSchemaVersion?: CodexRotatingT0WorkflowSchemaVersion;
  readonly codexRotatingWorkflowSecretNamespace?: VersionedProviderSecretNamespace;
};

/** Pure admission and URL requirements shared by the host adapter and probe policy. */
export function workflowSetupReadinessMode(
  input: WorkflowSetupReadinessInput,
): "invalid" | "secrets" | "managed" | "rotating" | "legacy" {
  if (
    input.codexSessionMode !== "account-gateway" &&
    input.mcpSecrets &&
    Object.keys(input.mcpSecrets).length
  )
    return "invalid";
  if (
    input.discussionMode === "suggest" &&
    !(
      (input.codexSessionMode === "account-gateway" &&
        input.gatewayInteractionRuntimeSha) ||
      (input.codexRotatingProviderInstanceId && !input.codexSessionMode)
    )
  )
    return "invalid";
  if (
    input.secretsRuntimeActionRef &&
    !input.codexSessionMode &&
    !input.providerApiAuthMode &&
    !input.subscriptionAuthMode &&
    !input.codexRotatingProviderInstanceId &&
    !input.conflictReviewFallbackEnabled &&
    !input.forkAgenticSandboxEnabled
  )
    return "secrets";
  if (
    input.codexSessionMode === "account-gateway" ||
    input.providerApiAuthMode !== undefined ||
    input.subscriptionAuthMode !== undefined
  ) {
    if (
      [
        input.codexSessionMode,
        input.providerApiAuthMode,
        input.subscriptionAuthMode,
      ].filter((mode) => mode !== undefined).length !== 1 ||
      (input.subscriptionAuthMode !== undefined &&
        input.subscriptionAuthMode !== "claude-oauth")
    )
      return "invalid";
    if (
      input.codexRotatingProviderInstanceId ||
      input.codexRotatingWorkflowSecretNamespace ||
      input.codexRotatingWorkflowSchemaVersion !== undefined ||
      input.codexRotatingReviewActionV2Mode ||
      input.codexRotatingClaudeCodeOAuthTokenSecret ||
      input.codexRotatingOpenRouterApiKeySecret ||
      input.conflictReviewFallbackEnabled ||
      input.forkAgenticSandboxEnabled ||
      input.providerKind
    )
      return "invalid";
    return "managed";
  }
  if (input.codexRotatingProviderInstanceId) {
    if (
      codexWorkflowPathForRepository({
        repositoryId: input.githubRepositoryId,
        repositoryFullName: input.repositoryFullName,
      }) === isolatedQualityWorkflowPath &&
      input.defaultBranch !== "main"
    )
      return "invalid";
    return "rotating";
  }
  return "legacy";
}

export async function isWorkflowSetupAlreadyCurrent(
  input: WorkflowSetupReadinessInput,
  dependencies: {
    readonly workflowProbe: RepositoryWorkflowProbePort;
    readonly publicApiUrl: string;
  },
): Promise<boolean> {
  const mode = workflowSetupReadinessMode(input);
  if (mode === "invalid") return false;
  if (mode === "secrets") {
    const expected = renderReviewRouterSecretsCaller({
      actionRef: input.secretsRuntimeActionRef!,
      apiUrl: dependencies.publicApiUrl,
    });
    const check = await dependencies.workflowProbe.probeWorkflow({
      githubInstallationId: input.githubInstallationId,
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
      workflowPath: defaultWorkflowPath,
      expectedActionRef: input.secretsRuntimeActionRef!.replace(
        "@",
        "/.github/workflows/reviewrouter-secrets-runtime.yml@",
      ),
      expectedContentValidator: (workflow) =>
        areWorkflowDocumentsSemanticallyEqual(workflow, expected),
    });
    return (
      check.status === "present" &&
      check.expectedActionRefFound &&
      check.expectedContentMarkersFound === true
    );
  }

  if (mode === "managed") {
    let expected: ReturnType<typeof renderAccountGatewayWorkflow>;
    try {
      expected =
        input.providerApiAuthMode !== undefined
          ? renderProviderApiWorkflow({
              providerApiAuthMode: input.providerApiAuthMode,
              actionRef: input.actionRef,
              apiUrl: dependencies.publicApiUrl,
            })
          : input.subscriptionAuthMode === "claude-oauth"
            ? renderClaudeSubscriptionWorkflow({
                actionRef: input.actionRef,
                apiUrl: dependencies.publicApiUrl,
              })
            : renderAccountGatewayWorkflow({
                actionRef: input.actionRef,
                apiUrl: dependencies.publicApiUrl,
                githubRepositoryId: input.githubRepositoryId,
                ...(input.mcpSecrets !== undefined
                  ? { mcpSecrets: input.mcpSecrets }
                  : {}),
              });
    } catch {
      return false;
    }
    const check = await dependencies.workflowProbe.probeWorkflow({
      githubInstallationId: input.githubInstallationId,
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
      workflowPath: expected.path,
      expectedActionRef:
        input.providerApiAuthMode !== undefined ||
        input.subscriptionAuthMode !== undefined
          ? `${reviewRouterWorkflowContract.runtimeRepository}/.github/workflows/reviewrouter-execution-reusable.yml@${readManagedReviewRouterCallerSource(expected.content).runtimeRef}`
          : `${reviewRouterWorkflowContract.runtimeRepository}/${reviewRouterWorkflowContract.runtimePath}@${readReviewRouterCallerSource(expected.content).runtimeRef}`,
      expectedContentValidator: (workflow) =>
        areWorkflowDocumentsSemanticallyEqual(workflow, expected.content),
    });
    if (
      check.status !== "present" ||
      !check.expectedActionRefFound ||
      check.expectedContentMarkersFound !== true
    )
      return false;
    if (
      input.codexSessionMode === "account-gateway" &&
      input.gatewayInteractionRuntimeSha
    ) {
      let interaction: ReturnType<
        typeof renderAccountGatewayInteractionWorkflow
      >;
      try {
        interaction = renderAccountGatewayInteractionWorkflow({
          runtimeSha: input.gatewayInteractionRuntimeSha,
          apiUrl: dependencies.publicApiUrl,
        });
      } catch {
        return false;
      }
      const interactionCheck = await dependencies.workflowProbe.probeWorkflow({
        githubInstallationId: input.githubInstallationId,
        owner: input.owner,
        name: input.name,
        defaultBranch: input.defaultBranch,
        workflowPath: interaction.path,
        expectedActionRef: `${reviewRouterWorkflowContract.runtimeRepository}/.github/workflows/reviewrouter-interaction-reusable.yml@${input.gatewayInteractionRuntimeSha}`,
        expectedContentValidator: (workflow) =>
          areWorkflowDocumentsSemanticallyEqual(workflow, interaction.content),
      });
      if (
        interactionCheck.status !== "present" ||
        !interactionCheck.expectedActionRefFound ||
        interactionCheck.expectedContentMarkersFound !== true
      )
        return false;
    }
    const competingChecks = await Promise.all(
      [
        defaultWorkflowPath,
        defaultCodexRotatingWorkflowPath,
        ...(input.codexSessionMode === "account-gateway" &&
        input.gatewayInteractionRuntimeSha
          ? []
          : [defaultInteractionWorkflowPath]),
      ].map((workflowPath) =>
        dependencies.workflowProbe.probeWorkflow({
          githubInstallationId: input.githubInstallationId,
          owner: input.owner,
          name: input.name,
          defaultBranch: input.defaultBranch,
          workflowPath,
          expectedActionRef: input.actionRef,
        }),
      ),
    );
    return competingChecks.every((competing) => competing.status === "missing");
  }

  const codexWorkflowPath = input.codexRotatingProviderInstanceId
    ? codexWorkflowPathForRepository({
        repositoryId: input.githubRepositoryId,
        repositoryFullName: input.repositoryFullName,
      })
    : null;
  const isolatedCodexWorkflow =
    codexWorkflowPath === isolatedQualityWorkflowPath;
  const expectedPublicApiUrl = input.codexRotatingProviderInstanceId
    ? dependencies.publicApiUrl
    : undefined;
  const workflowCheck = await dependencies.workflowProbe.probeWorkflow({
    githubInstallationId: input.githubInstallationId,
    owner: input.owner,
    name: input.name,
    defaultBranch: input.defaultBranch,
    workflowPath: codexWorkflowPath ?? defaultWorkflowPath,
    expectedActionRef: input.actionRef,
    ...(input.codexRotatingProviderInstanceId
      ? {
          ...(!isolatedCodexWorkflow
            ? {
                expectedContentMarkerGroups:
                  getCodexRotatingWorkflowSetupContentMarkerGroups({
                    providerInstanceId: input.codexRotatingProviderInstanceId,
                    claudeCodeOAuthTokenSecret:
                      input.codexRotatingClaudeCodeOAuthTokenSecret === true,
                    openRouterApiKeySecret:
                      input.codexRotatingOpenRouterApiKeySecret === true,
                    mimoTokenPlanApiKeySecret:
                      input.codexRotatingMimoTokenPlanApiKeySecret === true,
                    forkAgenticSandboxEnabled:
                      input.forkAgenticSandboxEnabled === true,
                    reviewActionV2Mode: input.codexRotatingReviewActionV2Mode,
                    workflowSchemaVersion:
                      input.codexRotatingWorkflowSchemaVersion,
                    ...(input.codexRotatingWorkflowSecretNamespace
                      ? {
                          activeSecretNamespace:
                            input.codexRotatingWorkflowSecretNamespace,
                        }
                      : {}),
                  }),
              }
            : {}),
          ...(isVersionedSecretNamespaceCodexWorkflowSchemaVersion(
            input.codexRotatingWorkflowSchemaVersion,
          ) && input.codexRotatingWorkflowSecretNamespace
            ? {
                expectedContentValidator: (workflow: string) =>
                  isCanonicalVersionedCodexWorkflowReady({
                    workflow,
                    isolated: isolatedCodexWorkflow,
                    expectedActionRef: input.actionRef,
                    expectedProviderInstanceId:
                      input.codexRotatingProviderInstanceId!,
                    expectedWorkflowSchemaVersion:
                      input.codexRotatingWorkflowSchemaVersion!,
                    expectedSecretNamespace:
                      input.codexRotatingWorkflowSecretNamespace!,
                    expectedApiUrl: expectedPublicApiUrl!,
                  }),
              }
            : {}),
        }
      : input.providerKind || input.conflictReviewFallbackEnabled === true
        ? {
            expectedContentMarkerGroups: getWorkflowSetupContentMarkerGroups({
              providerKind: input.providerKind,
              conflictReviewFallbackEnabled:
                input.conflictReviewFallbackEnabled === true,
            }),
          }
        : {}),
  });

  const managedWorkflowCurrent =
    workflowCheck.status === "present" &&
    workflowCheck.expectedActionRefFound &&
    (workflowCheck.expectedContentMarkersFound ?? true);
  if (!managedWorkflowCurrent || !input.codexRotatingProviderInstanceId) {
    return managedWorkflowCurrent;
  }

  let expectedInteractionWorkflow: string;
  try {
    expectedInteractionWorkflow =
      renderCodexRotatingInteractionWorkflow({
        actionRef: input.actionRef,
        apiUrl: expectedPublicApiUrl!,
        runtimeConfigMode: "oidc",
        discussionMode: input.discussionMode,
      });
  } catch {
    return false;
  }

  const interactionWorkflowCheck =
    await dependencies.workflowProbe.probeWorkflow({
      githubInstallationId: input.githubInstallationId,
      owner: input.owner,
      name: input.name,
      defaultBranch: input.defaultBranch,
      workflowPath: defaultInteractionWorkflowPath,
      expectedActionRef: input.actionRef,
      expectedContentValidator: (workflow: string) =>
        areManagedWorkflowDocumentsAttested(
          workflow,
          expectedInteractionWorkflow,
        ),
    });

  const interactionWorkflowCurrent =
    interactionWorkflowCheck.status === "present" &&
    interactionWorkflowCheck.expectedContentMarkersFound === true;
  if (!interactionWorkflowCurrent || !isolatedCodexWorkflow) {
    return interactionWorkflowCurrent;
  }

  const competingWorkflowChecks = await Promise.all(
    [defaultWorkflowPath, defaultCodexRotatingWorkflowPath].map(
      (workflowPath) =>
        dependencies.workflowProbe.probeWorkflow({
          githubInstallationId: input.githubInstallationId,
          owner: input.owner,
          name: input.name,
          defaultBranch: input.defaultBranch,
          workflowPath,
          expectedActionRef: input.actionRef,
        }),
    ),
  );

  return competingWorkflowChecks.every((check) => check.status === "missing");
}

function isCanonicalVersionedCodexWorkflowReady(input: {
  readonly workflow: string;
  readonly expectedActionRef: string;
  readonly expectedProviderInstanceId: string;
  readonly expectedWorkflowSchemaVersion: CodexRotatingT0WorkflowSchemaVersion;
  readonly expectedSecretNamespace: VersionedProviderSecretNamespace;
  readonly expectedApiUrl: string;
  readonly isolated: boolean;
}): boolean {
  try {
    if (
      !input.isolated &&
      !scanCodexRotatingAdvisoryWorkflow(input.workflow).valid
    ) {
      return false;
    }
    const metadata = input.isolated
      ? readCanonicalIsolatedQualityWorkflowSourceMetadata(input.workflow)
      : readCanonicalCodexRotatingT0WorkflowSourceMetadata(input.workflow);
    if (
      metadata.actionRef !== input.expectedActionRef ||
      !reviewRouterApiUrlsMatch(metadata.apiUrl, input.expectedApiUrl) ||
      metadata.providerInstanceId !== input.expectedProviderInstanceId ||
      metadata.workflowSchemaVersion !== input.expectedWorkflowSchemaVersion ||
      !metadata.secretNamespace
    ) {
      return false;
    }
    assertSameVersionedProviderSecretNamespace({
      expected: input.expectedSecretNamespace,
      actual: metadata.secretNamespace,
    });
    return true;
  } catch {
    return false;
  }
}
