import { reviewRouterWorkflowContract } from "@reviewrouter/protocol-review-workflow";
import type { PrismaClient } from "@prisma/client";
import type {
  WorkflowProvisioningAttempt,
  WorkflowProvisioningRecord,
  WorkflowProvisioningScope,
} from "../../application/ports/workflow-provisioning-repository-port";
import { preferredSetupBaseBranches } from "../../domain/workflow-provisioning";
import { workflowProvisioningTransaction } from "./workflow-provisioning-transaction";
import {
  findProvisioningRepository,
  provisioningScopeWhere,
} from "./workflow-provisioning-scope";

export type WorkflowProvisioningPullRequestIdentity =
  WorkflowProvisioningScope & {
    readonly setupBranch: string | null;
    readonly pullRequestNumber: number | null;
    readonly expectedAttempt?: Pick<
      WorkflowProvisioningAttempt,
      "attemptId" | "revision"
    >;
  };

type Failure =
  | "setup_pr_closed"
  | "setup_pr_branch_deleted"
  | "setup_pr_wrong_base_branch"
  | "setup_pr_workflow_mismatch";

export class PrismaWorkflowProvisioningStatusAuthority {
  constructor(private readonly prisma: PrismaClient) {}

  async markConfigured(
    input: WorkflowProvisioningPullRequestIdentity & {
      readonly baseBranch: string;
      readonly headSha: string | null;
    },
  ): Promise<boolean> {
    return this.transition(input, {
      status: "configured",
      baseBranch: input.baseBranch,
      headSha: input.headSha,
    });
  }

  async assertConfigured(
    input: WorkflowProvisioningPullRequestIdentity & {
      readonly baseBranch: string;
      readonly headSha: string | null;
    },
  ): Promise<void> {
    if (!(await this.markConfigured(input)))
      throw new Error("workflow_provisioning_match_not_found");
  }

  async markFailed(
    input: WorkflowProvisioningPullRequestIdentity & {
      readonly reason: Failure;
    },
  ): Promise<boolean> {
    return this.transition(input, { status: "failed", reason: input.reason });
  }

  async assertFailed(
    input: WorkflowProvisioningPullRequestIdentity & {
      readonly reason: Failure;
    },
  ): Promise<void> {
    if (!(await this.markFailed(input)))
      throw new Error("workflow_provisioning_match_not_found");
  }

  /** Called only after the current installed workflow and provider activation
   * have been verified. The pre-verification snapshot fences asynchronous probes. */
  async confirmInstalledWorkflow(
    input: WorkflowProvisioningRecord & {
      readonly baseBranch: string;
      readonly expectedAttempt: Pick<
        WorkflowProvisioningAttempt,
        "attemptId" | "revision"
      > | null;
    },
  ): Promise<void> {
    await workflowProvisioningTransaction(this.prisma, async (tx) => {
      const repository = await findProvisioningRepository(tx, input);
      if (
        !repository ||
        !preferredSetupBaseBranches(repository.defaultBranch).includes(
          input.baseBranch,
        )
      )
        throw new Error("workflow_provisioning_match_not_found");
      const current = await tx.workflowProvisioning.findUnique({
        where: { repositoryId: input.repositoryId },
      });
      if (!current) {
        if (input.expectedAttempt)
          throw new Error("workflow_provisioning_match_not_found");
        await tx.workflowProvisioning.create({
          data: {
            workspaceId: input.workspaceId,
            repositoryId: input.repositoryId,
            installationId: input.installationId,
            status: "configured",
            branch: input.branch,
            workflowPath: input.workflowPath,
            workflowStyle: input.workflowStyle,
            actionVersion: input.actionVersion,
            attemptWorkflowRequirement: input.workflowRequirement,
            installedWorkflowRequirement: input.workflowRequirement,
          },
        });
        return;
      }
      // Records what the verified artifact was rendered for.
      const recordInstalledRequirement = async () => {
        if (current.installedWorkflowRequirement === input.workflowRequirement)
          return;
        const updated = await tx.workflowProvisioning.updateMany({
          where: {
            id: current.id,
            attemptId: current.attemptId,
            revision: current.revision,
            status: "configured",
          },
          data: { installedWorkflowRequirement: input.workflowRequirement },
        });
        if (updated.count !== 1)
          throw new Error("workflow_provisioning_concurrent_transition");
      };
      if (
        input.expectedAttempt === null &&
        current.workspaceId === input.workspaceId &&
        current.installationId === input.installationId &&
        current.status === "configured" &&
        current.pullRequestUrl === null &&
        current.branch === input.branch &&
        current.workflowPath === input.workflowPath &&
        current.workflowStyle === input.workflowStyle &&
        current.actionVersion === input.actionVersion
      )
        return recordInstalledRequirement();
      // The no-history transfer marker carries placeholder defaults, not an
      // artifact binding. Recognize only that exact unbound shape; ordinary
      // attempts retain all artifact comparisons below.
      const unboundTransfer =
        current.status === "not_started" &&
        current.branch === "reviewrouter/setup" &&
        current.workflowPath === reviewRouterWorkflowContract.callerPath &&
        current.workflowStyle === "explicit" &&
        current.actionVersion === "" &&
        current.pullRequestUrl === null &&
        current.pullRequestHeadSha === null &&
        current.errorMessage === null;
      if (
        current.workspaceId !== input.workspaceId ||
        current.installationId !== input.installationId ||
        current.attemptId !== input.expectedAttempt?.attemptId ||
        (unboundTransfer
          ? !input.actionVersion
          : current.workflowPath !== input.workflowPath ||
            current.workflowStyle !== input.workflowStyle ||
            current.actionVersion !== input.actionVersion)
      )
        throw new Error("workflow_provisioning_match_not_found");
      if (current.status === "configured") return recordInstalledRequirement();
      if (current.revision !== input.expectedAttempt.revision)
        throw new Error("workflow_provisioning_match_not_found");
      const updated = await tx.workflowProvisioning.updateMany({
        where: {
          ...provisioningScopeWhere(input),
          attemptId: current.attemptId,
          revision: current.revision,
          status: current.status,
        },
        data: {
          status: "configured",
          ...(unboundTransfer
            ? {
                workflowPath: input.workflowPath,
                workflowStyle: input.workflowStyle,
                actionVersion: input.actionVersion,
              }
            : {}),
          errorMessage: null,
          installedWorkflowRequirement: input.workflowRequirement,
          revision: { increment: 1 },
        },
      });
      if (updated.count !== 1)
        throw new Error("workflow_provisioning_concurrent_transition");
    });
  }

