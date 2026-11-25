import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  HistoryAccessError,
  HistoryValidationError,
} from "@reviewrouter/features-review-history/contracts";
const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  composition: vi.fn(),
  list: vi.fn(),
  runs: vi.fn(),
  repositories: vi.fn(),
  prisma: {},
}));
vi.mock("./dashboard-mutations", () => ({
  getDashboardSignedInActor: mocks.actor,
}));
vi.mock("./prisma", () => ({ getPrisma: () => mocks.prisma }));
vi.mock("@reviewrouter/features-review-history/composition", () => ({
  createReviewHistoryFeature: mocks.composition,
}));
import {
  loadHistoryList,
  loadHistoryRuns,
  loadHistoryRepositories,
  historyErrorStatus,
} from "./review-history";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.actor.mockResolvedValue({ userId: "session-actor" });
  mocks.composition.mockResolvedValue({
    reader: {
      listPullRequests: mocks.list,
      listRuns: mocks.runs,
      listRepositories: mocks.repositories,
    },
  });
});
describe("Reviews server trust boundary", () => {
  it("uses only the session actor for each scoped operation and preserves the cursor/window", async () => {
    await loadHistoryList(
      "workspace-a",
      new URLSearchParams({
        actorId: "forged",
        q: "search",
        days: "7",
        cursor: "window",
      }),
    );
    await loadHistoryRuns(
      "workspace-a",
      new URLSearchParams({
        actorId: "forged",
        pullRequestId: "opaque-pr",
        cursor: "older",
      }),
    );
    await loadHistoryRepositories(
      "workspace-a",
      new URLSearchParams({
        actorId: "forged",
        selectedRepositoryId: "scm-a",
        q: "repo",
      }),
    );
    expect(mocks.list).toHaveBeenCalledWith({
      actorId: "session-actor",
      workspaceId: "workspace-a",
      filters: { q: "search", repositoryId: null, status: "all", days: 7 },
      cursor: "window",
    });
    expect(mocks.runs).toHaveBeenCalledWith({
      actorId: "session-actor",
      workspaceId: "workspace-a",
      pullRequestId: "opaque-pr",
      cursor: "older",
    });
    expect(mocks.repositories).toHaveBeenCalledWith({
      actorId: "session-actor",
      workspaceId: "workspace-a",
      q: "repo",
      selectedRepositoryId: "scm-a",
    });
  });
  it("requires sign-in before constructing the feature and never exposes infrastructure errors", async () => {
    mocks.actor.mockResolvedValue(null);
    const error = await loadHistoryList(
      "workspace-a",
      new URLSearchParams(),
    ).catch((value: unknown) => value);
    expect(historyErrorStatus(error)).toBe(401);
    expect(mocks.composition).not.toHaveBeenCalled();
    expect(historyErrorStatus(new HistoryAccessError())).toBe(403);
    expect(historyErrorStatus(new HistoryValidationError())).toBe(400);
    expect(
      historyErrorStatus(new Error("private SQL connection credentials")),
    ).toBe(500);
  });
});
