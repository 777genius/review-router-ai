import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDashboardWorkspaceAdminMutationAllowed: vi.fn(),
  installGitLabConnectProjects: vi.fn(),
}));

vi.mock("../../../../../src/server/dashboard-mutations", () => ({
  assertDashboardWorkspaceAdminMutationAllowed:
    mocks.assertDashboardWorkspaceAdminMutationAllowed,
}));

vi.mock("../../../../../src/server/gitlab-connect", () => ({
  installGitLabConnectProjects: mocks.installGitLabConnectProjects,
}));

import { POST } from "./route";

describe("GitLab install route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertDashboardWorkspaceAdminMutationAllowed.mockResolvedValue({
      userId: "user_1",
    });
    mocks.installGitLabConnectProjects.mockResolvedValue({
      installationId: "gitlab_install_1",
      source: {
        inputPath: "acme/platform",
        resolvedKind: "group",
        baseUrl: "https://gitlab.com",
        parentGroupPath: null,
      },
      namespacePath: "acme/platform",
      requested: 1,
      succeeded: 1,
      failed: 0,
      setupMergeRequests: [],
      results: [],
    });
  });

  it("refuses disabled dashboard writes before installation work", async () => {
    mocks.assertDashboardWorkspaceAdminMutationAllowed.mockRejectedValueOnce(
      new Error("dashboard_mutations_disabled"),
    );
    const response = await POST(
      jsonRequest({
        workspaceId: "workspace_1",
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "glpat-secret-token",
        selectedProjectIds: ["101"],
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: {
        code: "dashboard_mutations_disabled",
        message: "dashboard mutations disabled",
      },
    });
    expect(mocks.installGitLabConnectProjects).not.toHaveBeenCalled();
  });

  it("passes the GitLab token only to the request-scoped installer and never returns it", async () => {
    const response = await POST(
      jsonRequest({
        workspaceId: "workspace_1",
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "glpat-secret-token",
        selectedProjectIds: ["101"],
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(200);
    expect(mocks.installGitLabConnectProjects).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      sourceUrl: "https://gitlab.com/acme/platform",
      token: "glpat-secret-token",
      selectedProjectIds: ["101"],
      installedByUserId: "user_1",
    });
    expect(JSON.stringify(body)).not.toContain("glpat-secret-token");
  });

  it.each([
    "gitlab_repository_already_owned",
    "gitlab_install_superseded",
    "gitlab_connect_project_selection_stale",
  ])("returns sanitized conflict for %s", async (code) => {
    mocks.installGitLabConnectProjects.mockRejectedValueOnce(new Error(code));
    const response = await POST(
      jsonRequest({
        workspaceId: "workspace_1",
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "glpat-secret-token",
        selectedProjectIds: ["101"],
      }),
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code, message: code.replaceAll("_", " ") },
    });
  });

  it("redacts token-like details from install errors", async () => {
    mocks.installGitLabConnectProjects.mockRejectedValueOnce(
      new Error("gitlab_api_error_401: glpat-secret-token"),
    );

    const response = await POST(
      jsonRequest({
        workspaceId: "workspace_1",
        sourceUrl: "https://gitlab.com/acme/platform",
        token: "glpat-secret-token",
        selectedProjectIds: ["101"],
      }),
    );

    const body = await response.json();
    expect(response.status).toBe(401);
    expect(body).toEqual({
      error: {
        code: "gitlab_api_error_401",
        message: "gitlab api error 401",
      },
    });
    expect(JSON.stringify(body)).not.toContain("glpat-secret-token");
  });
});

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/dashboard/gitlab/install", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
