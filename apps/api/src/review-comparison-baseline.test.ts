import { describe, expect, it } from "vitest";
import { canonicalJson } from "@reviewrouter/features-review-run-control";
import type { ReviewSnapshotV2Record } from "@reviewrouter/features-review-snapshots/v2";
import { buildReviewComparisonBaseline } from "./review-comparison-baseline.js";

const head = "a".repeat(40);
const revision = "b".repeat(64);
const hint = {
  lineageId: `rrl_${"a".repeat(32)}`,
  category: "correctness",
  normalizedFailureModeHash: "c".repeat(64),
  severity: "major",
  title: "A prior finding",
  message: "Full prior message",
  filePath: "src/a.ts",
  line: 2,
  firstSeenHeadSha: head,
  lastSeenHeadSha: head,
  active: true,
};
function record(
  hints: unknown = [hint],
  policy = "review-projection-policy.v6-comparison",
): ReviewSnapshotV2Record {
  return {
    scmRepositoryIdentityId: "repo",
    pullRequestNumber: 2,
    sourceBaseSha: head,
    sourceReviewedHeadSha: head,
    sourceReviewRevisionHash: revision,
    sourceExecutionGeneration: 3,
    version: 7,
    payload: {
      projectionEnvelopeVersion: 1,
      projectionEnvelope: {
        envelopeVersion: "review_projection.v1",
        projectionPolicyVersion: policy,
        scope: {
          scmRepositoryIdentityId: "repo",
          pullRequestNumber: 2,
          baseSha: head,
          reviewedHeadSha: head,
          reviewRevisionHash: revision,
        },
        coverage: { state: "complete" },
        snapshot: { lineageHints: hints },
      },
    },
  } as unknown as ReviewSnapshotV2Record;
}
describe("trusted comparison baseline projection", () => {
  it("returns shared canonical response bytes with mixed-case provenance keys", () => {
    const payload = buildReviewComparisonBaseline(record())!;
    expect(payload).toBe(canonicalJson(JSON.parse(payload)));
  });

  it.each([
    "review-projection-policy.v5-t0",
    "review-projection-policy.v6-comparison",
    "review-projection-policy.v7-lifecycle-verification",
  ])("preserves full typed hints from %s", (policy) => {
    expect(
      JSON.parse(buildReviewComparisonBaseline(record([hint], policy))!),
    ).toMatchObject({
      priorLineageHints: [hint],
      sourceExecutionGeneration: "3",
      snapshotVersion: 7,
    });
  });
  it("distinguishes an explicit empty baseline from malformed input", () => {
    expect(
      JSON.parse(buildReviewComparisonBaseline(record([]))!).priorLineageHints,
    ).toEqual([]);
    expect(buildReviewComparisonBaseline(record(null))).toBeNull();
    expect(buildReviewComparisonBaseline(record([], "unknown"))).toBeNull();
    expect(
      buildReviewComparisonBaseline({
        ...record(),
        payload: null,
      } as unknown as ReviewSnapshotV2Record),
    ).toBeNull();
  });
  it.each([
    "review-projection-policy.v6-comparison",
    "review-projection-policy.v7-lifecycle-verification",
  ])("rejects invalid typed hints for %s", (policy) => {
    for (const hints of [
      [hint, hint],
      [{ ...hint, extra: "untrusted" }],
      [{ ...hint, startLine: 5, endLine: 2 }],
      [{ ...hint, severity: "info" }],
      [{ ...hint, message: "x".repeat(65_001) }],
      Array.from({ length: 2001 }, () => hint),
    ]) {
      expect(buildReviewComparisonBaseline(record(hints, policy))).toBeNull();
    }
  });
  it("rejects mismatched persisted provenance and incomplete coverage", () => {
    const mismatched = { ...record(), sourceReviewedHeadSha: "d".repeat(40) };
    expect(buildReviewComparisonBaseline(mismatched)).toBeNull();
    const partial = record();
    expect(
      buildReviewComparisonBaseline({
        ...partial,
        payload: {
          ...partial.payload,
          projectionEnvelope: {
            ...partial.payload.projectionEnvelope,
            coverage: { state: "partial" },
          },
        },
      }),
    ).toBeNull();
    expect(
      buildReviewComparisonBaseline({
        ...record(),
        sourceExecutionGeneration: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toBeNull();
  });
});
