import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ReviewSkillsError,
  ReviewSkillsErrorCode,
} from "@reviewrouter/features-review-skills";

const h = vi.hoisted(() => ({
  actor: vi.fn(),
  operation: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../../src/server/dashboard-mutations", () => ({
  getDashboardSignedInActor: h.actor,
}));
vi.mock("../../src/server/review-skills-composition", () => ({
  productionReviewSkills: async () => ({ listAssignmentChoices: h.operation }),
}));
vi.mock("../../src/server/repository-skills-readiness", () => ({
  readRepositorySkillsReadiness: h.readiness,
}));
import { executeReviewSkills } from "./review-skills-actions";

const request = {
  method: "listAssignmentChoices" as const,
  input: {
    workspaceId: "workspace",
    repositoryIds: ["repo"],
    assignedOnly: true,
  },
};
describe("Skills action readiness authorization ordering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.actor.mockResolvedValue({ userId: "actor" });
    h.operation.mockResolvedValue({ items: [], nextCursor: null });
    h.readiness.mockResolvedValue([
      {
        repositoryId: "repo",
        name: "acme/repo",
        status: "unknown",
        reason: "runtime_unconfirmed",
      },
    ]);
  });
  it("reads support only after the service positively authorizes the exact selection", async () => {
    expect(await executeReviewSkills(request)).toMatchObject({
      status: "ok",
      value: { repositoryReadiness: [{ repositoryId: "repo" }] },
    });
    expect(h.operation).toHaveBeenCalledWith({
      ...request.input,
      actor: { userId: "actor" },
    });
    expect(h.readiness).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repositoryIds: ["repo"],
    });
    expect(h.operation.mock.invocationCallOrder[0]).toBeLessThan(
      h.readiness.mock.invocationCallOrder[0]!,
    );
  });
  it("never reads support for an unauthorized repository or absent session", async () => {
    h.operation.mockRejectedValue(
      new ReviewSkillsError(ReviewSkillsErrorCode.Forbidden),
    );
    expect(await executeReviewSkills(request)).toMatchObject({
      status: "error",
      code: "forbidden",
    });
    expect(h.readiness).not.toHaveBeenCalled();
    h.actor.mockResolvedValue(null);
    expect(await executeReviewSkills(request)).toMatchObject({
      status: "error",
      code: "forbidden",
    });
    expect(h.readiness).not.toHaveBeenCalled();
  });
});
