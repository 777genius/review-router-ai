import { describe, expect, it } from "vitest";
import {
  isPublishableGitHubRepository,
  matchesActiveProgressIdentity,
} from "./review-progress-claim-eligibility-policy";

describe("Review progress claim eligibility policy", () => {
  it("requires exact active progress identity", () => {
    const progress = {
      generation: 7n,
      headSha: "a".repeat(40),
      planHash: "b".repeat(64),
      desiredVersion: 12n,
    };
    const publication = {
      activeGeneration: progress.generation,
      activeHeadSha: progress.headSha,
      activePlanHash: progress.planHash,
      desiredVersion: progress.desiredVersion,
    };
    expect(matchesActiveProgressIdentity(progress, publication)).toBe(true);
    for (const mismatched of [
      { ...progress, generation: 8n },
      { ...progress, headSha: "c".repeat(40) },
      { ...progress, planHash: "d".repeat(64) },
      { ...progress, desiredVersion: 13n },
    ]) {
      const matches = matchesActiveProgressIdentity(mismatched, publication);
      expect(matches).toBe(false);
    }
  });

  it("requires an eligible GitHub repository", () => {
    const repository = {
      workspaceId: "workspace-1",
      scmRepositoryIdentityId: "repository-1",
      selected: true,
      archived: false,
      provider: "github",
    };
    const publication = {
      workspaceId: "workspace-1",
      scmRepositoryIdentityId: "repository-1",
    };
    expect(
      isPublishableGitHubRepository(repository, "active", publication),
    ).toBe(true);
    for (const mismatched of [
      { ...repository, workspaceId: "other" },
      { ...repository, scmRepositoryIdentityId: "other" },
      { ...repository, scmRepositoryIdentityId: null },
      { ...repository, selected: false },
      { ...repository, archived: true },
      { ...repository, provider: "gitlab" },
    ]) {
      expect(
        isPublishableGitHubRepository(mismatched, "active", publication),
      ).toBe(false);
    }
    expect(
      isPublishableGitHubRepository(repository, "suspended", publication),
    ).toBe(false);
  });
});
