import { describe, expect, it, vi } from "vitest";
import { OctokitOrgRulesetSetupGateway } from "../infrastructure/github/octokit-org-ruleset-setup-gateway";
import { buildGitHubOrgRulesetPayload } from "../domain/org-ruleset-provisioning";
import { rulesetHttpFixture } from "./ruleset-http.fixture";

const payload = buildGitHubOrgRulesetPayload({
  enforcement: "evaluate",
  sourceWorkflow: {
    repositoryId: "123",
    repositoryFullName: "example/workflows",
    path: ".github/workflows/reviewrouter-required.yml",
    ref: "refs/heads/main",
  },
  targetSelection: { scope: "selected_repositories", repositoryIds: ["124"] },
});

describe("ruleset transport cancellation", () => {
  it("passes AbortSignal to real HTTP and retains unknown write ownership after abort", async () => {
    const remote = await rulesetHttpFixture();
    const gate = remote.holdNextCreate();
    try {
      const controller = new AbortController();
      const onMutationSettled = vi.fn(async () => undefined);
      const request = new OctokitOrgRulesetSetupGateway(
        remote.requester,
      ).createOrUpdateOrganizationRuleset({
        organizationLogin: "example",
        name: payload.name,
        payload,
        signal: controller.signal,
        beforeMutation: async () => undefined,
        beforeCreate: async () => undefined,
        onMutationSettled,
      });
      const rejected = expect(request).rejects.toThrow("fixture_abort");
      await gate.entered;
      controller.abort(new Error("fixture_abort"));
      await rejected;
      expect(onMutationSettled).not.toHaveBeenCalled();
      expect(remote.createCount).toBe(1);
    } finally {
      gate.release();
      await remote.close();
    }
  });

  it("does not send POST if cancellation happens while discovery is returning", async () => {
    const controller = new AbortController();
    const request = vi.fn(async () => {
      controller.abort(new Error("fixture_abort"));
      return { data: [] };
    });
    await expect(
      new OctokitOrgRulesetSetupGateway({
        request,
      }).createOrUpdateOrganizationRuleset({
        organizationLogin: "example",
        name: payload.name,
        payload,
        signal: controller.signal,
      }),
    ).rejects.toThrow("fixture_abort");
    expect(request).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledWith(
      "GET /orgs/{org}/rulesets",
      expect.objectContaining({
        request: { signal: controller.signal, timeout: 30_000 },
      }),
    );
  });
});
