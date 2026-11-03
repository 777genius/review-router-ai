import type { WorkflowProvisioningAttempt } from "./ports/workflow-provisioning-repository-port";
import type { WorkflowSetupPullRequest } from "./ports/workflow-setup-gateway-port";

export type WorkflowProvisioningOutcomeCode =
  | "workflow_provisioning_superseded"
  | "workflow_provisioning_persistence_uncertain"
  | "workflow_provisioning_audit_unavailable";

export type WorkflowProvisioningOutcomeContext = Readonly<{
  attempt: WorkflowProvisioningAttempt;
  stage: "completion" | "failure" | "success_audit" | "failure_audit";
  /** Entering the external gateway is sufficient, even if its response is lost. */
  mayHaveExternalEffects: boolean;
  observedPullRequest?: WorkflowSetupPullRequest;
  /** An approved safe summary of the original preparation/provider failure. */
  failureSummary?: string;
}>;

/** Internal evidence; hosts must explicitly project approved public fields. */
export class WorkflowProvisioningOutcomeError extends Error {
  readonly attempt: WorkflowProvisioningAttempt;
  readonly stage: WorkflowProvisioningOutcomeContext["stage"];
  readonly mayHaveExternalEffects: boolean;
  readonly observedPullRequest: WorkflowSetupPullRequest | null;
  readonly committedPullRequest: WorkflowSetupPullRequest | null;
  readonly failureSummary: string | undefined;

  constructor(
    readonly code: WorkflowProvisioningOutcomeCode,
    context: WorkflowProvisioningOutcomeContext,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "WorkflowProvisioningOutcomeError";
    this.attempt = Object.freeze({ ...context.attempt });
    this.stage = context.stage;
    this.mayHaveExternalEffects = context.mayHaveExternalEffects;
    this.observedPullRequest = context.observedPullRequest
      ? Object.freeze({ ...context.observedPullRequest })
      : null;
    this.committedPullRequest =
      context.stage === "success_audit" ? this.observedPullRequest : null;
    this.failureSummary = context.failureSummary;
  }
}
