import { prDescriptionContract } from "@reviewrouter/shared";
import {
  renderReviewPrDescription,
  reviewPrDescriptionStartMarker,
  type ReviewPrDescriptionSource,
} from "./review-pr-description";
import {
  ReviewPublicationInlineReviewDelivery,
  ReviewPublicationLifecycleSemantic,
  ReviewPublicationProjectionCoverage,
  ReviewPublicationSummarySemantic,
  type CanonicalReviewPublicationBodyFacts,
} from "./review-publication-operation-planning";
import { canonicalReviewPublicationJson } from "./canonical-review-publication-json";

export const legacyReviewProjectionPolicyVersion =
  "review-projection-policy.v2-t0";
export const clearPartialReviewProjectionPolicyVersion =
  "review-projection-policy.v3-t0";
export const hiddenMarkerReviewProjectionPolicyVersion =
  "review-projection-policy.v4-t0";
export const currentReviewProjectionPolicyVersion =
  "review-projection-policy.v5-t0";

export const comparisonReviewProjectionPolicyVersion =
  "review-projection-policy.v6-comparison";

export const lifecycleVerificationReviewProjectionPolicyVersion =
  "review-projection-policy.v7-lifecycle-verification";

export type ReviewPublicationLifecycleVerificationFact = {
  readonly targetId: string;
  readonly lineageId?: string;
  readonly semanticVerdict: "resolved" | "still_valid" | "uncertain";
  readonly confirmationState:
    | "confirmed_open"
    | "fix_confirmed_thread_open"
    | "unverified"
    | "native_resolved";
  readonly severity: "critical" | "major" | "minor" | "unknown";
  readonly observationIds: readonly string[];
  readonly providerVoteKeys: readonly string[];
  readonly reasonCodes: readonly string[];
  readonly mutationStatus:
    | "report_only"
    | "pending"
    | "blocked_partial_review"
    | "not_eligible"
    | "native_resolved";
};

export enum CanonicalReviewPublicationRenderPolicyVersion {
  LegacyV1 = 1,
  ClearPartialV2 = 2,
  HiddenMarkersV3 = 3,
  PreliminaryFindingsV4 = 4,
  CompactComparisonV5 = 5,
  LifecycleVerificationV6 = 6,
}

export const legacyPartialReviewPublicationSummary =
  "Review incomplete: required coverage did not finish. This result is not an all-clear and must not be used as approval evidence.";
export const partialReviewPublicationSummary = [
  "## Review incomplete ⚠️",
  "",
  "ReviewRouter could not finish all required review tasks for this revision. No approval was issued, and partial findings were withheld to avoid a misleading result.",
  "",
  "<sub>Eligible completed evidence is preserved for a safe retry. This status is not an all-clear.</sub>",
].join("\n");

export type ReviewPublicationOccurrenceCounts = {
  readonly new: number;
  readonly reconfirmed: number;
  readonly changed: number;
  readonly carried_unverified: number;
  readonly resolved: number;
  readonly uncertain: number;
  readonly suppressed_by_human: number;
};

export enum ReviewPublicationOccurrenceState {
  New = "new",
  Reconfirmed = "reconfirmed",
  Changed = "changed",
  CarriedUnverified = "carried_unverified",
  Resolved = "resolved",
  Uncertain = "uncertain",
  SuppressedByHuman = "suppressed_by_human",
}

export type ReviewPublicationRenderingSource = {
  readonly prDescription?: ReviewPrDescriptionSource;
  readonly summary: {
    readonly marker: string;
    readonly body: string;
    readonly allClear: boolean;
    readonly occurrenceCounts: ReviewPublicationOccurrenceCounts;
  };
  readonly check: {
    readonly marker: string;
    readonly name: string;
    readonly title: string;
    readonly summary: string;
    readonly conclusion: "success" | "failure" | "neutral";
  };
  readonly inlineReviewChunks: readonly {
    readonly chunkIndex: number;
    readonly marker: string;
    readonly comments: readonly {
      readonly marker: string;
      readonly path: string;
      readonly startLine?: number | null;
      readonly line: number;
      readonly body: string;
    }[];
  }[];
  readonly lifecycle: readonly {
    readonly targetId: string;
    readonly threadId: string;
    readonly verdict: string;
    readonly mutationEligible: boolean;
    readonly verification?: ReviewPublicationLifecycleVerificationFact;
  }[];
};

