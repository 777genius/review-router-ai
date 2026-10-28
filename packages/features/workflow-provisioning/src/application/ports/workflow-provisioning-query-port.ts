import type { ReviewRouterWorkflowStyle } from "../../domain/workflow-template";
import type { WorkflowRequirement } from "../../domain/workflow-transport";

export type RepositoryWorkflowProvisioningSummary = {
  readonly repositoryId: string;
  readonly status: "not_started" | "setup_pr_open" | "configured" | "failed";
  readonly branch: string;
  readonly workflowPath: string;
  readonly workflowStyle: ReviewRouterWorkflowStyle;
  readonly actionVersion: string;
  readonly pullRequestUrl: string | null;
  readonly errorMessage: string | null;
  /** Requirement of the workflow last confirmed installed; null is unknown. */
  readonly installedWorkflowRequirement: WorkflowRequirement | null;
  readonly updatedAt: Date;
};

export interface WorkflowProvisioningQueryPort {
  listLatestForRepositories(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }): Promise<readonly RepositoryWorkflowProvisioningSummary[]>;
}
