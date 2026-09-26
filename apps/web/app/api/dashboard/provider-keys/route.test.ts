import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  assertDashboardWorkspaceAdminAllowed: vi.fn(),
  providerApiKeyConnectionFindUnique: vi.fn(),
}));

vi.mock("../../../../src/server/dashboard-mutations", () => ({
  assertDashboardWorkspaceAdminAllowed:
    mocks.assertDashboardWorkspaceAdminAllowed,
}));

vi.mock("../../../../src/server/prisma", () => ({
  getPrisma: () => ({
    providerApiKeyConnection: {
      findUnique: mocks.providerApiKeyConnectionFindUnique,
    },
  }),
}));

describe("GET /api/dashboard/provider-keys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertDashboardWorkspaceAdminAllowed.mockResolvedValue({
      actor: "user:admin",
    });
  });

  it("returns saved repository state without exposing the encrypted or plaintext key", async () => {
    mocks.providerApiKeyConnectionFindUnique.mockResolvedValue({
      repositoryLinks: [
        {
          status: "applied",
          lastErrorReason: null,
          appliedAt: new Date("2026-09-26T10:00:00.000Z"),
          repository: { id: "repo_1", fullName: "acme/one" },
        },
      ],
    });

    const response = await GET(
      nextRequest(
        "http://localhost/api/dashboard/provider-keys?workspace=workspace_1&providerType=mimo",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      providerType: "mimo",
      connected: true,
      repositories: [
        {
          repositoryId: "repo_1",
          repositoryFullName: "acme/one",
          status: "applied",
          appliedAt: "2026-09-26T10:00:00.000Z",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toMatch(/api[_-]?key|encrypted/i);
    const query = mocks.providerApiKeyConnectionFindUnique.mock.calls[0]?.[0];
    expect(query.select).not.toHaveProperty("encryptedApiKey");
    expect(query.select).not.toHaveProperty(
      "repositoryLinks.select.encryptedApiKey",
    );
  });
});

function nextRequest(url: string) {
  return { nextUrl: new URL(url) } as Parameters<typeof GET>[0];
}