type RenderedPayloadIdentity = CanonicalReviewPublicationBodyFacts & {
  readonly marker: string;
  readonly body: string;
};

export type CanonicalReviewPublicationRendering = {
  readonly prDescription?: RenderedPayloadIdentity;
  readonly summary: RenderedPayloadIdentity & {
    readonly semantic: ReviewPublicationSummarySemantic;
  };
  readonly managedCheck:
    | (RenderedPayloadIdentity & {
        readonly name: string;
        readonly title: string;
        readonly summary: string;
        readonly conclusion: "success" | "failure" | "neutral";
      })
    | null;
  readonly inlineReviews: readonly {
    readonly chunkIndex: number;
    readonly delivery: ReviewPublicationInlineReviewDelivery.PendingThenSubmit;
    readonly create: RenderedPayloadIdentity & {
      readonly reviewBody: string;
      readonly comments: readonly {
        readonly path: string;
        readonly line: number;
        readonly startLine: number | null;
        readonly body: string;
      }[];
    };
    readonly submit: RenderedPayloadIdentity & { readonly reviewBody: string };
  }[];
  readonly lifecycle: readonly (RenderedPayloadIdentity & {
    readonly chunkIndex: number;
    readonly semantic: ReviewPublicationLifecycleSemantic;
    readonly threadId: string;
    readonly resolve: boolean;
  })[];
};

export type CanonicalReviewPublicationRenderingPrimitives = {
  readonly digestUtf8: (value: string) => string;
  readonly utf8ByteLength: (value: string) => number;
};

export function resolveReviewPublicationRenderPolicyVersion(
  projectionPolicyVersion: string,
): CanonicalReviewPublicationRenderPolicyVersion {
  switch (projectionPolicyVersion) {
    case legacyReviewProjectionPolicyVersion:
      return CanonicalReviewPublicationRenderPolicyVersion.LegacyV1;
    case clearPartialReviewProjectionPolicyVersion:
      return CanonicalReviewPublicationRenderPolicyVersion.ClearPartialV2;
    case hiddenMarkerReviewProjectionPolicyVersion:
      return CanonicalReviewPublicationRenderPolicyVersion.HiddenMarkersV3;
    case currentReviewProjectionPolicyVersion:
      return CanonicalReviewPublicationRenderPolicyVersion.PreliminaryFindingsV4;
    case comparisonReviewProjectionPolicyVersion:
      return CanonicalReviewPublicationRenderPolicyVersion.CompactComparisonV5;
    case lifecycleVerificationReviewProjectionPolicyVersion:
      return CanonicalReviewPublicationRenderPolicyVersion.LifecycleVerificationV6;
    default:
      throw new Error(
        `review_publication_projection_policy_unsupported:${projectionPolicyVersion}`,
      );
  }
}

/**
 * Publishing-owned rendering policy. Planning and execution must consume this
 * same result so a persisted operation identity cannot drift from its payload.
 */
