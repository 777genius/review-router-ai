import {
  ReviewV2PublicationPayloadKind,
  type ReviewV2PublicationPayload,
  type ReviewV2PublicationPayloadPort,
} from "@reviewrouter/features-review-publishing/v2";
import type { FinalizedReviewProjectionArtifact } from "@reviewrouter/features-review-executions";
import {
  ReviewPublicationInlineReviewDelivery,
  ReviewPublicationKind,
  ReviewPublicationLifecycleSemantic,
  ReviewPublicationProjectionCoverage,
  ReviewPublicationOccurrenceState,
  ReviewPublicationSummarySemantic,
  publishedReviewProjectionPublicationEnvelopeVersion,
  renderCanonicalReviewPublication,
  resolveReviewPublicationRenderPolicyVersion,
  type PublishedReviewProjectionPublicationEnvelope,
  type ReviewPublicationOperation,
  type ReviewPublicationPermitIdentity,
} from "@reviewrouter/features-review-publishing/v2";
import type { ReviewCompletionProjectionMapperPort } from "./review-v2-context-adapters";
import {
  parseProjection,
  sha256,
  toLineageHints,
  toOccurrence,
  type ProjectionEnvelope,
} from "./review-v2-projection-envelope";

export interface ReviewV2FinalizedArtifactQueryPort {
  findArtifact(executionId: string): Promise<{
    readonly artifact: FinalizedReviewProjectionArtifact;
    readonly protocolLimitsProfileId: string;
    readonly limitsDigest: string;
  } | null>;
}

/**
 * Worker anti-corruption adapter for the Action-owned projection envelope. It
 * exposes only canonical publication payloads and bounded snapshot DTOs.
 */
export class CanonicalReviewV2ProjectionAdapter
  implements
    ReviewCompletionProjectionMapperPort,
    ReviewV2PublicationPayloadPort
{
  constructor(private readonly artifacts: ReviewV2FinalizedArtifactQueryPort) {}

  async publicationEnvelope(
    artifact: FinalizedReviewProjectionArtifact,
    options?: Readonly<{ includeVerifiedFixReplies?: boolean }>,
  ): Promise<PublishedReviewProjectionPublicationEnvelope | null> {
    const loaded = await this.loadMatching(artifact.publicationPermit);
    if (!loaded) return null;
    const projection = parseProjection(artifact.projectionEnvelopeJson);
    const catalog = buildCatalog(projection, artifact, options);
    const partial = artifact.coverageState === "partial";
    return {
      envelopeVersion: publishedReviewProjectionPublicationEnvelopeVersion,
      producerReleaseId: artifact.publicationPermit.producerReleaseId,
      protocolLimitsProfileId: loaded.protocolLimitsProfileId,
      limitsDigest: loaded.limitsDigest,
      projectionHash: artifact.projectionHash,
      coverage: partial
        ? ReviewPublicationProjectionCoverage.Partial
        : ReviewPublicationProjectionCoverage.Completed,
      targetCommitId: artifact.reviewedHeadSha,
      reviewRevisionHash: artifact.reviewRevisionHash,
      renderPolicyVersion: resolveReviewPublicationRenderPolicyVersion(
        artifact.projectionPolicyVersion,
      ),
      publicationNotAfter: new Date(
        artifact.publicationPermit.publicationNotAfter,
      ),
      summary: {
        ...facts(catalog.summary),
        semantic: partial
          ? ReviewPublicationSummarySemantic.PartialCoverage
          : projection.publishing.summary.allClear
            ? ReviewPublicationSummarySemantic.AllClear
            : ReviewPublicationSummarySemantic.Findings,
      },
      ...(catalog.prDescription === null
        ? {}
        : { prDescription: facts(catalog.prDescription) }),
      managedCheck:
        catalog.managedCheck === null ? null : facts(catalog.managedCheck),
      inlineReviews: partial
        ? []
        : catalog.inlineChunks.map((chunk) => ({
            chunkIndex: chunk.chunkIndex,
            delivery: ReviewPublicationInlineReviewDelivery.PendingThenSubmit,
            create: facts(chunk.create),
            submit: facts(chunk.submit),
          })),
      lifecycle: partial
        ? []
        : catalog.lifecycle.map((entry, chunkIndex) => ({
            chunkIndex,
            ...facts(entry.payload),
            semantic:
              entry.payload.kind === ReviewV2PublicationPayloadKind.ThreadReply
                ? ReviewPublicationLifecycleSemantic.ConfirmReply
                : entry.payload.resolve
                  ? ReviewPublicationLifecycleSemantic.Resolve
                  : ReviewPublicationLifecycleSemantic.Reopen,
          })),
    };
  }

  async snapshotProjection(artifact: FinalizedReviewProjectionArtifact) {
    const projection = parseProjection(artifact.projectionEnvelopeJson);
    return {
      occurrences: projection.occurrences.map(toOccurrence),
      lineageHints: toLineageHints(projection, artifact.createdAt),
      expiresAt: new Date(artifact.retainUntil),
    };
  }

  async resolve(input: {
    readonly permit: ReviewPublicationPermitIdentity;
    readonly operation: ReviewPublicationOperation;
  }): Promise<ReviewV2PublicationPayload | null> {
    const loaded = await this.loadMatching(input.permit);
    if (!loaded) return null;
    const catalog = buildCatalog(
      parseProjection(loaded.artifact.projectionEnvelopeJson),
      loaded.artifact,
    );
    const payload = payloadForOperation(catalog, input.operation);
    if (
      !payload ||
      payload.markerHash !== input.operation.markerHash ||
      payload.bodyHash !== input.operation.bodyHash
    ) {
      return null;
    }
    return payload;
  }

  private async loadMatching(permit: ReviewPublicationPermitIdentity) {
    const loaded = await this.artifacts.findArtifact(permit.executionId);
    if (
      !loaded ||
      loaded.artifact.generation !== permit.generation ||
      loaded.artifact.projectionHash !== permit.projectionHash ||
      loaded.artifact.reviewRevisionHash !== permit.reviewRevisionHash
    ) {
      return null;
    }
    return loaded;
  }
}

