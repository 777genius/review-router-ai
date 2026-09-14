import { describe, expect, it } from "vitest";
import { renderCanonicalHostedPoolWorkflowV2 } from "@reviewrouter/features-workflow-provisioning";
import { resolveHostedPoolActionReleaseForProvision } from "@reviewrouter/platform-config";

const sha = "22598c93e8b025c0812d77a4f158b12abb0a5be8";

describe("hosted pool action channel provision", () => {
  it("bakes the official release SHA into the customer workflow, not main", async () => {
    const release = await resolveHostedPoolActionReleaseForProvision(
      { REVIEW_ROUTER_HOSTED_POOL_ACTION_TAG: "main" },
      {
        latestOfficialRelease: async () => ({
          repository: "777genius/review-router",
          tag: "v1.0.146",
          commitSha: sha,
          distSha256: "d".repeat(64),
          actionRef: `777genius/review-router@${sha}`,
        }),
        releaseForTag: async () => {
          throw new Error("catalog_should_not_run");
        },
      },
    );
    const workflow = renderCanonicalHostedPoolWorkflowV2({
      actionRef: release.actionRef,
      apiUrl: "https://api.reviewrouter.site",
      providerInstanceId: "hosted-pool:repository:123456",
      bindingId: "hosted-binding-1",
      bindingRevision: 1,
    });
    expect(workflow).toContain(
      `uses: 777genius/review-router/.github/workflows/reviewrouter-t0-reusable.yml@${sha}`,
    );
    expect(workflow).toContain(`runtime_ref: "${sha}"`);
    expect(workflow).not.toContain("@main");
    expect(workflow).not.toContain("@v1.0.146");
  });

  it("rejects baking a branch Action ref", () => {
    expect(() =>
      renderCanonicalHostedPoolWorkflowV2({
        actionRef: "777genius/review-router@main",
        apiUrl: "https://api.reviewrouter.site",
        providerInstanceId: "hosted-pool:repository:123456",
        bindingId: "hosted-binding-1",
        bindingRevision: 1,
      }),
    ).toThrow("hosted_workflow_action_ref_must_be_full_sha");
  });
});