export function renderCanonicalReviewPublication(
  input: {
    readonly coverage: ReviewPublicationProjectionCoverage;
    readonly renderPolicyVersion: CanonicalReviewPublicationRenderPolicyVersion;
    readonly targetCommitId: string;
    readonly occurrenceStates: readonly ReviewPublicationOccurrenceState[];
    readonly source: ReviewPublicationRenderingSource;
  },
  primitives: CanonicalReviewPublicationRenderingPrimitives,
): CanonicalReviewPublicationRendering {
  if (
    input.renderPolicyVersion ===
    CanonicalReviewPublicationRenderPolicyVersion.LifecycleVerificationV6
  ) {
    const targets = new Set<string>();
    for (const entry of input.source.lifecycle) {
      validateReviewPublicationLifecycleVerification(
        entry.verification,
        entry.targetId,
      );
      if (targets.has(entry.targetId))
        throw new Error("publication_verification_duplicate_target");
      targets.add(entry.targetId);
      const fact = entry.verification!;
      if (
        (entry.verdict !== fact.semanticVerdict &&
          !(
            entry.verdict === "suppressed_by_human" &&
            fact.confirmationState === "unverified"
          )) ||
        (entry.mutationEligible &&
          (entry.verdict !== "resolved" ||
            fact.confirmationState !== "fix_confirmed_thread_open" ||
            fact.mutationStatus !== "pending"))
      )
        throw new Error("publication_verification_mutation_invalid");
    }
  }
  const verifiedOccurrenceCounts =
    input.renderPolicyVersion ===
      CanonicalReviewPublicationRenderPolicyVersion.PreliminaryFindingsV4 ||
    input.renderPolicyVersion ===
      CanonicalReviewPublicationRenderPolicyVersion.CompactComparisonV5 ||
    input.renderPolicyVersion ===
      CanonicalReviewPublicationRenderPolicyVersion.LifecycleVerificationV6
      ? occurrenceCountsBoundToProjection(
          input.source.summary.occurrenceCounts,
          input.occurrenceStates,
        )
      : null;
  const partial =
    input.coverage === ReviewPublicationProjectionCoverage.Partial;
  const summary = payload(
    input.source.summary.marker,
    withMarker(
      partial
        ? partialSummary(
            input.renderPolicyVersion,
            input.source,
            verifiedOccurrenceCounts,
          )
        : input.source.summary.body,
      input.source.summary.marker,
      input.renderPolicyVersion,
    ),
    primitives,
  );

  if (partial) {
    return {
      summary: {
        ...summary,
        semantic: ReviewPublicationSummarySemantic.PartialCoverage,
      },
      managedCheck: null,
      inlineReviews: [],
      lifecycle: [],
    };
  }

  if (
    input.source.prDescription !== undefined &&
    primitives.utf8ByteLength(input.source.prDescription.generatedMarkdown) >
      prDescriptionContract.maxGeneratedMarkdownBytes
  ) {
    throw new Error("publication_pr_description_markdown_invalid");
  }
  const checkSummary = withMarker(
    input.source.check.summary,
    input.source.check.marker,
    input.renderPolicyVersion,
  );
  const managedCheck = payload(
    input.source.check.marker,
    canonicalReviewPublicationJson({
      conclusion: input.source.check.conclusion,
      name: input.source.check.name,
      summary: checkSummary,
      title: input.source.check.title,
    }),
    primitives,
  );
  const inlineReviews = input.source.inlineReviewChunks.map((chunk) => {
    const comments = chunk.comments.map((comment) => ({
      body: withMarker(comment.body, comment.marker, input.renderPolicyVersion),
      line: comment.line,
      path: comment.path,
      startLine: comment.startLine ?? null,
    }));
    const submitMarker = `${chunk.marker}:submitted`;
    const createReviewBody = markerForBody(
      chunk.marker,
      input.renderPolicyVersion,
    );
    const submitReviewBody = markerForBody(
      submitMarker,
      input.renderPolicyVersion,
    );
    return {
      chunkIndex: chunk.chunkIndex,
      delivery:
        ReviewPublicationInlineReviewDelivery.PendingThenSubmit as const,
      create: {
        ...payload(
          chunk.marker,
          canonicalReviewPublicationJson({
            body: createReviewBody,
            comments,
            commitId: input.targetCommitId,
          }),
          primitives,
        ),
        reviewBody: createReviewBody,
        comments,
      },
      submit: {
        ...payload(
          submitMarker,
          canonicalReviewPublicationJson({
            body: submitReviewBody,
            event: "COMMENT",
          }),
          primitives,
        ),
        reviewBody: submitReviewBody,
      },
    };
  });
  const lifecycle = input.source.lifecycle
    .filter(
      (entry) =>
        entry.mutationEligible &&
        (entry.verdict === "resolved" ||
          (input.renderPolicyVersion !==
            CanonicalReviewPublicationRenderPolicyVersion.LifecycleVerificationV6 &&
            entry.verdict === "still_valid")),
    )
    .map((entry, chunkIndex) => {
      const resolve = entry.verdict === "resolved";
      const marker = `reviewrouter-lifecycle:${entry.targetId}:${resolve ? "resolved" : "open"}`;
      return {
        chunkIndex,
        semantic: resolve
          ? ReviewPublicationLifecycleSemantic.Resolve
          : ReviewPublicationLifecycleSemantic.Reopen,
        threadId: entry.threadId,
        resolve,
        ...payload(
          marker,
          canonicalReviewPublicationJson({ resolve, threadId: entry.threadId }),
          primitives,
        ),
      };
    });

  return {
    ...(input.source.prDescription === undefined
      ? {}
      : {
          prDescription: payload(
            reviewPrDescriptionStartMarker,
            renderReviewPrDescription(
              input.source.prDescription.generatedMarkdown,
            ),
            primitives,
          ),
        }),
    summary: {
      ...summary,
      semantic: input.source.summary.allClear
        ? ReviewPublicationSummarySemantic.AllClear
        : ReviewPublicationSummarySemantic.Findings,
    },
    managedCheck: {
      ...managedCheck,
      name: input.source.check.name,
      title: input.source.check.title,
      summary: checkSummary,
      conclusion: input.source.check.conclusion,
    },
    inlineReviews,
    lifecycle,
  };
}