type PayloadOfKind<TKind extends ReviewV2PublicationPayloadKind> =
  ReviewV2PublicationPayload & { readonly kind: TKind };

type PublicationCatalog = {
  readonly prDescription: PayloadOfKind<ReviewV2PublicationPayloadKind.PrDescription> | null;
  readonly summary: PayloadOfKind<ReviewV2PublicationPayloadKind.Summary>;
  readonly managedCheck: PayloadOfKind<ReviewV2PublicationPayloadKind.ManagedCheck> | null;
  readonly inlineChunks: readonly {
    readonly chunkIndex: number;
    readonly create: PayloadOfKind<ReviewV2PublicationPayloadKind.PendingReviewCreate>;
    readonly submit: PayloadOfKind<ReviewV2PublicationPayloadKind.PendingReviewSubmit>;
  }[];
  readonly lifecycle: readonly {
    readonly payload:
      | PayloadOfKind<ReviewV2PublicationPayloadKind.ThreadLifecycle>
      | PayloadOfKind<ReviewV2PublicationPayloadKind.ThreadReply>;
  }[];
};

function buildCatalog(
  projection: ProjectionEnvelope,
  artifact: FinalizedReviewProjectionArtifact,
  options?: Readonly<{ includeVerifiedFixReplies?: boolean }>,
): PublicationCatalog {
  const rendered = renderCanonicalReviewPublication(
    {
      coverage:
        artifact.coverageState === "partial"
          ? ReviewPublicationProjectionCoverage.Partial
          : ReviewPublicationProjectionCoverage.Completed,
      renderPolicyVersion: resolveReviewPublicationRenderPolicyVersion(
        artifact.projectionPolicyVersion,
      ),
      ...(options?.includeVerifiedFixReplies === undefined
        ? {}
        : { includeVerifiedFixReplies: options.includeVerifiedFixReplies }),
      targetCommitId: artifact.reviewedHeadSha,
      occurrenceStates: projection.occurrences.map((occurrence) =>
        reviewPublicationOccurrenceState(occurrence.state),
      ),
      source: projection.publishing,
    },
    {
      digestUtf8: sha256,
      utf8ByteLength: (value) => Buffer.byteLength(value, "utf8"),
    },
  );
  const summary: PayloadOfKind<ReviewV2PublicationPayloadKind.Summary> = {
    kind: ReviewV2PublicationPayloadKind.Summary,
    ...payloadFields(rendered.summary),
    body: rendered.summary.body,
  };
  const managedCheck: PublicationCatalog["managedCheck"] =
    rendered.managedCheck === null
      ? null
      : {
          kind: ReviewV2PublicationPayloadKind.ManagedCheck as const,
          ...payloadFields(rendered.managedCheck),
          name: rendered.managedCheck.name,
          title: rendered.managedCheck.title,
          summary: rendered.managedCheck.summary,
          conclusion: rendered.managedCheck.conclusion,
        };
  const inlineChunks = rendered.inlineReviews.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    create: {
      kind: ReviewV2PublicationPayloadKind.PendingReviewCreate,
      ...payloadFields(chunk.create),
      body: chunk.create.reviewBody,
      comments: chunk.create.comments,
    } as const,
    submit: {
      kind: ReviewV2PublicationPayloadKind.PendingReviewSubmit,
      ...payloadFields(chunk.submit),
      body: chunk.submit.reviewBody,
    } as const,
  }));
  const lifecycle = rendered.lifecycle.map((entry) => ({
    payload:
      entry.semantic === ReviewPublicationLifecycleSemantic.ConfirmReply
        ? ({
            kind: ReviewV2PublicationPayloadKind.ThreadReply,
            ...payloadFields(entry),
            threadId: entry.threadId,
            targetId: entry.targetId,
            body: entry.body,
          } as const)
        : ({
            kind: ReviewV2PublicationPayloadKind.ThreadLifecycle,
            ...payloadFields(entry),
            threadId: entry.threadId,
            resolve: entry.resolve,
          } as const),
  }));
  const prDescription: PublicationCatalog["prDescription"] =
    rendered.prDescription === undefined
      ? null
      : {
          kind: ReviewV2PublicationPayloadKind.PrDescription,
          ...payloadFields(rendered.prDescription),
          body: rendered.prDescription.body,
        };
  return { summary, prDescription, managedCheck, inlineChunks, lifecycle };
}

