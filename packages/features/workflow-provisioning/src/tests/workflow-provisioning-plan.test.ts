import { describe, expect, it } from "vitest";
import { createProvisionWorkflowPlan } from "../domain/workflow-provisioning";
import {
  defaultWorkflowPath,
  renderReviewRouterWorkflowFiles,
} from "../domain/workflow-template";

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
  it("preserves the reusable MiMo plan with conflict-review fallback through rendering", () => {
    const ordinary: Omit<typeof base, "codexRotatingProviderInstanceId"> & {
      codexRotatingProviderInstanceId?: string;
    } = { ...base };
    delete ordinary.codexRotatingProviderInstanceId;
    const plan = createProvisionWorkflowPlan({
      ...ordinary,
      actionRef: "777genius/review-router@v1",
      runtimeConfigMode: "static",
      workflowStyle: "reusable",
      conflictReviewFallbackEnabled: true,
      staticRuntimeEnv: {
        REVIEW_AUTH_MODE: "mimo-token-plan-api",
        REVIEW_PROVIDERS: "codex-mimo/mimo-v2.6-pro",
      },
    });

    expect(plan.workflowStyle).toBe("reusable");
    const files = renderReviewRouterWorkflowFiles(plan);
    const review = files.find((file) => file.path === defaultWorkflowPath);
    if (!review || !("content" in review)) {
      throw new Error("expected a generated review workflow, not a deletion");
    }
    expect(review.content).toContain("reviewrouter_conflict_review");
    expect(review.content).toContain(
      "MIMO_TOKEN_PLAN_API_KEY: ${{ secrets.MIMO_TOKEN_PLAN_API_KEY }}",
    );
    expect(
      files.some(
        (file) =>
          "content" in file &&
          file.content.includes("reviewrouter-interaction-reusable.yml"),
      ),
    ).toBe(true);
  });

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
