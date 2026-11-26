import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps, ReactNode } from "react";
import type { DashboardWorkspace } from "./dashboard-workspace-navigation";
import { OrgRulesetAdvancedCard } from "./dashboard-org-ruleset-card";

vi.mock("./actions", () => ({
  enableOrgRulesetWorkflowClientAction: vi.fn(),
}));
vi.mock("./dashboard-action-form", () => ({
  DashboardActionForm: ({ children }: { readonly children: ReactNode }) => (
    <form>{children}</form>
  ),
}));
vi.mock("../github-app-install-permission-dialog", () => ({
  GitHubAppInstallPermissionDialog: ({
    children,
  }: {
    readonly children: ReactNode;
  }) => <span>{children}</span>,
}));

const baseProps = {
  orgRuleset: null,
  mutationsEnabled: true,
  appInstallUrl: "https://github.com/apps/reviewrouter/installations/new",
  permissionUpgradeNeeded: false,
} as const;

type CardProps = ComponentProps<typeof OrgRulesetAdvancedCard>;

function workspace(
  accountType?: "Organization" | "User",
  planName?: string,
  status = "active",
): DashboardWorkspace {
  return {
    id: "workspace-1",
    name: "Example",
    slug: "example",
    gitLabInstallations: [],
    auditEvents: [],
    installations: accountType
      ? [
          {
            accountType,
            accountLogin: "example-org",
            githubInstallationId: "123",
            accountAvatarUrl: null,
            repositorySelection: "selected",
            status,
            organizationSecretPolicy: planName
              ? {
                  planName,
                  privateRepositoriesAvailable: planName !== "free",
                  status: "available",
                }
              : null,
          },
        ]
      : [],
  };
}

function ruleset(
  overrides: Partial<NonNullable<CardProps["orgRuleset"]>> = {},
): NonNullable<CardProps["orgRuleset"]> {
  return {
    status: "configured",
    scope: "selected_repositories",
    enforcement: "evaluate",
    safeErrorCode: null,
    rulesetUrl: null,
    ...overrides,
  };
}

describe("organization ruleset settings extraction", () => {
  it("does not offer organization rulesets for personal-only workspaces", () => {
    expect(
      OrgRulesetAdvancedCard({ ...baseProps, workspace: workspace("User") }),
    ).toBeNull();
    expect(
      OrgRulesetAdvancedCard({ ...baseProps, workspace: workspace() }),
    ).toBeNull();
  });

  it("keeps the paid-plan gate and per-repository fallback", () => {
    const html = renderToStaticMarkup(
      <OrgRulesetAdvancedCard
        {...baseProps}
        workspace={workspace("Organization", "free")}
      />,
    );
    expect(html).toContain("Plan upgrade required");
    expect(html).toContain("Open repositories");
    expect(html).not.toContain("Ruleset enforcement");
  });

  it("retains the advanced form for eligible organization workspaces", () => {
    const html = renderToStaticMarkup(
      <OrgRulesetAdvancedCard
        {...baseProps}
        workspace={workspace("Organization", "team")}
      />,
    );
    expect(html).toContain("Repository scope");
    expect(html).toContain("Ruleset enforcement");
    expect(html).toContain("Enable org-wide");
    expect(html).toContain("Use setup PR fallback");
  });
  it.each<Partial<CardProps>>([
    { mutationsEnabled: false },
    { workspace: workspace("Organization", "team", "suspended") },
    { orgRuleset: ruleset({ status: "processing" }) },
    { orgRuleset: ruleset({ safeErrorCode: "org_rulesets_not_supported" }) },
  ])("preserves the submission guard for %j", (overrides) => {
    const html = renderToStaticMarkup(
      <OrgRulesetAdvancedCard
        {...baseProps}
        workspace={workspace("Organization", "team")}
        {...overrides}
      />,
    );
    expect(html).toMatch(
      /<button(?=[^>]*type="submit")(?=[^>]*disabled="")[^>]*>/,
    );
    expect(html).toContain('name="workspaceId" value="workspace-1"');
    expect(html).toContain('name="githubInstallationId" value="123"');
  });
});
