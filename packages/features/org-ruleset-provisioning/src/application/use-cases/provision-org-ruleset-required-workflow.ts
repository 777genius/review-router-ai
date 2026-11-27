import { randomUUID } from "node:crypto";
import type { AuditLogRepositoryPort } from "@reviewrouter/features-audit-log";
import { recordAuditEvent } from "@reviewrouter/features-audit-log";
import { renderReviewRouterRequiredWorkflow } from "@reviewrouter/features-workflow-provisioning";
import {
  buildGitHubOrgRulesetPayload,
  defaultOrgRulesetName,
  safeOrgRulesetErrorCode,
  safeOrgRulesetErrorSummary,
  type OrgRulesetTargetSelection,
} from "../../domain/org-ruleset-provisioning";
import type { OrgRulesetProvisioningRepositoryPort } from "../ports/org-ruleset-provisioning-repository-port";
import type { OrgRulesetProvisioningLockPort } from "../ports/org-ruleset-provisioning-lock-port";
import { withOrgRulesetIoDeadline } from "./org-ruleset-io-deadline";
import type { OrgRulesetSetupGatewayPort } from "../ports/org-ruleset-setup-gateway-port";

export type ProvisionOrgRulesetRequiredWorkflowInput = {
  readonly provisioningId: string;
  readonly actionRef: string;
  readonly apiUrl: string;
  readonly runtimeConfigMode: "oidc" | "static";
  readonly staticRuntimeEnv?: Readonly<Record<string, string>>;
  readonly attemptedAt: Date;
};

const attemptTimeoutMs = 30_000;
const remoteLeaseMs = 45_000;

type ProvisioningDependencies = {
  readonly provisioning: OrgRulesetProvisioningRepositoryPort;
  readonly lock: OrgRulesetProvisioningLockPort;
  readonly setupGateway?: OrgRulesetSetupGatewayPort;
  readonly createSetupGateway?: (
    githubInstallationId: string,
  ) => Promise<OrgRulesetSetupGatewayPort>;
  readonly auditLog?: AuditLogRepositoryPort | undefined;
};

