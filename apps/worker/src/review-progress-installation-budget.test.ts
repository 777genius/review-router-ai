import { describe, expect, it, vi } from "vitest";
import { reserveProgressCommentNotice } from "./review-progress-installation-budget";

const lockedAt = new Date("2026-11-21T12:00:00.000Z");
const scope = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "connection-1",
  scmRepositoryIdentityId: "repository-1",
  pullRequestNumber: 42,
};

// Plan 88: a start notice may write the progress comment only while live
// progress of the same pull request is neither being nor waiting to be
// published, and it takes the installation write budget like the publisher.
describe("reserveProgressCommentNotice", () => {
  it("reserves one mutation and returns the known comment id when progress is idle", async () => {
    const f = fixture({
      publication: published({ commentId: 77n }),
    });
    await expect(f.reserve()).resolves.toEqual({
      allowed: true,
      commentId: 77n,
    });
    expect(f.budgetUpdate).toHaveBeenCalledWith({
      where: { githubInstallationId: 9n },
      data: {
        nextMutationAt: new Date(lockedAt.getTime() + 1_000),
        updatedAt: lockedAt,
      },
    });
  });

  it("creates the comment when the pull request has no progress yet", async () => {
    await expect(fixture({ publication: null }).reserve()).resolves.toEqual({
      allowed: true,
      commentId: null,
    });
  });

  it.each([
    [
      "live progress holds a claim",
      {
        publication: published({
          claimUntil: new Date(lockedAt.getTime() + 1),
        }),
      },
    ],
    [
      "a progress version waits to be published",
      { publication: published({ desiredVersion: 4n, publishedVersion: 3n }) },
    ],
    [
      "the installation is cooling down after a rate limit",
      {
        publication: published({}),
        cooldownUntil: new Date(lockedAt.getTime() + 60_000),
      },
    ],
    [
      "the installation wrote less than a second ago",
      {
        publication: published({}),
        nextMutationAt: new Date(lockedAt.getTime() + 500),
      },
    ],
  ])("waits while %s", async (_name, options) => {
    const f = fixture(options);
    await expect(f.reserve()).resolves.toEqual({ allowed: false });
    expect(f.budgetUpdate).not.toHaveBeenCalled();
  });
});

function published(
  overrides: Partial<{
    claimUntil: Date | null;
    desiredVersion: bigint;
    publishedVersion: bigint;
    commentId: bigint | null;
  }>,
) {
  return {
    claimUntil: null,
    desiredVersion: 3n,
    publishedVersion: 3n,
    commentId: 55n,
    ...overrides,
  };
}

function fixture(options: {
  publication: ReturnType<typeof published> | null;
  nextMutationAt?: Date;
  cooldownUntil?: Date | null;
}) {
  const budgetUpdate = vi.fn(async () => ({}));
  const findUnique = vi.fn(async () => options.publication);
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async (query: { strings: readonly string[] }) =>
      query.strings.join(" ").includes("clock_timestamp()")
        ? [{ lockedAt }]
        : [],
    reviewProgressInstallationBudgetV1: {
      findUniqueOrThrow: async () => ({
        nextMutationAt: options.nextMutationAt ?? lockedAt,
        cooldownUntil: options.cooldownUntil ?? null,
      }),
      update: budgetUpdate,
    },
    reviewProgressPublicationV1: { findUnique },
  };
  return {
    budgetUpdate,
    reserve: async () => {
      const result = await reserveProgressCommentNotice(transaction as never, {
        scope,
        installationId: 9n,
        minimumIntervalMs: 1_000,
      });
      expect(findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId_repositoryConnectionId_scmRepositoryIdentityId_pullRequestNumber:
              scope,
          },
        }),
      );
      return result;
    },
  };
}
