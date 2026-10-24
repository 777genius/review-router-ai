import type { WorkflowProvisioningStatus } from "../../domain/workflow-provisioning";
import type { ReviewRouterWorkflowStyle } from "../../domain/workflow-template";
import type { WorkflowRequirement } from "../../domain/workflow-transport";

export type WorkflowProvisioningScope = {
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly installationId: string;
};

export type WorkflowProvisioningAttempt = WorkflowProvisioningScope & {
  readonly attemptId: string;
  readonly branch: string;
  readonly revision: number;
};

export type WorkflowProvisioningRecord = WorkflowProvisioningScope & {
  readonly status: WorkflowProvisioningStatus;
  readonly branch: string;
  readonly workflowPath: string;
  readonly workflowStyle: ReviewRouterWorkflowStyle;
  readonly actionVersion: string;
  /** What the workflow this record installs is rendered for. */
  readonly workflowRequirement: WorkflowRequirement;
  readonly pullRequestHeadSha?: string | null;
  readonly pullRequestUrl?: string | null;
  readonly errorMessage?: string | null;
};

export interface WorkflowProvisioningRepositoryPort {
  beginAttempt(
    record: WorkflowProvisioningRecord,
  ): Promise<WorkflowProvisioningAttempt>;
  markSetupPullRequestOpen(
    record: WorkflowProvisioningRecord & WorkflowProvisioningAttempt,
  ): Promise<void>;
  markFailed(
    record: WorkflowProvisioningRecord & WorkflowProvisioningAttempt,
  ): Promise<void>;
}
