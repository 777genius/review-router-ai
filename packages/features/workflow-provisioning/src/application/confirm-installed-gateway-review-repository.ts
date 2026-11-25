import type {
  GatewayReviewV2ProvisioningIssue,
  GatewayReviewV2ProvisioningResult,
} from "./provision-gateway-review-v2-repository";

export type InstalledGatewayReviewConfirmationIssue =
  | GatewayReviewV2ProvisioningIssue
  | "installed_gateway_repository_unavailable"
  | "installed_gateway_scope_changed"
  | "installed_gateway_transport_unsupported"
  | "installed_gateway_workflow_incompatible"
  | "installed_gateway_binding_unavailable"
  | "installed_gateway_audit_unavailable"
  | "installed_gateway_upstream_unavailable"
  | "installed_gateway_confirmation_failed";

export type InstalledGatewayReviewConfirmationCommand = Readonly<{
  workspaceId: string;
  repositoryId: string;
  actor: string;
  operatorAudit?: Readonly<{ operatorId: string; ownerUserId: string }>;
}>;

export type InstalledGatewayReviewConfirmationResult =
  | Readonly<{
      status: "ready";
      outcome: "created" | "restored";
      repositoryId: string;
      repository: string;
      authorityVersion: number;
      authorityEpoch: string;
      workflowPath: string;
      sourceCommitSha: string;
      callerBlobSha: string;
      actionCommitSha: string;
      attemptId: string;
      revision: number;
    }>
  | Readonly<{
      status: "blocked" | "conflict";
      issue: InstalledGatewayReviewConfirmationIssue;
    }>;

export type PreparedInstalledGatewayReviewConfirmation = Readonly<{
  repository: string;
  sourceCommitSha: string;
  callerBlobSha: string;
  actionCommitSha: string;
  workflowPath: string;
  /** Nonsecret captured CAS identities, retained before operational writes. */
  auditFacts: Readonly<Record<string, unknown>>;
  assertCurrent(): Promise<void>;
  provision(): Promise<GatewayReviewV2ProvisioningResult>;
  confirmConfigured(): Promise<{ attemptId: string; revision: number }>;
}>;

export class InstalledGatewayReviewConfirmationError extends Error {
  constructor(readonly issue: InstalledGatewayReviewConfirmationIssue) {
    super(issue);
    this.name = "InstalledGatewayReviewConfirmationError";
  }
}

/** One installed-only operation; never creates a workflow, review or provider. */
export class ConfirmInstalledGatewayReviewRepository {
  constructor(
    private readonly dependencies: {
      assertAuthorized(): Promise<void>;
      prepare(
        command: InstalledGatewayReviewConfirmationCommand,
      ): Promise<PreparedInstalledGatewayReviewConfirmation>;
      nextAttemptId(): string;
      audit(input: {
        command: InstalledGatewayReviewConfirmationCommand;
        attemptId: string;
        stage: "started" | "completed" | "failed";
        facts: Readonly<Record<string, unknown>>;
      }): Promise<void>;
    },
  ) {}

  async confirm(
    command: InstalledGatewayReviewConfirmationCommand,
  ): Promise<InstalledGatewayReviewConfirmationResult> {
    await this.dependencies.assertAuthorized();
    let prepared: PreparedInstalledGatewayReviewConfirmation;
    try {
      prepared = await this.dependencies.prepare(command);
      await prepared.assertCurrent();
    } catch (error) {
      return this.failure(error);
    }
    const attemptId = this.dependencies.nextAttemptId();
    let phase: "preflight" | "provisioning" | "setup" = "preflight";
    // Failure here must precede policy, authority or setup writes.
    try {
      await this.dependencies.audit({
        command,
        attemptId,
        stage: "started",
        facts: prepared.auditFacts,
      });
    } catch {
      return {
        status: "blocked",
        issue: "installed_gateway_audit_unavailable",
      };
    }
    try {
      await this.dependencies.assertAuthorized();
      await prepared.assertCurrent();
      phase = "provisioning";
      const authority = await prepared.provision();
      if (authority.status !== "ready") {
        const result: InstalledGatewayReviewConfirmationResult = {
          status: authority.status === "conflict" ? "conflict" : "blocked",
          issue:
            "issue" in authority
              ? authority.issue
              : "gateway_review_v2_authority_invalid",
        };
        await this.dependencies.audit({
          command,
          attemptId,
          stage: "failed",
          facts: {
            ...prepared.auditFacts,
            phase,
            mayHavePartialEffects: true,
            ...result,
          },
        });
        return result;
      }
      await this.dependencies.assertAuthorized();
      await prepared.assertCurrent();
      phase = "setup";
      const setup = await prepared.confirmConfigured();
      const result: InstalledGatewayReviewConfirmationResult = {
        status: "ready",
        outcome: authority.outcome,
        repositoryId: command.repositoryId,
        repository: prepared.repository,
        authorityVersion: authority.authorityVersion,
        authorityEpoch: authority.authorityEpoch,
        workflowPath: prepared.workflowPath,
        sourceCommitSha: prepared.sourceCommitSha,
        callerBlobSha: prepared.callerBlobSha,
        actionCommitSha: prepared.actionCommitSha,
        attemptId: setup.attemptId,
        revision: setup.revision,
      };
      await this.dependencies.audit({
        command,
        attemptId,
        stage: "completed",
        facts: { ...prepared.auditFacts, ...result },
      });
      return result;
    } catch (error) {
      const result = this.failure(error);
      try {
        await this.dependencies.audit({
          command,
          attemptId,
          stage: "failed",
          facts: {
            ...prepared.auditFacts,
            phase,
            mayHavePartialEffects: phase !== "preflight",
            ...result,
          },
        });
      } catch {
        return {
          status: "blocked",
          issue: "installed_gateway_audit_unavailable",
        };
      }
      return result;
    }
  }

  private failure(
    error: unknown,
  ): Extract<
    InstalledGatewayReviewConfirmationResult,
    { status: "blocked" | "conflict" }
  > {
    const issue =
      error instanceof InstalledGatewayReviewConfirmationError
        ? error.issue
        : "installed_gateway_confirmation_failed";
    return {
      status:
        issue === "installed_gateway_scope_changed" ? "conflict" : "blocked",
      issue,
    };
  }
}
