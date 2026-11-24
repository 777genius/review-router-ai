import {
  isCurrentWorkflowSetupAuthority,
  type WorkflowSetupArtifact,
  type WorkflowSetupAttempt,
} from "../../domain/workflow-setup-authority.js";
import type {
  CurrentWorkflowSetupQueryPort,
  CurrentWorkflowSetupScope,
} from "../ports/current-workflow-setup-query-port.js";

export type AssertCurrentWorkflowSetupInput = Readonly<{
  scope: CurrentWorkflowSetupScope;
  expectedBaseBranch: string;
  expectedAttempt: WorkflowSetupAttempt | null;
  historicalMergedSetupPullRequest: boolean;
  verifiedArtifact: WorkflowSetupArtifact;
}>;

/**
 * Re-read authority after asynchronous probes and before activation/settlement.
 * The storage adapter's final atomic compare-and-swap remains mandatory.
 */
export async function assertCurrentWorkflowSetup(
  input: AssertCurrentWorkflowSetupInput,
  dependencies: { readonly query: CurrentWorkflowSetupQueryPort },
): Promise<void> {
  const currentRepository = await dependencies.query.findEligibleRepository(
    input.scope,
  );
  // Preserve the original read order, including when the repository disappeared.
  const currentAttempt = await dependencies.query.findCurrentAttempt(
    input.scope.repositoryId,
  );
  if (
    !isCurrentWorkflowSetupAuthority({
      observedRepositoryDefaultBranch: currentRepository?.defaultBranch,
      expectedBaseBranch: input.expectedBaseBranch,
      expectedAttempt: input.expectedAttempt,
      currentAttempt,
      workspaceId: input.scope.workspaceId,
      installationId: input.scope.installationId,
      historicalMergedSetupPullRequest: input.historicalMergedSetupPullRequest,
      verifiedArtifact: input.verifiedArtifact,
    })
  ) {
    throw new Error("workflow_provisioning_match_not_found");
  }
}
