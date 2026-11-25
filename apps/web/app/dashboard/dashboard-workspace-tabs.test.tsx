// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardWorkspaceTabs } from "./dashboard-workspace-tabs";
import { WorkspaceSwitcher } from "./dashboard-workspace-navigation";

vi.mock("../connect-source-dialog", () => ({
  ConnectSourceDialog: () => null,
}));

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

describe("DashboardWorkspaceTabs", () => {
  it("renders a GitHub redirect request as an ephemeral pending workspace tab", async () => {
    Object.defineProperty(document, "referrer", {
      value:
        "https://github.com/apps/review-router-ai/installations/select_target",
      configurable: true,
    });

    render(
      <DashboardWorkspaceTabs
        selectedWorkspaceId="workspace-personal"
        items={[
          {
            id: "workspace-personal",
            label: "777genius",
            repositoryCount: 268,
            href: "/dashboard?workspace=777genius",
          },
        ]}
        pendingInstallRequest={{
          id: "github-app-organization-request-pending",
          label: "Padelapp-Club",
          statusLabel: "Request pending",
          href: "/dashboard?section=repositories",
        }}
      />,
    );

    expect(screen.getByText("777genius")).toBeTruthy();
    expect(screen.getByText("268 repos")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText("Padelapp-Club")).toBeTruthy();
      expect(screen.getByText("Request pending")).toBeTruthy();
    });
    expect(screen.queryByText("0 repos")).toBeNull();
  });
});

describe("WorkspaceSwitcher pending organization links", () => {
  it.each([
    [
      "context-tools",
      "/dashboard/context-tools?workspaceId=workspace+%2F%2B%26%3F",
    ],
    ["repositories", "/dashboard?section=repositories"],
    ["setup", "/dashboard/setup"],
  ] as const)(
    "keeps the pending %s tab on the authorized workspace route",
    async (selectedSection, expectedHref) => {
      Object.defineProperty(document, "referrer", {
        value:
          "https://github.com/apps/review-router-ai/installations/select_target",
        configurable: true,
      });
      const selectedWorkspaceId = "workspace /+&?";
      render(
        <WorkspaceSwitcher
          part="tabs"
          selectedWorkspaceId={selectedWorkspaceId}
          selectedSection={selectedSection}
          appInstallUrl={null}
          workspaces={[
            {
              workspace: {
                id: selectedWorkspaceId,
                name: "acme",
                slug: "acme",
                installations: [],
                gitLabInstallations: [],
                auditEvents: [],
              },
              repositoryCount: 1,
              hasWorkspaceWideAccess: true,
            },
          ]}
          pendingOrganizationInstallRequest={{
            id: "github-app-organization-request-pending",
            accountLogin: "Padelapp-Club",
          }}
          fallbackUser={{ githubLogin: null, githubAvatarUrl: null }}
        />,
      );
      const pending = await screen.findByRole("tab", { name: /Padelapp-Club/ });
      expect(pending.getAttribute("href")).toBe(expectedHref);
    },
  );
});
