import type { AppliedComparisonResolution } from "./review-comparison-baseline-resolutions.js";
import { z } from "zod";
import { canonicalJson } from "@reviewrouter/features-review-run-control";
import type { ReviewSnapshotV2Record } from "@reviewrouter/features-review-snapshots/v2";

const text = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value) <= 65_000);
const sha = z.string().regex(/^[a-f0-9]{40}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const line = z.number().int().positive().safe();
const hint = z
  .object({
    lineageId: z.string().regex(/^rrl_[a-f0-9]{32}$/),
    category: text,
    normalizedFailureModeHash: digest,
    symbolAnchor: text.optional(),
    trustedMarker: z
      .string()
      .regex(/^(?:rrl_[a-f0-9]{32}|[a-f0-9]{24,64})$/)
      .optional(),
    severity: z.enum(["critical", "major", "minor"]),
    title: text,
    message: text,
    filePath: text,
    startLine: line.optional(),
    line: line.optional(),
    endLine: line.optional(),
    firstSeenHeadSha: sha,
    lastSeenHeadSha: sha,
    active: z.boolean(),
  })
  .strict();

/** A trusted persisted projection is the only baseline source; never use compact hash hints. */
export function buildReviewComparisonBaseline(
  record: ReviewSnapshotV2Record,
  appliedResolutions: readonly AppliedComparisonResolution[] = [],
): string | null {
  const decoded = z
    .object({
      projectionEnvelopeVersion: z.literal(1),
      projectionEnvelope: z.object({
        envelopeVersion: z.literal("review_projection.v1"),
        projectionPolicyVersion: z.enum([
          "review-projection-policy.v5-t0",
          "review-projection-policy.v6-comparison",
          "review-projection-policy.v7-lifecycle-verification",
        ]),
        scope: z.object({
          scmRepositoryIdentityId: z.string(),
          pullRequestNumber: line,
          baseSha: sha,
          reviewedHeadSha: sha,
          reviewRevisionHash: digest,
        }),
        coverage: z.object({ state: z.literal("complete") }),
        snapshot: z.object({ lineageHints: z.array(hint).max(2_000) }),
      }),
    })
    .safeParse(record.payload);
  if (!decoded.success) return null;
  const projection = decoded.data.projectionEnvelope;
  if (
    projection.scope.scmRepositoryIdentityId !==
      record.scmRepositoryIdentityId ||
    projection.scope.pullRequestNumber !== record.pullRequestNumber ||
    projection.scope.baseSha !== record.sourceBaseSha ||
    projection.scope.reviewedHeadSha !== record.sourceReviewedHeadSha ||
    projection.scope.reviewRevisionHash !== record.sourceReviewRevisionHash
  )
    return null;
  const hints = projection.snapshot.lineageHints;
  if (
    new Set(hints.map((item) => item.lineageId)).size !== hints.length ||
    hints.some(
      (item) =>
        item.startLine !== undefined &&
        item.endLine !== undefined &&
        item.startLine > item.endLine,
    )
  )
    return null;
  if (
    !sha.safeParse(record.sourceReviewedHeadSha).success ||
    !digest.safeParse(record.sourceReviewRevisionHash).success ||
    !Number.isSafeInteger(record.sourceExecutionGeneration) ||
    record.sourceExecutionGeneration <= 0 ||
    !Number.isSafeInteger(record.version) ||
    record.version <= 0
  )
    return null;
  const result = canonicalJson({
    schemaVersion: "comparison_baseline.v1",
    sourceReviewedHeadSha: record.sourceReviewedHeadSha,
    sourceReviewRevisionHash: record.sourceReviewRevisionHash,
    sourceExecutionGeneration: String(record.sourceExecutionGeneration),
    snapshotVersion: record.version,
    projectionPolicyVersion: projection.projectionPolicyVersion,
    projectionEnvelopeVersion: projection.envelopeVersion,
    priorLineageHints: hints,
    appliedResolutions,
  });
  return Buffer.byteLength(result) <= 2_000_000 ? result : null;
}
