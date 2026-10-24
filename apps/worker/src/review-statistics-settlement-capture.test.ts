import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { ReviewCompletionProcessState } from "@reviewrouter/features-review-processes";
import { reviewExecutionAbsoluteMaxProjectionBytes } from "@reviewrouter/features-review-executions";
import { StatisticsSeverity } from "@reviewrouter/features-review-statistics";
import {
  createReviewStatisticsSettlementCapture,
  readCapturedIssues,
} from "./review-statistics-settlement-capture";

const envelope = (occurrences: unknown[] = []) => ({
  envelopeVersion: "review_projection.v1",
  scope: { scmRepositoryIdentityId: "scm", pullRequestNumber: 12 },
  coverage: { state: "complete" },
  occurrences,
  snapshot: {
    lineageHints: [
      { lineageId: "a", severity: "major", title: "  A useful\n title  " },
    ],
  },
  publishing: { summary: { body: "" } },
});
const read = (value: ReturnType<typeof envelope>) =>
  readCapturedIssues({
    canonicalJson: JSON.stringify(value),
    expectedFindingCount: value.occurrences.length,
    scmRepositoryIdentityId: "scm",
    pullRequestNumber: 12,
  });

describe("statistics settlement host adapter", () => {
  it("counts only eligible lineages and preserves explicit unknown metadata", () => {
    const projection = envelope([
      { lineageId: "a", state: "new" },
      { lineageId: "a", state: "changed" },
      { lineageId: "b", state: "reconfirmed" },
      ...[
        "resolved",
        "carried_unverified",
        "uncertain",
        "suppressed_by_human",
      ].map((state) => ({ lineageId: state, state })),
    ]);
    expect(read(projection)).toEqual([
      {
        lineageId: "a",
        severity: StatisticsSeverity.Major,
        title: "A useful title",
      },
      {
        lineageId: "b",
        severity: StatisticsSeverity.Unknown,
        title: "Reported issue",
      },
    ]);
    expect(read(envelope())).toEqual([]);
  });
  it("accepts the authoritative 2 MiB ceiling and rejects one byte above", () => {
    const value = envelope();
    value.publishing.summary.body = "x".repeat(
      reviewExecutionAbsoluteMaxProjectionBytes -
        Buffer.byteLength(JSON.stringify(value)),
    );
    expect(Buffer.byteLength(JSON.stringify(value))).toBe(2_097_152);
    expect(read(value)).toEqual([]);
    value.publishing.summary.body += "x";
    expect(() => read(value)).toThrow("review_statistics_settlement_invalid");
  });
  it("rejects mismatched scope, incomplete coverage and unknown occurrence contracts", () => {
    const wrongScope = envelope();
    wrongScope.scope.pullRequestNumber = 13;
    expect(() => read(wrongScope)).toThrow();
    const partial = envelope();
    partial.coverage.state = "partial";
    expect(() => read(partial)).toThrow();
    expect(() =>
      read(envelope([{ lineageId: "a", state: "future_unsupported" }])),
    ).toThrow();
  });
  it("reads operational evidence through the supplied transaction and writes only compact metadata", async () => {
    const fixture = settlementFixture();
    const write = vi.fn(async () => {});
    await createReviewStatisticsSettlementCapture({ write })(
      fixture.tx,
      fixture.settlement,
    );
    expect(write).toHaveBeenCalledOnce();
    expect(write.mock.calls[0]).toEqual([
      fixture.tx,
      expect.objectContaining({
        executionId: "execution",
        publicationAttemptId: "publication",
        state: "completed",
        issues: [
          {
            lineageId: "a",
            severity: StatisticsSeverity.Major,
            title: "A useful title",
          },
        ],
      }),
    ]);
    expect(JSON.stringify(write.mock.calls[0])).not.toContain(
      "model or rendered review body",
    );
  });
  it("uses adjudicated success only when the original outcome is terminal unknown", async () => {
    const fixture = settlementFixture();
    const write = vi.fn(async () => {});
    fixture.publication.terminalOutcome = "terminal_unknown";
    fixture.correction.mockResolvedValue({
      correctionOrdinal: 2,
      correctedOutcome: "succeeded",
    });
    await createReviewStatisticsSettlementCapture({ write })(
      fixture.tx,
      fixture.settlement,
    );
    expect(write).toHaveBeenCalledOnce();
    fixture.publication.terminalOutcome = "failed_no_effect";
    await expect(
      createReviewStatisticsSettlementCapture({ write })(
        fixture.tx,
        fixture.settlement,
      ),
    ).rejects.toThrow("review_statistics_settlement_invalid");
    expect(write).toHaveBeenCalledOnce();
  });
  it("rejects a contradictory nonterminal publication even when an outcome is present", async () => {
    const fixture = settlementFixture();
    fixture.publication.state = "pending";
    const write = vi.fn(async () => {});
    await expect(
      createReviewStatisticsSettlementCapture({ write })(
        fixture.tx,
        fixture.settlement,
      ),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it("rejects cross-tenant or different-artifact publication without capturing", async () => {
    const fixture = settlementFixture();
    const write = vi.fn(async () => {});
    fixture.publication.workspaceId = "another-workspace";
    await expect(
      createReviewStatisticsSettlementCapture({ write })(
        fixture.tx,
        fixture.settlement,
      ),
    ).rejects.toThrow();
    expect(write).not.toHaveBeenCalled();
  });
});

function settlementFixture() {
  const projection = envelope([{ lineageId: "a", state: "new" }]);
  projection.publishing.summary.body = "model or rendered review body";
  const shared = {
    executionId: "execution",
    workspaceId: "workspace",
    repositoryConnectionId: "repository",
    scmRepositoryIdentityId: "scm",
    pullRequestNumber: 12,
    generation: 1n,
    reviewRevisionHash: "revision",
    authorizationId: "authorization",
    producerReleaseId: "producer",
  };
  const execution = {
    ...shared,
    finalizedArtifactId: "artifact",
    headSha: "head",
  };
  const artifact = {
    ...shared,
    artifactId: "artifact",
    reviewedHeadSha: "head",
    coverageState: "completed",
    projectionEnvelopeVersion: 1,
    projectionHash: "a".repeat(64),
    findingCount: 1,
    projectionEnvelopeCanonicalJson: JSON.stringify(projection),
  };
  const publication = {
    ...shared,
    publicationAttemptId: "publication",
    reviewedHeadSha: "head",
    projectionHash: "a".repeat(64),
    terminalOutcome: "succeeded",
    state: "terminal",
  };
  const correction = vi.fn<() => Promise<unknown>>(async () => null);
  const tx = {
    reviewExecutionV2: { findUnique: vi.fn(async () => execution) },
    finalizedReviewProjectionArtifactV2: {
      findUnique: vi.fn(async () => artifact),
    },
    reviewPublicationAttemptV2: { findUnique: vi.fn(async () => publication) },
    reviewPublicationOutcomeCorrectionV2: { findFirst: correction },
  } as unknown as Prisma.TransactionClient;
  return {
    tx,
    publication,
    correction,
    settlement: {
      executionId: "execution",
      finalizedArtifactId: "artifact",
      publicationAttemptId: "publication",
      state: ReviewCompletionProcessState.Completed as const,
      settledAt: new Date("2026-10-23T10:00:00.000Z"),
    },
  };
}