function partialSummary(
  version: CanonicalReviewPublicationRenderPolicyVersion,
  source: ReviewPublicationRenderingSource,
  verifiedOccurrenceCounts: ReviewPublicationOccurrenceCounts | null,
): string {
  switch (version) {
    case CanonicalReviewPublicationRenderPolicyVersion.LegacyV1:
      return legacyPartialReviewPublicationSummary;
    case CanonicalReviewPublicationRenderPolicyVersion.ClearPartialV2:
    case CanonicalReviewPublicationRenderPolicyVersion.HiddenMarkersV3:
      return partialReviewPublicationSummary;
    case CanonicalReviewPublicationRenderPolicyVersion.CompactComparisonV5:
    case CanonicalReviewPublicationRenderPolicyVersion.LifecycleVerificationV6:
      if (verifiedOccurrenceCounts === null) {
        throw new Error("publication_occurrence_counts_invalid");
      }
      return [
        "**Review incomplete.** Required coverage did not finish; this is not an approval.",
        "",
        removePartialAllClearClaims(source.summary.body.trim())
          .replace(/^##\s+Review incomplete\b[^\n]*$/gim, "")
          .replace(/\n{3,}/g, "\n\n")
          .trim(),
      ]
        .join("\n")
        .trim();
    case CanonicalReviewPublicationRenderPolicyVersion.PreliminaryFindingsV4:
      if (verifiedOccurrenceCounts === null) {
        throw new Error("publication_occurrence_counts_invalid");
      }
      return preliminaryFindingsPartialSummary(
        source,
        verifiedOccurrenceCounts,
      );
  }
}

function preliminaryFindingsPartialSummary(
  source: ReviewPublicationRenderingSource,
  occurrenceCounts: ReviewPublicationOccurrenceCounts,
): string {
  const preliminaryFindingCount =
    occurrenceCounts.new +
    occurrenceCounts.reconfirmed +
    occurrenceCounts.changed;
  const findingLabel = preliminaryFindingCount === 1 ? "finding" : "findings";
  const preliminaryBody = removePartialAllClearClaims(
    source.summary.body.trim(),
  )
    .replace(/^##\s+Review incomplete\b[^\n]*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [
    `## Review incomplete - ${preliminaryFindingCount} preliminary ${findingLabel} preserved ⚠️`,
    "",
    "Required review units or context obligations remain uncovered, so this result is not an all-clear.",
    ...(preliminaryFindingCount > 0 && preliminaryBody.length > 0
      ? ["", "### Preliminary findings", "", preliminaryBody]
      : [
          "",
          "No preliminary findings were preserved.",
          ...(preliminaryBody.length > 0
            ? ["", "### Partial review details", "", preliminaryBody]
            : []),
        ]),
    "",
    "<sub>Inline comments, managed check conclusions, and lifecycle changes were withheld until required coverage completes.</sub>",
  ].join("\n");
}

function occurrenceCountsBoundToProjection(
  declared: ReviewPublicationOccurrenceCounts,
  states: readonly ReviewPublicationOccurrenceState[],
): ReviewPublicationOccurrenceCounts {
  const keys = Object.values(ReviewPublicationOccurrenceState);
  if (
    Object.keys(declared).length !== keys.length ||
    keys.some(
      (key) => !Number.isSafeInteger(declared[key]) || declared[key] < 0,
    ) ||
    !Number.isSafeInteger(keys.reduce((sum, key) => sum + declared[key], 0))
  ) {
    throw new Error("publication_occurrence_counts_invalid");
  }
  const derived: Record<ReviewPublicationOccurrenceState, number> = {
    [ReviewPublicationOccurrenceState.New]: 0,
    [ReviewPublicationOccurrenceState.Reconfirmed]: 0,
    [ReviewPublicationOccurrenceState.Changed]: 0,
    [ReviewPublicationOccurrenceState.CarriedUnverified]: 0,
    [ReviewPublicationOccurrenceState.Resolved]: 0,
    [ReviewPublicationOccurrenceState.Uncertain]: 0,
    [ReviewPublicationOccurrenceState.SuppressedByHuman]: 0,
  };
  for (const state of states) {
    if (!Object.hasOwn(derived, state)) {
      throw new Error("publication_occurrence_state_invalid");
    }
    derived[state] += 1;
  }
  if (keys.some((key) => declared[key] !== derived[key])) {
    throw new Error("publication_occurrence_counts_mismatch");
  }
  return derived;
}

function removePartialAllClearClaims(body: string): string {
  return body
    .replace(/\ball[ -]?clear\b/gi, "No blocking findings in reviewed coverage")
    .replace(/\bno issues? found\b/gi, "No issues found in reviewed coverage")
    .replace(
      /^(##\s+)?Review complete(?:d)?\b[^\n]*$/gim,
      (_match, heading: string | undefined) =>
        heading === undefined ? "Reviewed coverage" : "## Reviewed coverage",
    );
}

function payload(
  marker: string,
  body: string,
  primitives: CanonicalReviewPublicationRenderingPrimitives,
): RenderedPayloadIdentity {
  assertBoundedString(marker, "publication_marker_invalid", 4_096, primitives);
  assertBoundedString(body, "publication_body_invalid", 1_000_000, primitives);
  return {
    marker,
    body,
    markerHash: primitives.digestUtf8(marker),
    bodyHash: primitives.digestUtf8(body),
    bodyByteCount: primitives.utf8ByteLength(body),
  };
}

function withMarker(
  body: string,
  marker: string,
  version: CanonicalReviewPublicationRenderPolicyVersion,
): string {
  const renderedMarker = markerForBody(marker, version);
  if (body.includes(renderedMarker)) return body;
  if (body.includes(marker)) return body.split(marker).join(renderedMarker);
  return `${body}\n\n${renderedMarker}`;
}

function markerForBody(
  marker: string,
  version: CanonicalReviewPublicationRenderPolicyVersion,
): string {
  if (
    (version !==
      CanonicalReviewPublicationRenderPolicyVersion.HiddenMarkersV3 &&
      version !==
        CanonicalReviewPublicationRenderPolicyVersion.PreliminaryFindingsV4 &&
      version !==
        CanonicalReviewPublicationRenderPolicyVersion.CompactComparisonV5 &&
      version !==
        CanonicalReviewPublicationRenderPolicyVersion.LifecycleVerificationV6) ||
    marker.trim().startsWith("<!--")
  ) {
    return marker;
  }
  return `<!-- ${marker} -->`;
}

function assertBoundedString(
  value: unknown,
  code: string,
  maxBytes: number,
  primitives: CanonicalReviewPublicationRenderingPrimitives,
): void {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    primitives.utf8ByteLength(value) > maxBytes
  ) {
    throw new Error(code);
  }
}

/** The optional extension is strict so unscoped or contradictory confirmations cannot drive effects. */
export function validateReviewPublicationLifecycleVerification(
  value: unknown,
  targetId: string,
): asserts value is ReviewPublicationLifecycleVerificationFact {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("publication_verification_invalid");
  const fact = value as Record<string, unknown>;
  const allowed = new Set([
    "targetId",
    "lineageId",
    "semanticVerdict",
    "confirmationState",
    "severity",
    "observationIds",
    "providerVoteKeys",
    "reasonCodes",
    "mutationStatus",
  ]);
  const strings = (items: unknown): items is string[] =>
    Array.isArray(items) &&
    new Set(items).size === items.length &&
    items.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 512,
    );
  if (
    Object.keys(fact).some((key) => !allowed.has(key)) ||
    typeof targetId !== "string" ||
    !targetId ||
    targetId.length > 512 ||
    fact.targetId !== targetId ||
    (fact.lineageId !== undefined &&
      (typeof fact.lineageId !== "string" ||
        !fact.lineageId ||
        fact.lineageId.length > 512)) ||
    typeof fact.semanticVerdict !== "string" ||
    !["resolved", "still_valid", "uncertain"].includes(
      String(fact.semanticVerdict),
    ) ||
    typeof fact.confirmationState !== "string" ||
    ![
      "confirmed_open",
      "fix_confirmed_thread_open",
      "unverified",
      "native_resolved",
    ].includes(String(fact.confirmationState)) ||
    typeof fact.severity !== "string" ||
    !["critical", "major", "minor", "unknown"].includes(
      String(fact.severity),
    ) ||
    typeof fact.mutationStatus !== "string" ||
    ![
      "report_only",
      "pending",
      "blocked_partial_review",
      "not_eligible",
      "native_resolved",
    ].includes(String(fact.mutationStatus)) ||
    !strings(fact.observationIds) ||
    !strings(fact.providerVoteKeys) ||
    !strings(fact.reasonCodes)
  )
    throw new Error("publication_verification_invalid");
  const positive =
    fact.confirmationState === "confirmed_open" ||
    fact.confirmationState === "fix_confirmed_thread_open";
  if (
    (positive &&
      (!(fact.observationIds as string[]).length ||
        !(fact.providerVoteKeys as string[]).length)) ||
    (fact.confirmationState === "confirmed_open" &&
      (fact.semanticVerdict !== "still_valid" ||
        fact.mutationStatus !== "not_eligible")) ||
    (fact.confirmationState === "fix_confirmed_thread_open" &&
      (fact.semanticVerdict !== "resolved" ||
        ![
          "report_only",
          "pending",
          "blocked_partial_review",
          "not_eligible",
        ].includes(String(fact.mutationStatus)))) ||
    (fact.confirmationState === "unverified" &&
      (fact.semanticVerdict !== "uncertain" ||
        fact.mutationStatus !== "not_eligible")) ||
    (fact.confirmationState === "native_resolved" &&
      (fact.semanticVerdict !== "resolved" ||
        fact.mutationStatus !== "native_resolved"))
  )
    throw new Error("publication_verification_semantics_invalid");
}
