import type { CurrentWorkflowSetupAttempt } from "../../domain/workflow-setup-authority.js";

export type CurrentWorkflowSetupScope = Readonly<{
  workspaceId: string;
  repositoryId: string;
  installationId: string | null;
}>;

/** Reads current authority; it neither activates nor settles a setup attempt. */
export interface CurrentWorkflowSetupQueryPort {
  /** Only a selected, non-archived GitHub repository in this active installation. */
  findEligibleRepository(
    scope: CurrentWorkflowSetupScope,
  ): Promise<Readonly<{ defaultBranch: string }> | null>;

  findCurrentAttempt(
    repositoryId: string,
  ): Promise<CurrentWorkflowSetupAttempt | null>;
}
