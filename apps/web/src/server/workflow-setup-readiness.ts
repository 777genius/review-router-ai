import {
  isWorkflowSetupAlreadyCurrent as inspectWorkflowSetupReadiness,
  workflowSetupReadinessMode,
  type WorkflowSetupReadinessInput,
  type RepositoryWorkflowProbePort,
} from "@reviewrouter/features-workflow-provisioning";
import { resolveWorkflowPublicApiUrl } from "./workflow-public-api-url";
export type { WorkflowSetupReadinessInput } from "@reviewrouter/features-workflow-provisioning";

/** Resolve trusted deployment configuration; the feature owns artifact readiness. */
export async function isWorkflowSetupAlreadyCurrent(
  input: WorkflowSetupReadinessInput,
  dependencies: {
    readonly workflowProbe: RepositoryWorkflowProbePort;
    readonly resolvePublicApiUrl?: () => string;
  },
): Promise<boolean> {
  const mode = workflowSetupReadinessMode(input);
  if (mode === "invalid") return false;
  let publicApiUrl = "";
  if (mode !== "legacy") {
    try {
      publicApiUrl =
        dependencies.resolvePublicApiUrl?.() ?? resolveWorkflowPublicApiUrl();
    } catch (error) {
      // Preserve existing short-circuit behavior: secrets callers propagate a
      // configuration failure; managed/rotating readiness remains false.
      if (mode === "secrets") throw error;
      return false;
    }
  }
  return inspectWorkflowSetupReadiness(input, {
    workflowProbe: dependencies.workflowProbe,
    publicApiUrl,
  });
}
