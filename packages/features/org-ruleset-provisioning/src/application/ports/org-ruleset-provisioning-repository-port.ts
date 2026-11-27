import type {
  OrgRulesetProvisioningRequest,
  OrgRulesetProvisioningStatus,
  OrgRulesetProvisioningTarget,
  OrgRulesetScope,
  OrgRulesetEnforcement,
} from "../../domain/org-ruleset-provisioning";

export type OrgRulesetProvisioningRecord = {
  readonly id: string;
  readonly revision: number;
  readonly workspaceId: string;
  readonly installationId: string;
  readonly githubInstallationId: string;
  readonly organizationLogin: string;
  readonly status: OrgRulesetProvisioningStatus;
  readonly scope: OrgRulesetScope;
  readonly enforcement: OrgRulesetEnforcement;
  readonly sourceRepositoryId: string | null;
  readonly sourceGithubRepositoryId: string | null;
  readonly sourceRepositoryFullName: string | null;
  readonly sourceWorkflowPath: string;
  readonly sourceWorkflowRef: string;
  readonly sourceWorkflowSha: string | null;
  readonly rulesetId: string | null;
  readonly rulesetUrl: string | null;
  readonly pendingRulesetCreateOrganization: string | null;
  readonly pendingRemoteAttemptId: string | null;
  readonly targetRepositoryIds: readonly string[];
  readonly safeErrorCode: string | null;
  readonly safeErrorSummary: string | null;
  readonly requestedBy: string;
  readonly requestedAt: Date;
  readonly lastAttemptAt: Date | null;
  readonly configuredAt: Date | null;
  readonly updatedAt: Date;
};

export interface OrgRulesetProvisioningRepositoryPort {
  findTargetByInstallation(input: {
    readonly workspaceId: string;
    readonly githubInstallationId: string;
  }): Promise<OrgRulesetProvisioningTarget | null>;

  findById(id: string): Promise<OrgRulesetProvisioningRecord | null>;

  findByWorkspaceId(
    workspaceId: string,
  ): Promise<OrgRulesetProvisioningRecord | null>;

  listConfiguredTrustedWorkflows(input: {
    readonly workspaceId: string;
    readonly githubRepositoryId: string;
  }): Promise<readonly string[]>;

  /** Commits desired state, its next revision and the outbox event atomically. */
  requestAndEnqueue(
    request: OrgRulesetProvisioningRequest,
  ): Promise<OrgRulesetProvisioningRecord>;

  markProcessing(input: {
    readonly id: string;
    readonly revision: number;
    readonly attemptedAt: Date;
  }): Promise<boolean>;

  markConfigured(input: {
    readonly id: string;
    readonly revision: number;
    readonly sourceWorkflowSha: string | null;
    readonly rulesetId: string;
    readonly rulesetUrl: string | null;
    readonly configuredAt: Date;
  }): Promise<boolean>;

  markFailed(input: {
    readonly id: string;
    readonly revision: number;
    readonly safeErrorCode: string;
    readonly safeErrorSummary: string;
  }): Promise<boolean>;

  /** Called under the remote identity lease, before the first POST is sent. */
  beginRulesetCreate(input: {
    readonly id: string;
    readonly revision: number;
    readonly organizationLogin: string;
  }): Promise<boolean>;

  beginRemoteAttempt(input: {
    readonly id: string;
    readonly revision: number;
    readonly attemptId: string;
  }): Promise<boolean>;

  /** A known response/local refusal closes only its token and atomically repairs current intent. */
  settleRemoteAttempt(input: {
    readonly id: string;
    readonly attemptId: string;
    readonly observedRevision: number;
    readonly occurredAt: Date;
    readonly reconcile: boolean;
    readonly clearRejectedCreateForOrganization?: string;
  }): Promise<void>;
}
