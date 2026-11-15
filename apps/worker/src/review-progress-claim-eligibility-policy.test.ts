import { describe, expect, it } from "vitest";
import {
  buildClaimedReviewProgress,
  isPublishableGitHubRepository,
  matchesActiveProgressIdentity,
  repositoryCohortPredicate,
} from "./review-progress-claim-eligibility-policy";

describe("Review progress claim eligibility policy", () => {
  it("binds each hosted repository name as a SQL value", () => {
    const predicate = repositoryCohortPredicate(
      new Set(["acme/rocket", "other/repo"]),
    );
    expect(predicate.strings.join(" ")).toContain(
      'LOWER(repository."fullName") IN',
    );
    expect(predicate.values).toEqual(["acme/rocket", "other/repo"]);
  });

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

  it("projects the fenced publication into an immutable worker claim", () => {
    const candidate = {
      workspaceId: "workspace-1",
      repositoryConnectionId: "connection-1",
      scmRepositoryIdentityId: "identity-1",
      pullRequestNumber: 42,
    };
    const publication = {
      publishedVersion: 7n,
      commentId: 77n,
      publishedBodyHash: "c".repeat(64),
      failureCount: 2,
    };
    const snapshotJson = { completed: 3 };
    const progress = {
      executionId: "execution-1",
      generation: 9n,
      headSha: "a".repeat(40),
      planHash: "b".repeat(64),
      desiredVersion: 8n,
      snapshotJson,
      terminalOutcome: "complete",
    };
    const repository = { owner: "example", name: "repo" };
    const installation = { githubInstallationId: 12n };
    const claim = {
      claimId: "claim-1",
      ownerIdHash: "d".repeat(64),
      claimUntil: new Date("2026-11-15T00:00:00Z"),
    };
    const input = {
      candidate,
      publication,
      progress,
      repository,
      installation,
      claim,
    };
    const result = buildClaimedReviewProgress(input);

    expect(result).toEqual({
      scope: candidate,
      executionId: progress.executionId,
      generation: progress.generation,
      headSha: progress.headSha,
      planHash: progress.planHash,
      desiredVersion: progress.desiredVersion,
      ...publication,
      snapshot: snapshotJson,
      terminal: true,
      repository: { ...repository, ...installation },
      claim,
    });
    expect(result.scope).toBe(candidate);
    expect(result.snapshot).toBe(snapshotJson);
    expect(result.claim).toBe(claim);
    expect(
      buildClaimedReviewProgress({
        ...input,
        progress: { ...progress, terminalOutcome: null },
      }).terminal,
    ).toBe(false);
  });
});
