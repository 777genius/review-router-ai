import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
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
vi.mock("../form-submit-button", () => ({
  FormSubmitButton: () => <button type="submit">Enable ruleset</button>,
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

function workspace(accountType?: "Organization" | "User", planName?: string): DashboardWorkspace {
  return {
    id: "workspace-1",
    name: "Example",
    installations: accountType
      ? [{
          accountType,
          accountLogin: "example-org",
          githubInstallationId: "123",
          status: "active",
          organizationSecretPolicy: planName
            ? { planName }
            : null,
        }]
      : [],
  } as unknown as DashboardWorkspace;
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
    expect(html).toContain("Enable ruleset");
    expect(html).toContain("Use setup PR fallback");
  });
});