  private async transition(
    input: WorkflowProvisioningPullRequestIdentity,
    next:
      | { status: "configured"; baseBranch: string; headSha: string | null }
      | { status: "failed"; reason: Failure },
  ): Promise<boolean> {
    return workflowProvisioningTransaction(this.prisma, async (tx) => {
      const repository = await findProvisioningRepository(tx, input);
      if (
        !repository ||
        (next.status === "configured" &&
          !preferredSetupBaseBranches(repository.defaultBranch).includes(
            next.baseBranch,
          ))
      )
        return false;
      const current = await tx.workflowProvisioning.findFirst({
        where: provisioningScopeWhere(input),
      });
      // A reused branch alone never establishes which attempt created a PR.
      if (
        !current ||
        !current.pullRequestUrl ||
        current.branch !== input.setupBranch ||
        pullRequestNumberFromUrl(current.pullRequestUrl) !==
          input.pullRequestNumber ||
        (input.expectedAttempt &&
          current.attemptId !== input.expectedAttempt.attemptId)
      )
        return false;
      if (
        next.status === "configured" &&
        (!current.pullRequestHeadSha ||
          current.pullRequestHeadSha !== next.headSha)
      )
        return false;
      if (current.status === "configured") {
        if (next.status === "failed")
          throw new Error("workflow_provisioning_already_configured");
        return true;
      }
      if (current.status !== "setup_pr_open" && current.status !== "failed")
        return false;
      if (
        input.expectedAttempt &&
        current.revision !== input.expectedAttempt.revision
      )
        return false;
      if (
        next.status === "failed" &&
        current.status === "failed" &&
        current.errorMessage === next.reason
      )
        return true;
      const updated = await tx.workflowProvisioning.updateMany({
        where: {
          ...provisioningScopeWhere(input),
          id: current.id,
          attemptId: current.attemptId,
          revision: current.revision,
          status: current.status,
          branch: current.branch,
          pullRequestUrl: current.pullRequestUrl,
        },
        data: {
          status: next.status,
          errorMessage: next.status === "failed" ? next.reason : null,
          // A merged setup PR installs exactly the workflow of its attempt.
          ...(next.status === "configured"
            ? {
                installedWorkflowRequirement:
                  current.attemptWorkflowRequirement,
              }
            : {}),
          revision: { increment: 1 },
        },
      });
      return updated.count === 1;
    });
  }
}

function pullRequestNumberFromUrl(url: string): number | null {
  const match = /\/pull\/(\d+)(?:$|[?#])/.exec(url);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
