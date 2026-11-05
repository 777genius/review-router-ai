import { describe, expect, it } from "vitest";
import {
  ReviewCoverageState,
  type FinalizedReviewProjectionArtifact,
} from "../domain/review-execution";
import {
  requiredSnapshot,
  sameScope,
} from "../infrastructure/prisma/prisma-review-execution-snapshot";
import {
  artifactCreateData,
  finalizedOutboxData,
  finalizedOutboxIdentity,
  jsonObjectFromString,
  scopeWhere,
} from "../infrastructure/prisma/prisma-review-execution-mappers";

const createdAt = new Date("2026-11-06T00:00:00.000Z");
const artifact: FinalizedReviewProjectionArtifact = {
  artifactId: "artifact-1",
  executionId: "execution-1",
  generation: 9n,
  reviewedHeadSha: "head-1",
  reviewRevisionHash: "revision-1",
  coverageState: ReviewCoverageState.Completed,
  projectionEnvelopeVersion: 2,
  projectionEnvelopeJson: '{"summary":"ok"}',
  projectionHash: "projection-1",
  byteCount: 16,
  findingCount: 2,
  lifecycleStateHash: "lifecycle-1",
  commandLedgerWatermark: 17n,
  projectionPolicyVersion: "policy-1",
  publicationPermit: {
    workspaceId: "workspace-1",
    repositoryConnectionId: "repository-1",
    scmRepositoryIdentityId: "scm-1",
    pullRequestNumber: 42,
    executionId: "execution-1",
    generation: 9n,
    authorizationId: "authorization-1",
    producerReleaseId: "release-1",
    reviewedHeadSha: "head-1",
    reviewRevisionHash: "revision-1",
    projectionHash: "projection-1",
    lifecycleStateHash: "lifecycle-1",
    commandLedgerWatermark: 17n,
    permitEpoch: 4n,
    publicationSafetyDecisionHash: "safety-1",
    publicationNotAfter: new Date("2026-11-07T00:00:00.000Z"),
  },
  createdAt,
  retainUntil: new Date("2026-11-20T00:00:00.000Z"),
};

describe("Review execution persistence record encoders", () => {
  it("uses the four persisted scope coordinates", () => {
    expect(scopeWhere({ ...artifact.publicationPermit })).toEqual({
      workspaceId: "workspace-1",
      repositoryConnectionId: "repository-1",
      scmRepositoryIdentityId: "scm-1",
      pullRequestNumber: 42,
    });
  });

  it("compares exact scope and rejects a missing snapshot", () => {
    const scope = scopeWhere(artifact.publicationPermit);
    expect(sameScope(scope, { ...scope })).toBe(true);
    expect(sameScope(scope, { ...scope, pullRequestNumber: 43 })).toBe(false);
    expect(
      sameScope(scope, { ...scope, repositoryConnectionId: "other" }),
    ).toBe(false);
    expect(() => requiredSnapshot(null)).toThrow(
      "review_execution_snapshot_missing",
    );
  });

  it("preserves finalized outbox identity and payload", () => {
    const outbox = finalizedOutboxData(artifact, "artifact-hash-1");
    expect(finalizedOutboxIdentity(artifact.executionId)).toBe(
      "review-execution-finalized:v2:execution-1",
    );
    expect(outbox).toMatchObject({
      type: "review.execution.finalized",
      version: 2,
      idempotencyKey: "review-execution-finalized:v2:execution-1",
      workspaceId: "workspace-1",
      repositoryId: "repository-1",
      aggregateId: "execution-1",
      occurredAt: createdAt,
      payload: {
        executionId: "execution-1",
        artifactId: "artifact-1",
        artifactHash: "artifact-hash-1",
        generation: "9",
        reviewRevisionHash: "revision-1",
        projectionHash: "projection-1",
      },
    });
  });

  it("preserves artifact JSON mapping and rejects non-object envelopes", () => {
    expect(artifactCreateData(artifact, "artifact-hash-1")).toMatchObject({
      artifactId: "artifact-1",
      executionId: "execution-1",
      artifactHash: "artifact-hash-1",
      projectionEnvelope: { summary: "ok" },
      projectionEnvelopeCanonicalJson: '{"summary":"ok"}',
      authorizationId: "authorization-1",
      producerReleaseId: "release-1",
      permitEpoch: 4n,
      publicationSafetyDecisionHash: "safety-1",
    });
    expect(() => jsonObjectFromString("[]")).toThrow(
      "review_execution_projection_envelope_not_object",
    );
    expect(() => jsonObjectFromString("null")).toThrow(
      "review_execution_projection_envelope_not_object",
    );
  });
});
