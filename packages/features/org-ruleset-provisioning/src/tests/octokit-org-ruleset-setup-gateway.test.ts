import { describe, expect, it, vi } from "vitest";
import { OctokitOrgRulesetSetupGateway } from "../infrastructure/github/octokit-org-ruleset-setup-gateway.js";
import { buildGitHubOrgRulesetPayload } from "../domain/org-ruleset-provisioning.js";

describe("OctokitOrgRulesetSetupGateway", () => {
  it("maps missing organization admin permission to a safe probe code", async () => {
    const requester = new FakeRequester(() => {
      const error = new Error("forbidden") as Error & { status: number };
      error.status = 403;
      throw error;
    });
    const gateway = new OctokitOrgRulesetSetupGateway(requester);

    await expect(
      gateway.probeOrganizationRulesetAccess({
        organizationLogin: "agent-teams-ai",
      }),
    ).resolves.toMatchObject({
      ok: false,
      safeErrorCode: "org_admin_permission_required",
    });
    expect(requester.calls[0]?.parameters).toMatchObject({
      headers: { "X-GitHub-Api-Version": "2026-03-10" },
    });
  });

  it("maps GitHub plan ruleset 403 responses to unsupported rulesets", async () => {
    const requester = new FakeRequester(() => {
      const error = new Error(
        "Upgrade to GitHub Team to enable this feature.",
      ) as Error & {
        status: number;
      };
      error.status = 403;
      throw error;
    });
    const gateway = new OctokitOrgRulesetSetupGateway(requester);

    await expect(
      gateway.probeOrganizationRulesetAccess({
        organizationLogin: "agent-teams-ai",
      }),
    ).resolves.toMatchObject({
      ok: false,
      safeErrorCode: "org_rulesets_not_supported",
    });
  });

  it("maps unsupported rulesets probes to safe UI codes", async () => {
    const notFound = new FakeRequester(() => {
      const error = new Error("not found") as Error & { status: number };
      error.status = 404;
      throw error;
    });
    await expect(
      new OctokitOrgRulesetSetupGateway(
        notFound,
      ).probeOrganizationRulesetAccess({
        organizationLogin: "agent-teams-ai",
      }),
    ).resolves.toMatchObject({
      ok: false,
      safeErrorCode: "org_rulesets_not_supported",
    });

    const validation = new FakeRequester(() => {
      const error = new Error("validation") as Error & { status: number };
      error.status = 422;
      throw error;
    });
    await expect(
      new OctokitOrgRulesetSetupGateway(
        validation,
      ).probeOrganizationRulesetAccess({
        organizationLogin: "agent-teams-ai",
      }),
    ).resolves.toMatchObject({
      ok: false,
      safeErrorCode: "org_ruleset_permission_update_pending",
    });
  });

  it("updates an existing ruleset and verifies the remote payload", async () => {
    let current = { ...payload(), enforcement: "active" };
    const requester = new FakeRequester((route, parameters) => {
      if (route === "GET /orgs/{org}/rulesets")
        return { data: [{ id: 77, name: payload().name }] };
      if (route === "PUT /orgs/{org}/rulesets/{ruleset_id}") {
        current = {
          ...payload(),
          enforcement: String(parameters?.enforcement),
        };
        return { data: { id: 77, name: payload().name } };
      }
      if (route === "GET /orgs/{org}/rulesets/{ruleset_id}")
        return {
          data: {
            ...current,
            id: 77,
            _links: {
              html: { href: "https://github.com/orgs/example/rules/77" },
            },
          },
        };
      throw new Error(`unexpected route ${route}`);
    });
    const beforeMutation = vi.fn(async () => undefined);
    await expect(
      new OctokitOrgRulesetSetupGateway(
        requester,
      ).createOrUpdateOrganizationRuleset({
        organizationLogin: "example",
        name: payload().name,
        payload: payload(),
        beforeMutation,
      }),
    ).resolves.toEqual({
      id: "77",
      url: "https://github.com/orgs/example/rules/77",
    });
    expect(beforeMutation).toHaveBeenCalledOnce();
    expect(requester.routes).toEqual([
      "GET /orgs/{org}/rulesets",
      "GET /orgs/{org}/rulesets/{ruleset_id}",
      "PUT /orgs/{org}/rulesets/{ruleset_id}",
      "GET /orgs/{org}/rulesets/{ruleset_id}",
    ]);
  });

  it.each(["duplicate", "incomplete"] as const)(
    "never creates after %s discovery",
    async (mode) => {
      const requester = new FakeRequester(() => ({
        data:
          mode === "duplicate"
            ? [
                { id: 1, name: payload().name },
                { id: 2, name: payload().name },
              ]
            : Array.from({ length: 100 }, (_, index) => ({
                id: index + 1,
                name: `other-${index}`,
              })),
      }));
      await expect(
        new OctokitOrgRulesetSetupGateway(
          requester,
        ).createOrUpdateOrganizationRuleset({
          organizationLogin: "example",
          name: payload().name,
          payload: payload(),
        }),
      ).rejects.toThrow(
        mode === "duplicate"
          ? "org_ruleset_duplicate_name"
          : "org_ruleset_discovery_incomplete",
      );
      expect(requester.routes.every((route) => route.startsWith("GET"))).toBe(
        true,
      );
    },
  );

  it("rechecks authority after reads and before a ruleset mutation", async () => {
    const requester = new FakeRequester(() => ({ data: [] }));
    await expect(
      new OctokitOrgRulesetSetupGateway(
        requester,
      ).createOrUpdateOrganizationRuleset({
        organizationLogin: "example",
        name: payload().name,
        payload: payload(),
        beforeMutation: async () => {
          throw new Error("org_ruleset_revision_superseded");
        },
      }),
    ).rejects.toThrow("org_ruleset_revision_superseded");
    expect(requester.routes).toEqual(["GET /orgs/{org}/rulesets"]);
  });

  it("refuses a successful write whose readback differs", async () => {
    const requester = new FakeRequester((route) => ({
      data:
        route === "GET /orgs/{org}/rulesets"
          ? []
          : { ...payload(), enforcement: "active", id: 77 },
    }));
    await expect(
      new OctokitOrgRulesetSetupGateway(
        requester,
      ).createOrUpdateOrganizationRuleset({
        organizationLogin: "example",
        name: payload().name,
        payload: payload(),
      }),
    ).rejects.toThrow("org_ruleset_readback_mismatch");
  });

  it("keeps source workflow writes idempotent when content is unchanged", async () => {
    const workflow = "name: ReviewRouter Required\n";
    const requester = new FakeRequester((route) => {
      if (route === "GET /repos/{owner}/{repo}/contents/{path}") {
        return {
          data: {
            type: "file",
            sha: "existing-sha",
            content: Buffer.from(workflow).toString("base64"),
          },
        };
      }
      throw new Error(`unexpected route ${route}`);
    });
    const gateway = new OctokitOrgRulesetSetupGateway(requester);

    await expect(
      gateway.writeSourceWorkflow({
        owner: "agent-teams-ai",
        repo: "alpha",
        branch: "main",
        path: ".github/workflows/reviewrouter-required.yml",
        content: workflow,
        message: "chore: add ReviewRouter required workflow",
      }),
    ).resolves.toEqual({ sha: "existing-sha" });
    expect(requester.routes).toEqual([
      "GET /repos/{owner}/{repo}/contents/{path}",
    ]);
  });
});

class FakeRequester {
  public readonly routes: string[] = [];
  public readonly calls: Array<{
    readonly route: string;
    readonly parameters: Record<string, unknown> | undefined;
  }> = [];

  constructor(
    private readonly handler: (
      route: string,
      parameters: Record<string, unknown> | undefined,
    ) => { readonly data: unknown },
  ) {}

  async request(route: string, parameters?: Record<string, unknown>) {
    this.routes.push(route);
    this.calls.push({ route, parameters });
    return this.handler(route, parameters);
  }
}

function payload() {
  return buildGitHubOrgRulesetPayload({
    enforcement: "evaluate",
    sourceWorkflow: {
      repositoryId: "1001",
      repositoryFullName: "example/workflows",
      path: ".github/workflows/reviewrouter-required.yml",
      ref: "refs/heads/main",
    },
    targetSelection: {
      scope: "selected_repositories",
      repositoryIds: ["1002"],
    },
  });
}
