import { describe, expect, it } from "vitest";
import type { ReviewSnapshotRepositoryPort } from "../application/ports/review-snapshot-repository-port";
import { commitReviewSnapshot } from "../application/use-cases/commit-review-snapshot";
import { restoreReviewSnapshot } from "../application/use-cases/restore-review-snapshot";
import {
  ReviewSnapshotRestoreStatus,
  ReviewSnapshotSeverity,
  reviewSnapshotSchemaVersion,
  type ReviewSnapshotCandidate,
  type ReviewSnapshotRecord,
} from "../domain/review-snapshot";
const now = new Date("2026-11-03T00:00:00Z");
const repositoryId = "repo_1";
const pullRequestNumber = 240;
const baseSha = "b".repeat(40);
const headSha = "a".repeat(40);
describe("installation token snapshot redaction", () => {
  it.each([
    `ghs_${"a".repeat(36)}`,
    `ghs_12345_eyJ${"a".repeat(180)}.${"b".repeat(200)}.${"c".repeat(125)}`,
    `ghs_12345_eyJ${"a-b_".repeat(50)}.${"c_d-".repeat(50)}.${"e-f_".repeat(50)}`,
  ])(
    "fully redacts installation tokens through commit and restore: %#",
    async (token) => {
      const snapshots = new InMemoryReviewSnapshotRepository();
      const source = candidate();
      await commitReviewSnapshot(
        {
          expectedVersion: 0,
          candidate: {
            ...source,
            payload: {
              reviewSummary: `Found ${token}; investigate`,
              findings: [
                {
                  ...source.payload.findings[0]!,
                  title: `Found ${token}`,
                  message: `Value '${token}'`,
                },
              ],
            },
          },
        },
        { snapshots, now },
      );
      const expectedPayload = {
        reviewSummary: "Found ghs_***; investigate",
        findings: [
          {
            ...source.payload.findings[0]!,
            title: "Found ghs_***",
            message: "Value 'ghs_***'",
          },
        ],
      };
      expect(snapshots.record?.payload).toEqual(expectedPayload);
      const restored = await restoreReviewSnapshot(
        {
          workspaceId: source.workspaceId,
          repositoryId,
          pullRequestNumber,
          baseSha,
        },
        { snapshots, now },
      );
      expect(restored).toMatchObject({
        status: ReviewSnapshotRestoreStatus.Found,
        snapshot: { payload: expectedPayload },
      });
    },
  );
});
function candidate(): ReviewSnapshotCandidate {
  return {
    workspaceId: "workspace_1",
    repositoryId,
    pullRequestNumber,
    schemaVersion: reviewSnapshotSchemaVersion,
    reviewedHeadSha: headSha,
    baseSha,
    compatibilityKey: "f".repeat(64),
    sourceRunId: "run_100",
    sourceRunAttempt: "1",
    payload: {
      reviewSummary: "Review complete",
      findings: [
        {
          file: "src/index.ts",
          line: 12,
          severity: ReviewSnapshotSeverity.Major,
          title: "State is not persisted",
          message: "Persist the state before returning.",
          confidence: 0.9,
        },
      ],
    },
  };
}

class InMemoryReviewSnapshotRepository implements ReviewSnapshotRepositoryPort {
  record: ReviewSnapshotRecord | null = null;
  async find() {
    return this.record;
  }
  async commit(input: {
    expectedVersion: number;
    record: ReviewSnapshotRecord;
  }) {
    this.record = input.record;
    return { status: "committed" as const, snapshot: input.record };
  }
  async pruneExpired() {
    return 0;
  }
}
