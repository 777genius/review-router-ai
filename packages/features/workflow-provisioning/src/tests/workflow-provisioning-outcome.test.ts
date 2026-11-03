import { describe, expect, it, vi } from "vitest";
import { provisionReviewRouterWorkflow } from "../application/use-cases/provision-reviewrouter-workflow";
import { provisionHostedPoolRepositoryWorkflow } from "../application/use-cases/provision-hosted-pool-workflow";
import type { WorkflowProvisioningRepositoryPort } from "../application/ports/workflow-provisioning-repository-port";

const pr = {
  url: "https://github.com/acme/widget/pull/7",
  number: 7,
  headSha: "b".repeat(40),
  branch: "reviewrouter/setup-attempt",
};
const scope = {
  workspaceId: "workspace-1",
  repositoryId: "repository-1",
  installationId: "installation-1",
};
const attempt = {
  ...scope,
  attemptId: "attempt-1",
  revision: 0,
  branch: pr.branch,
};

function fixture(kind: "ordinary" | "hosted", enabled = true) {
  const gateway = { createOrUpdateSetupPullRequest: vi.fn(async () => pr) };
  const provisioning = {
    beginAttempt: vi.fn(async () => attempt),
    markSetupPullRequestOpen: vi.fn(
      async (): Promise<"applied" | "superseded"> => "applied",
    ),
    markFailed: vi.fn(async (): Promise<"applied" | "superseded"> => "applied"),
  };
  const auditLog = { append: vi.fn(async () => undefined) };
  const dependencies = {
    enabled,
    setupGateway: gateway,
    provisioning: provisioning satisfies WorkflowProvisioningRepositoryPort,
    auditLog,
  };
  const common = {
    ...scope,
    actionRef: `777genius/review-router@${"a".repeat(40)}`,
    apiUrl: "https://api.reviewrouter.test",
  };
  return {
    gateway,
    provisioning,
    auditLog,
    run: () =>
      kind === "ordinary"
        ? provisionReviewRouterWorkflow(
            {
              ...common,
              owner: "acme",
              name: "widget",
              defaultBranch: "main",
              runtimeConfigMode: "oidc",
              codexRotatingProviderInstanceId: "codex-rotating:123456",
            },
            dependencies,
          )
        : provisionHostedPoolRepositoryWorkflow(
            {
              ...common,
              providerInstanceId: "hosted-pool:repository:123456",
              bindingId: "binding-1",
              bindingRevision: 1,
            },
            {
              ...dependencies,
              targets: {
                findWorkflowProvisioningTarget: async () => ({
                  ...scope,
                  owner: "acme",
                  name: "widget",
                  fullName: "acme/widget",
                  defaultBranch: "main",
                  selected: true,
                  archived: false,
                  installationStatus: "active",
                }),
              },
            },
          ),
  };
}

describe.each(["ordinary", "hosted"] as const)(
  "%s workflow outcome authority",
  (kind) => {
    it("returns the exact PR only after an applied completion and audit", async () => {
      const f = fixture(kind);
      await expect(f.run()).resolves.toEqual(pr);
      expect(f.provisioning.markFailed).not.toHaveBeenCalled();
      expect(f.auditLog.append).toHaveBeenCalledOnce();
    });

    it("refuses an externally created PR when its attempt was superseded", async () => {
      const f = fixture(kind);
      f.provisioning.markSetupPullRequestOpen.mockResolvedValue("superseded");
      await expect(f.run()).rejects.toMatchObject({
        code: "workflow_provisioning_superseded",
        stage: "completion",
        mayHaveExternalEffects: true,
        observedPullRequest: pr,
      });
      expect(f.provisioning.markFailed).not.toHaveBeenCalled();
      expect(f.auditLog.append).not.toHaveBeenCalled();
    });

    it("preserves uncertainty when persistence throws after external success", async () => {
      const f = fixture(kind);
      f.provisioning.markSetupPullRequestOpen.mockRejectedValue(
        new Error("private database detail"),
      );
      await expect(f.run()).rejects.toMatchObject({
        code: "workflow_provisioning_persistence_uncertain",
        stage: "completion",
        mayHaveExternalEffects: true,
        observedPullRequest: pr,
      });
      expect(f.provisioning.markFailed).not.toHaveBeenCalled();
      expect(f.auditLog.append).not.toHaveBeenCalled();
      expect(f.gateway.createOrUpdateSetupPullRequest).toHaveBeenCalledOnce();
    });

    it("reports committed setup when mandatory success audit is unavailable", async () => {
      const f = fixture(kind);
      f.auditLog.append.mockRejectedValue(new Error("private audit detail"));
      await expect(f.run()).rejects.toMatchObject({
        code: "workflow_provisioning_audit_unavailable",
        stage: "success_audit",
        committedPullRequest: pr,
        observedPullRequest: pr,
        mayHaveExternalEffects: true,
      });
      expect(f.provisioning.markFailed).not.toHaveBeenCalled();
      expect(f.auditLog.append).toHaveBeenCalledOnce();
    });

    it("does not audit failure for a superseded attempt whose gateway threw", async () => {
      const f = fixture(kind);
      f.gateway.createOrUpdateSetupPullRequest.mockRejectedValue(
        new Error("response lost"),
      );
      f.provisioning.markFailed.mockResolvedValue("superseded");
      await expect(f.run()).rejects.toMatchObject({
        code: "workflow_provisioning_superseded",
        stage: "failure",
        mayHaveExternalEffects: true,
      });
      expect(f.provisioning.markSetupPullRequestOpen).not.toHaveBeenCalled();
      expect(f.auditLog.append).not.toHaveBeenCalled();
    });
    it("suppresses stale disabled failure before any external gateway call", async () => {
      const f = fixture(kind, false);
      f.provisioning.markFailed.mockResolvedValue("superseded");
      await expect(f.run()).rejects.toMatchObject({
        code: "workflow_provisioning_superseded",
        stage: "failure",
        mayHaveExternalEffects: false,
        failureSummary: "workflow_provisioning_disabled",
      });
      expect(f.gateway.createOrUpdateSetupPullRequest).not.toHaveBeenCalled();
      expect(f.auditLog.append).not.toHaveBeenCalled();
    });

    it("retains the original safe failure when failure settlement is uncertain", async () => {
      const f = fixture(kind);
      f.gateway.createOrUpdateSetupPullRequest.mockRejectedValue(
        new Error("private provider detail"),
      );
      f.provisioning.markFailed.mockRejectedValue(
        new Error("private database detail"),
      );
      await expect(f.run()).rejects.toMatchObject({
        code: "workflow_provisioning_persistence_uncertain",
        stage: "failure",
        mayHaveExternalEffects: true,
        failureSummary: "workflow_provisioning_failed",
      });
      expect(f.auditLog.append).not.toHaveBeenCalled();
    });
  },
);

it("propagates failed-attempt audit unavailability with the original safe failure context", async () => {
  const f = fixture("ordinary");
  f.gateway.createOrUpdateSetupPullRequest.mockRejectedValue(
    new Error("private provider detail"),
  );
  f.auditLog.append.mockRejectedValue(new Error("private audit detail"));
  await expect(f.run()).rejects.toMatchObject({
    code: "workflow_provisioning_audit_unavailable",
    stage: "failure_audit",
    mayHaveExternalEffects: true,
    failureSummary: "workflow_provisioning_failed",
    committedPullRequest: null,
  });
  expect(f.provisioning.markFailed).toHaveBeenCalledOnce();
  expect(f.auditLog.append).toHaveBeenCalledOnce();
});
