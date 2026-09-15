import type { RepositoryWorkflowProbePort } from "@reviewrouter/features-repo-health";
import type { ProviderKind } from "@reviewrouter/features-review-providers";
import {
  areWorkflowDocumentsSemanticallyEqual,
  assertSameVersionedProviderSecretNamespace,
  type CodexRotatingReviewActionV2Mode,
  type CodexRotatingT0WorkflowSchemaVersion,
  type VersionedProviderSecretNamespace,
  defaultCodexRotatingWorkflowPath,
  defaultInteractionWorkflowPath,
  defaultWorkflowPath,
  getCodexRotatingWorkflowSetupContentMarkerGroups,
  getWorkflowSetupContentMarkerGroups,
  isVersionedSecretNamespaceCodexWorkflowSchemaVersion,
  readCanonicalCodexRotatingT0WorkflowSourceMetadata,
  readCanonicalIsolatedQualityWorkflowSourceMetadata,
  renderCanonicalCodexRotatingInteractionWorkflowV3,
  scanCodexRotatingAdvisoryWorkflow,
  codexWorkflowPathForRepository,
  isolatedQualityWorkflowPath,
  type ReviewRouterDiscussionMode,
} from "@reviewrouter/features-workflow-provisioning";
import { resolveWorkflowPublicApiUrl } from "./workflow-public-api-url";

export type WorkflowSetupReadinessInput = {
  readonly githubInstallationId: string;
  readonly githubRepositoryId: string;
  readonly repositoryFullName: string;
  readonly owner: string;
  readonly name: string;
  readonly defaultBranch: string;
  readonly actionRef: string;
  readonly providerKind?: ProviderKind;
  readonly discussionMode?: ReviewRouterDiscussionMode;
  readonly conflictReviewFallbackEnabled?: boolean;
  readonly forkAgenticSandboxEnabled?: boolean;
  readonly codexRotatingProviderInstanceId?: string;
  readonly codexRotatingClaudeCodeOAuthTokenSecret?: boolean;
  readonly codexRotatingOpenRouterApiKeySecret?: boolean;
  readonly codexRotatingReviewActionV2Mode?: CodexRotatingReviewActionV2Mode;
  readonly codexRotatingWorkflowSchemaVersion?: CodexRotatingT0WorkflowSchemaVersion;
  readonly codexRotatingWorkflowSecretNamespace?: VersionedProviderSecretNamespace;
};

export async function isWorkflowSetupAlreadyCurrent(
  input: WorkflowSetupReadinessInput,
  dependencies: {
    readonly workflowProbe: RepositoryWorkflowProbePort;
    readonly resolvePublicApiUrl?: () => string;
  },
): Promise<boolean> {
  if (input.discussionMode === "suggest") {
    return false;
  }

  const codexWorkflowPath = input.codexRotatingProviderInstanceId
    ? codexWorkflowPathForRepository({
        repositoryId: input.githubRepositoryId,
        repositoryFullName: input.repositoryFullName,
      })
    : null;
  const isolatedCodexWorkflow =
    codexWorkflowPath === isolatedQualityWorkflowPath;
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
      renderCanonicalCodexRotatingInteractionWorkflowV3({
        actionRef: input.actionRef,
        apiUrl:
          dependencies.resolvePublicApiUrl?.() ?? resolveWorkflowPublicApiUrl(),
        runtimeConfigMode: "oidc",
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
        areWorkflowDocumentsSemanticallyEqual(
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