function reviewPublicationOccurrenceState(
  value: string,
): ReviewPublicationOccurrenceState {
  if (
    !Object.values(ReviewPublicationOccurrenceState).includes(
      value as ReviewPublicationOccurrenceState,
    )
  ) {
    throw new Error("review_v2_projection_occurrence_state_invalid");
  }
  return value as ReviewPublicationOccurrenceState;
}

function payloadFields(value: {
  readonly marker: string;
  readonly markerHash: string;
  readonly bodyHash: string;
  readonly bodyByteCount: number;
}) {
  return {
    marker: value.marker,
    markerHash: value.markerHash,
    bodyHash: value.bodyHash,
    bodyByteCount: value.bodyByteCount,
  };
}

function payloadForOperation(
  catalog: PublicationCatalog,
  operation: ReviewPublicationOperation,
): ReviewV2PublicationPayload | null {
  switch (operation.publicationKind) {
    case ReviewPublicationKind.PrDescription:
      return operation.chunkIndex === 0 ? catalog.prDescription : null;
    case ReviewPublicationKind.Summary:
      return operation.chunkIndex === 0 ? catalog.summary : null;
    case ReviewPublicationKind.ManagedCheck:
      return operation.chunkIndex === 0 ? catalog.managedCheck : null;
    case ReviewPublicationKind.PendingReviewCreate:
      return (
        catalog.inlineChunks.find(
          (entry) => entry.chunkIndex === operation.chunkIndex,
        )?.create ?? null
      );
    case ReviewPublicationKind.PendingReviewSubmit:
      return (
        catalog.inlineChunks.find(
          (entry) => entry.chunkIndex === operation.chunkIndex,
        )?.submit ?? null
      );
    case ReviewPublicationKind.SubmittedReview:
      return null;
    case ReviewPublicationKind.ThreadLifecycle:
    case ReviewPublicationKind.ThreadReply: {
      // Existing V6 attempts retain their original chunk indexes. The marker
      // and body are bound to that immutable operation, even after new replies
      // have been introduced ahead of guarded resolutions.
      const expectedKind =
        operation.publicationKind === ReviewPublicationKind.ThreadReply
          ? ReviewV2PublicationPayloadKind.ThreadReply
          : ReviewV2PublicationPayloadKind.ThreadLifecycle;
      return (
        catalog.lifecycle.find(
          (entry) =>
            entry.payload.kind === expectedKind &&
            entry.payload.markerHash === operation.markerHash &&
            entry.payload.bodyHash === operation.bodyHash,
        )?.payload ?? null
      );
    }
  }
}

function facts(payload: ReviewV2PublicationPayload) {
  return {
    markerHash: payload.markerHash,
    bodyHash: payload.bodyHash,
    bodyByteCount: payload.bodyByteCount,
  };
}