export async function provisionOrgRulesetRequiredWorkflow(
  input: ProvisionOrgRulesetRequiredWorkflowInput,
  dependencies: ProvisioningDependencies,
): Promise<{ readonly rulesetId: string; readonly rulesetUrl: string | null }> {
  const initial = await dependencies.provisioning.findById(
    input.provisioningId,
  );
  if (!initial) throw new Error("org_ruleset_provisioning_not_found");
  // Different workspaces/installation credentials still address the same remote ruleset.
  const organization = initial.organizationLogin.toLowerCase();
  return dependencies.lock.withLease(
    `org-ruleset:remote:${organization}:${defaultOrgRulesetName.toLowerCase()}`,
    remoteLeaseMs,
    async (lease) => {
      const record = await dependencies.provisioning.findById(
        input.provisioningId,
      );
      if (!record) throw new Error("org_ruleset_provisioning_not_found");
      if (record.organizationLogin.toLowerCase() !== organization) {
        throw new Error("org_ruleset_revision_superseded");
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error("org_ruleset_attempt_timeout")),
        attemptTimeoutMs,
      );
      const { signal } = controller;
      const identity = { id: record.id, revision: record.revision };
      let remoteAttemptId: string | null = null;
      const assertCurrent = async () => {
        signal.throwIfAborted();
        await lease.assertHeld();
        const current = await dependencies.provisioning.findById(record.id);
        signal.throwIfAborted();
        if (current?.revision !== record.revision)
          throw new Error("org_ruleset_revision_superseded");
      };
      const beforeMutation = async () => {
        await assertCurrent();
        remoteAttemptId = randomUUID();
        if (
          !(await dependencies.provisioning.beginRemoteAttempt({
            ...identity,
            attemptId: remoteAttemptId,
          }))
        ) {
          throw new Error("org_ruleset_remote_outcome_unknown");
        }
      };
      const onMutationSettled = async ({
        createRejected,
      }: {
        readonly createRejected: boolean;
      }) => {
        if (!remoteAttemptId) return;
        await dependencies.provisioning.settleRemoteAttempt({
          id: record.id,
          attemptId: remoteAttemptId,
          observedRevision: record.revision,
          occurredAt: new Date(),
          reconcile: signal.aborted,
          ...(createRejected
            ? { clearRejectedCreateForOrganization: record.organizationLogin }
            : {}),
        });
        remoteAttemptId = null;
      };
      const io = <T>(work: () => Promise<T>) =>
        withOrgRulesetIoDeadline(signal, work);
      try {
        await assertCurrent();
        if (record.pendingRemoteAttemptId)
          throw new Error("org_ruleset_remote_outcome_unknown");
        if (
          !(await dependencies.provisioning.markProcessing({
            ...identity,
            attemptedAt: input.attemptedAt,
          }))
        ) {
          throw new Error("org_ruleset_revision_superseded");
        }
        if (
          !record.sourceRepositoryFullName ||
          !record.sourceGithubRepositoryId
        ) {
          throw new Error("org_ruleset_source_repository_missing");
        }
        const setupGateway =
          dependencies.setupGateway ??
          (await io(async () =>
            dependencies.createSetupGateway?.(record.githubInstallationId),
          ));
        if (!setupGateway) throw new Error("org_ruleset_setup_gateway_missing");
        const [sourceOwner, sourceRepo] = splitRepositoryFullName(
          record.sourceRepositoryFullName,
        );
        const branch = branchNameFromRef(record.sourceWorkflowRef);
        if (
          input.runtimeConfigMode === "static" &&
          input.staticRuntimeEnv === undefined
        ) {
          throw new Error("workflow_static_policy_required");
        }
        const workflow = renderReviewRouterRequiredWorkflow({
          actionRef: input.actionRef,
          apiUrl: input.apiUrl,
          runtimeConfigMode: input.runtimeConfigMode,
          staticRuntimeEnv: input.staticRuntimeEnv ?? {},
        });
        const sourceWrite = await io(() =>
          writeSourceWorkflowWithSafeErrors(setupGateway, {
            owner: sourceOwner,
            repo: sourceRepo,
            branch,
            path: record.sourceWorkflowPath,
            content: workflow,
            message: "chore: add ReviewRouter required workflow",
            signal,
            beforeMutation,
            onMutationSettled,
          }),
        );
        await assertCurrent();
        const ruleset = await io(() =>
          setupGateway.createOrUpdateOrganizationRuleset({
            organizationLogin: record.organizationLogin,
            name: defaultOrgRulesetName,
            knownRulesetId: record.rulesetId,
            signal,
            beforeMutation,
            onMutationSettled,
            beforeCreate: async () => {
              await assertCurrent();
              if (
                !(await dependencies.provisioning.beginRulesetCreate({
                  ...identity,
                  organizationLogin: record.organizationLogin,
                }))
              )
                throw new Error("org_ruleset_revision_superseded");
            },
            payload: buildGitHubOrgRulesetPayload({
              name: defaultOrgRulesetName,
              enforcement: record.enforcement,
              sourceWorkflow: {
                repositoryId: record.sourceGithubRepositoryId!,
                repositoryFullName: record.sourceRepositoryFullName!,
                path: record.sourceWorkflowPath,
                ref: record.sourceWorkflowRef,
                sha: null,
              },
              targetSelection: toTargetSelection(
                record.scope,
                record.targetRepositoryIds,
                [sourceRepo],
              ),
            }),
          }),
        );
        await assertCurrent();
        if (
          !(await dependencies.provisioning.markConfigured({
            ...identity,
            sourceWorkflowSha: sourceWrite.sha,
            rulesetId: ruleset.id,
            rulesetUrl: ruleset.url,
            configuredAt: new Date(),
          }))
        )
          throw new Error("org_ruleset_remote_outcome_unknown");
        await auditOptional(record.workspaceId, record.requestedBy, {
          auditLog: dependencies.auditLog,
          action: "org_ruleset.provision_configured",
          targetId: record.id,
          metadata: {
            organizationLogin: record.organizationLogin,
            revision: record.revision,
            rulesetId: ruleset.id,
            rulesetUrl: ruleset.url,
            sourceWorkflowPath: record.sourceWorkflowPath,
            sourceRepository: record.sourceRepositoryFullName,
          },
        });
        return { rulesetId: ruleset.id, rulesetUrl: ruleset.url };
      } catch (error) {
        const current = await dependencies.provisioning.findById(record.id);
        const safeErrorCode = current?.pendingRemoteAttemptId
          ? "org_ruleset_remote_outcome_unknown"
          : safeOrgRulesetErrorCode(error);
        await dependencies.provisioning.markFailed({
          ...identity,
          safeErrorCode,
          safeErrorSummary: current?.pendingRemoteAttemptId
            ? "A remote write has no durably recorded outcome; operator reconciliation is required before retrying mutations."
            : safeOrgRulesetErrorSummary(error),
        });
        await auditOptional(record.workspaceId, record.requestedBy, {
          auditLog: dependencies.auditLog,
          action: "org_ruleset.provision_failed",
          targetId: record.id,
          metadata: {
            organizationLogin: record.organizationLogin,
            revision: record.revision,
            safeErrorCode,
          },
        });
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  );
}

async function writeSourceWorkflowWithSafeErrors(
  setupGateway: OrgRulesetSetupGatewayPort,
  input: Parameters<OrgRulesetSetupGatewayPort["writeSourceWorkflow"]>[0],
): ReturnType<OrgRulesetSetupGatewayPort["writeSourceWorkflow"]> {
  try {
    return await setupGateway.writeSourceWorkflow(input);
  } catch (error) {
    const status = getHttpStatus(error);
    if (status === 403) {
      throw new Error("org_ruleset_source_repository_not_writable", {
        cause: error,
      });
    }
    if (status === 404) {
      throw new Error("org_ruleset_source_repository_not_installed", {
        cause: error,
      });
    }
    if (status === 409 || status === 422) {
      throw new Error("org_ruleset_source_repository_branch_blocked", {
        cause: error,
      });
    }
    throw error;
  }
}

function toTargetSelection(
  scope: "selected_repositories" | "all_repositories",
  targetRepositoryIds: readonly string[],
  excludeRepositoryNames: readonly string[],
): OrgRulesetTargetSelection {
  if (scope === "all_repositories") {
    return { scope, excludeRepositoryNames };
  }
  return { scope, repositoryIds: targetRepositoryIds };
}

function splitRepositoryFullName(fullName: string): readonly [string, string] {
  const [owner, repo, extra] = fullName.split("/");
  if (!owner || !repo || extra) {
    throw new Error("org_ruleset_source_repository_invalid");
  }
  return [owner, repo];
}

function branchNameFromRef(ref: string): string {
  const prefix = "refs/heads/";
  if (!ref.startsWith(prefix) || ref.length <= prefix.length) {
    throw new Error("workflow_ref_invalid");
  }
  return ref.slice(prefix.length);
}

function getHttpStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "status" in error
    ? Number(error.status)
    : 0;
}

async function auditOptional(
  workspaceId: string,
  actor: string,
  input: {
    readonly action: string;
    readonly targetId: string;
    readonly metadata: Record<string, unknown>;
    readonly auditLog?: AuditLogRepositoryPort | undefined;
  },
): Promise<void> {
  if (!input.auditLog) return;
  await recordAuditEvent(
    {
      workspaceId,
      actor,
      action: input.action,
      targetType: "org_ruleset_provisioning",
      targetId: input.targetId,
      metadata: input.metadata,
    },
    { auditLog: input.auditLog },
  );
}
