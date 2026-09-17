// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceSourceConnectionPanel } from "./workspace-source-connection";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./actions", () => ({
  requestInstallationSyncClientAction: vi.fn(async () => ({ params: {} })),
}));

afterEach(() => {
  cleanup();
});

describe("WorkspaceSourceConnectionPanel", () => {
  it("explains that GitHub is the repository source, not ChatGPT accounts", () => {
    render(
      <WorkspaceSourceConnectionPanel
        workspaceId="workspace-1"
        workspaceKey="Padelapp-Club"
        hasWorkspaceWideAccess
        mutationsEnabled
        repositories={[]}
        gitLabInstallations={[]}
        installations={[
          {
            accountLogin: "Padelapp-Club",
            accountType: "Organization",
            accountAvatarUrl: null,
            githubInstallationId: "123",
            status: "active",
            repositorySelection: "all",
          },
        ]}
      />,
    );

    expect(screen.getByText("Source of repositories")).toBeTruthy();
    expect(screen.getByText("GitHub and GitLab connection")).toBeTruthy();
    expect(
      screen.getAllByText(/GitLab group or project/).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByText(/Repositories on this page come from that connection/),
    ).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Accounts" }).getAttribute("href"),
    ).toBe(
      "/dashboard/setup?workspace=Padelapp-Club#dashboard-section-content",
    );
    expect(screen.getByText("Padelapp-Club")).toBeTruthy();
    expect(screen.getByText("Refresh repos")).toBeTruthy();
    expect(screen.queryByText("GitHub App connection")).toBeNull();
    expect(
      screen.queryByText("Installation sync and repository selection."),
    ).toBeNull();
  });

  it("keeps GitLab and extra GitHub install help collapsed when a source is already connected", () => {
    render(
      <WorkspaceSourceConnectionPanel
        workspaceId="workspace-1"
        workspaceKey="Padelapp-Club"
        hasWorkspaceWideAccess
        mutationsEnabled
        repositories={[]}
        gitLabInstallations={[]}
        installations={[
          {
            accountLogin: "Padelapp-Club",
            accountType: "Organization",
            accountAvatarUrl: null,
            githubInstallationId: "123",
            status: "active",
            repositorySelection: "all",
          },
        ]}
      />,
    );

    const addSource = screen
      .getByText("Connect another GitHub or GitLab source")
      .closest("details");
    expect(addSource?.open).toBe(false);
    expect(
      screen.getByRole("button", {
        name: "Connect GitLab (In development, unavailable)",
      }),
    ).toHaveProperty("disabled", true);
    expect(screen.queryByRole("link", { name: /Connect GitLab/i })).toBeNull();
  });
});
