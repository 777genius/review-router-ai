import { describe, expect, it } from "vitest";
import { createProvisionWorkflowPlan } from "../domain/workflow-provisioning";

const base = {
  installationId: "installation-1",
  workspaceId: "workspace-1",
  repositoryId: "repository-1",
  owner: "777genius",
  name: "review-router-saas-e2e",
  defaultBranch: "main",
  actionRef: "777genius/review-router@0123456789abcdef0123456789abcdef01234567",
  apiUrl: "https://reviewrouter.example",
  runtimeConfigMode: "oidc" as const,
  codexRotatingProviderInstanceId: "codex-rotating:1228051727",
};

describe("createProvisionWorkflowPlan repository-bound Codex path", () => {
  it("selects the isolated workflow from exact repository identity", () => {
    expect(
      createProvisionWorkflowPlan({
        ...base,
        githubRepositoryId: "1228051727",
        repositoryFullName: "777genius/review-router-saas-e2e",
      }).workflowPath,
    ).toBe(".github/workflows/reviewrouter-quality-stand.yml");
  });

  it("fails closed instead of defaulting the isolated provider to the standard path", () => {
    expect(() => createProvisionWorkflowPlan(base)).toThrow(
      "isolated_workflow_repository_identity_required",
    );
  });

  it("rejects an explicit standard path for the isolated repository", () => {
    expect(() =>
      createProvisionWorkflowPlan({
        ...base,
        githubRepositoryId: "1228051727",
        repositoryFullName: "777genius/review-router-saas-e2e",
        workflowPath: ".github/workflows/reviewrouter-codex.yml",
      }),
    ).toThrow("codex_workflow_repository_path_mismatch");
  });

  it("rejects a non-main default branch for the isolated repository", () => {
    expect(() =>
      createProvisionWorkflowPlan({
        ...base,
        githubRepositoryId: "1228051727",
        repositoryFullName: "777genius/review-router-saas-e2e",
        defaultBranch: "trunk",
      }),
    ).toThrow("isolated_workflow_default_branch_must_be_main");
  });
});
