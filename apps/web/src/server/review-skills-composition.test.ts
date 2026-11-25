import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReviewSkillsRepositoryAccessPort } from "@reviewrouter/features-review-skills";

const h = vi.hoisted(() => ({
  compose: vi.fn(),
  membership: vi.fn(),
  repositories: vi.fn(),
  identity: vi.fn(),
  session: vi.fn(),
  permission: vi.fn(),
  cachePermission: vi.fn(),
}));
vi.mock("@reviewrouter/features-review-skills/composition", () => ({
  createPrismaReviewSkillsService: h.compose,
}));
vi.mock("./prisma", () => ({
  getPrisma: () => ({
    workspaceMember: { findUnique: h.membership },
    repositoryConnection: { findMany: h.repositories },
    userExternalIdentity: { findUnique: h.identity },
  }),
}));
vi.mock("next-auth", () => ({ getServerSession: h.session }));
vi.mock("@reviewrouter/features-auth", () => ({}));
vi.mock("@reviewrouter/platform-config", () => ({
  requireGitHubAppPrivateKey: () => "synthetic-private-key",
}));
vi.mock("../auth/auth-env", () => ({
  getAuthEnvironmentStatus: () => ({ configured: true, missing: [] }),
}));
vi.mock("../auth/auth-options", () => ({ authOptions: {} }));
vi.mock("./github-user-repository-access", () => ({
  updateRepositoryPermissionCacheFromLiveCheck: h.cachePermission,
}));
vi.mock("@octokit/app", () => ({
  App: class App {
    getInstallationOctokit() {
      return { request: h.permission };
    }
  },
}));

import { productionReviewSkills } from "./review-skills-composition";

const actor = { userId: "user-1" };
const repository = (id: string) => ({
  id,
  workspaceId: "workspace-1",
  provider: "github",
  githubRepositoryId: 123n,
  owner: "synthetic",
  name: id,
  selected: true,
  archived: false,
  installation: { githubInstallationId: 456n, status: "active" },
});
const facts = (permission: string, role_name: string) => ({
  data: {
    permission,
    role_name,
    user: { id: 123, login: "synthetic-user" },
  },
});
async function authorize(repositoryIds = ["repo-write", "repo-read"]) {
  await productionReviewSkills();
  const { repositoryAccess } = h.compose.mock.lastCall![0] as {
    repositoryAccess: ReviewSkillsRepositoryAccessPort;
  };
  return repositoryAccess.authorizeRepositoryManagement({
    actor,
    workspaceId: "workspace-1",
    repositoryIds,
  });
}

describe("production Skills repository proof adapter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.membership.mockResolvedValue({ role: "member" });
    h.repositories.mockResolvedValue([
      repository("repo-write"),
      repository("repo-read"),
    ]);
    h.identity.mockResolvedValue({ userId: actor.userId });
    h.session.mockResolvedValue({
      user: {
        sourceProvider: "github",
        externalUserId: "123",
        sourceLogin: "synthetic-user",
        githubUserId: "123",
        githubLogin: "synthetic-user",
      },
    });
    h.permission.mockImplementation(
      async (_route: string, input: { repo: string }) =>
        input.repo === "repo-write"
          ? facts("write", "write")
          : facts("read", "read"),
    );
    h.cachePermission.mockResolvedValue(undefined);
    vi.stubEnv("GITHUB_APP_ID", "789");
    vi.stubEnv("REVIEW_ROUTER_ENABLE_DASHBOARD_MUTATIONS", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns writer proofs from mixed write/read target candidates", async () => {
    await expect(authorize()).resolves.toEqual(["repo-write"]);
    expect(h.permission).toHaveBeenCalledTimes(2);
    expect(h.cachePermission).toHaveBeenCalledWith(
      expect.objectContaining({ repositoryId: "repo-read", canManage: false }),
    );
  });

  it.each([
    ["upstream outage", new Error("network unavailable")],
    [
      "upstream forbidden transport",
      Object.assign(new Error("forbidden"), { status: 403 }),
    ],
  ])(
    "propagates %s instead of returning a partial page",
    async (_label, error) => {
      h.permission.mockImplementation(
        async (_route: string, input: { repo: string }) => {
          if (input.repo === "repo-read") throw error;
          return facts("write", "write");
        },
      );
      await expect(authorize()).rejects.toThrow();
    },
  );

  it.each([
    ["malformed permission", { data: { permission: "unexpected" } }],
    [
      "incomplete denial facts",
      {
        data: {
          permission: "read",
          user: { id: 123, login: "synthetic-user" },
        },
      },
    ],
    [
      "mismatched upstream user",
      {
        data: {
          permission: "read",
          role_name: "read",
          user: { id: 124, login: "someone-else" },
        },
      },
    ],
  ])(
    "propagates %s instead of treating it as a completed denial",
    async (_label, response) => {
      h.permission.mockResolvedValue(response);
      await expect(authorize()).rejects.toThrow(
        "repository_mutation_forbidden",
      );
    },
  );

  it("rejects a changed signed-in actor after a positive SCM check", async () => {
    h.identity.mockResolvedValue({ userId: "different-user" });
    h.permission.mockResolvedValue(facts("write", "write"));
    await expect(authorize()).rejects.toThrow("review_skills_actor_changed");
  });
});
