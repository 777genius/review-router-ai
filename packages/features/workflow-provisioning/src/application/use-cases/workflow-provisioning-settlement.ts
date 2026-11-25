import type { WorkflowProvisioningTransition } from "../ports/workflow-provisioning-repository-port";
import {
  WorkflowProvisioningOutcomeError,
  type WorkflowProvisioningOutcomeContext,
} from "../workflow-provisioning-outcome";

/** A successful read is insufficient: the terminal write owns the outcome. */
export async function settleWorkflowProvisioningAttempt(
  context: WorkflowProvisioningOutcomeContext & {
    readonly stage: "completion" | "failure";
  },
  write: () => Promise<WorkflowProvisioningTransition>,
): Promise<void> {
  let result: WorkflowProvisioningTransition;
  try {
    result = await write();
  } catch (cause) {
    throw new WorkflowProvisioningOutcomeError(
      "workflow_provisioning_persistence_uncertain",
      context,
      { cause },
    );
  }
  if (result !== "applied") {
    throw new WorkflowProvisioningOutcomeError(
      "workflow_provisioning_superseded",
      context,
    );
  }
}

/** Audit errors are visible, but cannot reinterpret an already committed effect. */
export async function auditWorkflowProvisioningAttempt(
  context: WorkflowProvisioningOutcomeContext & {
    readonly stage: "success_audit" | "failure_audit";
  },
  append: () => Promise<void>,
): Promise<void> {
  try {
    await append();
  } catch (cause) {
    throw new WorkflowProvisioningOutcomeError(
      "workflow_provisioning_audit_unavailable",
      context,
      { cause },
    );
  }
}
