import { describe, expect, it } from "vitest";
import { createProvisionWorkflowPlan } from "../domain/workflow-provisioning";
import {
  defaultWorkflowPath,
  renderReviewRouterWorkflowFiles,
  renderAccountGatewayWorkflow,
  readReviewRouterCallerSource,
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
        workflowPath: ".github/workflows/reviewrouter-review.yml",
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

describe("stable ReviewRouter installation contract", () => {
  const render = (actionRef: string) =>
    renderAccountGatewayWorkflow({
      actionRef,
      apiUrl: "https://api.reviewrouter.org",
      githubRepositoryId: "123456",
    });

  it("keeps installed source unchanged when the selected producer changes", () => {
    const first = render(`777genius/review-router@${"a".repeat(40)}`);
    const next = render(`777genius/review-router@${"b".repeat(40)}`);
    expect(first).toEqual(next);
    expect(first.path).toBe(".github/workflows/reviewrouter-review.yml");
    expect(first.content).toContain("reviewrouter-runtime.yml@workflow-v1");
    expect(first.content).toContain(
      "reviewrouter-request-${{ github.repository_id }}-${{ inputs.review_request_id }}",
    );
    expect(first.content).not.toMatch(
      /codex|provider_instance_id|runtime_ref|secrets:|pull-requests: write/,
    );
    expect(first.content.match(/required: true/g)).toHaveLength(3);
    expect(readReviewRouterCallerSource(first.content)).toEqual({
      runtimeRef: "workflow-v1",
      controlPlaneUrl: "https://api.reviewrouter.org",
    });
  });

  it("rejects source edits that add credentials, agent hints, or write permissions", () => {
    const source = render(`777genius/review-router@${"a".repeat(40)}`).content;
    for (const changed of [
      source.replace("pull-requests: read", "pull-requests: write"),
      `${source}    secrets: inherit\n`,
      `${source}      codex_session_mode: account-gateway\n`,
      source.replace("@workflow-v1", "@main"),
    ]) {
      expect(() => readReviewRouterCallerSource(changed)).toThrow();
    }
  });

  it("adds only the explicit self-hosted control plane choice", () => {
    const caller = renderAccountGatewayWorkflow({
      actionRef: `777genius/review-router@${"a".repeat(40)}`,
      apiUrl: "https://reviews.example/",
      githubRepositoryId: "123456",
    });
    expect(caller.content).toContain(
      'control_plane_url: "https://reviews.example"',
    );
    expect(
      render(`777genius/review-router@${"a".repeat(40)}`).content,
    ).not.toContain("control_plane_url:");
  });

  it("refuses credentials and insecure origins in installed source", () => {
    for (const apiUrl of [
      "http://reviews.example",
      "https://user:password@reviews.example",
      "https://reviews.example/?key=value",
    ]) {
      expect(() =>
        renderAccountGatewayWorkflow({
          actionRef: `777genius/review-router@${"a".repeat(40)}`,
          apiUrl,
          githubRepositoryId: "123456",
        }),
      ).toThrow();
    }
  });
});
