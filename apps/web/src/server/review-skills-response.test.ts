import { describe, expect, it, vi } from "vitest";
import { enrichReviewSkillsResponse } from "./review-skills-response";

describe("authorized Skills response enrichment", () => {
  it("enriches only returned target IDs and preserves sparse page cursors", async () => {
    const read = vi.fn().mockResolvedValue([
      {
        repositoryId: "allowed",
        name: "acme/allowed",
        status: "ready",
        reason: "supported",
      },
    ]);
    const page = {
      items: [
        {
          repositoryId: "allowed",
          name: "acme/allowed",
          active: true,
          assigned: false,
          bindingVersion: null,
        },
      ],
      nextCursor: "denied-candidate-cursor",
    };
    const result = await enrichReviewSkillsResponse(
      "listSkillRepositoryTargets",
      { workspaceId: "workspace", skillId: "skill" },
      page,
      read,
    );
    expect(read).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repositoryIds: ["allowed"],
    });
    expect(result.nextCursor).toBe(page.nextCursor);
    expect(result.items[0]?.readiness.status).toBe("ready");
    read.mockClear();
    const empty = await enrichReviewSkillsResponse(
      "listSkillRepositoryTargets",
      { workspaceId: "workspace", skillId: "skill" },
      { items: [], nextCursor: "more-candidates" },
      read,
    );
    expect(read).toHaveBeenCalledWith({
      workspaceId: "workspace",
      repositoryIds: [],
    });
    expect(empty).toEqual({ items: [], nextCursor: "more-candidates" });
  });
  it("enriches the exact assignment selection and settings after service reads", async () => {
    const read = vi.fn().mockResolvedValue([
      {
        repositoryId: "repo",
        name: "acme/repo",
        status: "unknown",
        reason: "workflow_unconfirmed",
      },
    ]);
    const choices = await enrichReviewSkillsResponse(
      "listAssignmentChoices",
      { workspaceId: "workspace", repositoryIds: ["repo"], assignedOnly: true },
      { items: [], nextCursor: null },
      read,
    );
    expect(choices.repositoryReadiness).toHaveLength(1);
    const settings = await enrichReviewSkillsResponse(
      "loadRepositorySkillSettings",
      { workspaceId: "workspace", repositoryId: "repo" },
      {
        repositoryId: "repo",
        roots: [],
        sourceVersion: 0,
        bindings: [],
        unavailable: [],
      },
      read,
    );
    expect(settings.readiness.reason).toBe("workflow_unconfirmed");
  });
  it("does not repeat repository readiness reads for assignment continuation pages", async () => {
    const read = vi.fn();
    const page = { items: [], nextCursor: "next-skill" };
    const result = await enrichReviewSkillsResponse(
      "listAssignmentChoices",
      {
        workspaceId: "workspace",
        repositoryIds: ["repo"],
        assignedOnly: true,
        cursor: "previous-skill",
      },
      page,
      read,
    );
    expect(result).toEqual({ ...page, repositoryReadiness: [] });
    expect(result.items).toBe(page.items);
    expect(read).not.toHaveBeenCalled();
  });
  it("does not add capability reads to mutations", async () => {
    const read = vi.fn();
    const value = { added: 1, removed: 0, unchanged: 0 };
    expect(
      await enrichReviewSkillsResponse(
        "applyAssignments",
        {
          workspaceId: "workspace",
          repositoryIds: ["repo"],
          skillIds: ["skill"],
          mode: "add",
        },
        value,
        read,
      ),
    ).toBe(value);
    expect(read).not.toHaveBeenCalled();
  });
});
