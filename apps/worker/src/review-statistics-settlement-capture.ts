import type {
  Prisma,
  ReviewPublicationTerminalOutcomeV2,
} from "@prisma/client";
import {
  reviewExecutionAbsoluteMaxFindingCount,
  reviewExecutionAbsoluteMaxProjectionBytes,
} from "@reviewrouter/features-review-executions";
import { ReviewCompletionProcessState } from "@reviewrouter/features-review-processes";
import type { ReviewCompletionSettlementHook } from "@reviewrouter/features-review-processes/composition";
import {
  effectiveReviewPublicationOutcome,
  ReviewPublicationTerminalOutcome,
} from "@reviewrouter/features-review-publishing/v2";
import {
  ReviewStatisticsSettlementState,
  StatisticsSeverity,
  parseReviewStatisticsSettledEvent,
  type ReviewStatisticsSettledEvent,
} from "@reviewrouter/features-review-statistics";

/** The host translates operational evidence into the portable statistics contract. */
export function createReviewStatisticsSettlementCapture(writer: {
  write(
    transaction: Prisma.TransactionClient,
    event: ReviewStatisticsSettledEvent,
  ): Promise<void>;
}): ReviewCompletionSettlementHook {
  return async (transaction, settlement) => {
    const execution = await transaction.reviewExecutionV2.findUnique({
      where: { executionId: settlement.executionId },
    });
    const artifact =
      await transaction.finalizedReviewProjectionArtifactV2.findUnique({
        where: { executionId: settlement.executionId },
      });
    const publication = await transaction.reviewPublicationAttemptV2.findUnique(
      { where: { publicationAttemptId: settlement.publicationAttemptId } },
    );
    if (
      !execution ||
      !artifact ||
      !publication ||
      execution.finalizedArtifactId !== settlement.finalizedArtifactId ||
      artifact.artifactId !== settlement.finalizedArtifactId ||
      artifact.executionId !== execution.executionId ||
      publication.executionId !== execution.executionId ||
      publication.state !== "terminal" ||
      publication.workspaceId !== execution.workspaceId ||
      publication.repositoryConnectionId !== execution.repositoryConnectionId ||
      publication.scmRepositoryIdentityId !==
        execution.scmRepositoryIdentityId ||
      publication.pullRequestNumber !== execution.pullRequestNumber ||
      publication.generation !== execution.generation ||
      artifact.generation !== execution.generation ||
      publication.projectionHash !== artifact.projectionHash ||
      publication.reviewRevisionHash !== artifact.reviewRevisionHash ||
      execution.reviewRevisionHash !== artifact.reviewRevisionHash ||
      publication.reviewedHeadSha !== artifact.reviewedHeadSha ||
      execution.headSha !== artifact.reviewedHeadSha ||
      publication.authorizationId !== artifact.authorizationId ||
      execution.authorizationId !== artifact.authorizationId ||
      publication.producerReleaseId !== artifact.producerReleaseId ||
      execution.producerReleaseId !== artifact.producerReleaseId ||
      artifact.coverageState !== "completed" ||
      artifact.projectionEnvelopeVersion !== 1
    )
      throw invalidSettlement();

    // Use the same domain policy as the completion owner, including adjudication.
    const correction =
      publication.terminalOutcome === "terminal_unknown"
        ? await transaction.reviewPublicationOutcomeCorrectionV2.findFirst({
            where: { publicationAttemptId: publication.publicationAttemptId },
            orderBy: { correctionOrdinal: "desc" },
            select: { correctionOrdinal: true, correctedOutcome: true },
          })
        : null;
    const outcome = effectiveReviewPublicationOutcome({
      attempt: {
        terminalOutcome:
          publication.terminalOutcome === null
            ? null
            : publicationOutcomes[publication.terminalOutcome],
      },
      corrections: correction
        ? [
            {
              correctionOrdinal: correction.correctionOrdinal,
              correctedOutcome: correctedPublicationOutcome(
                correction.correctedOutcome,
              ),
            },
          ]
        : [],
    });
    if (outcome !== ReviewPublicationTerminalOutcome.Succeeded)
      throw invalidSettlement();

    const issues = readCapturedIssues({
      canonicalJson: artifact.projectionEnvelopeCanonicalJson,
      expectedFindingCount: artifact.findingCount,
      scmRepositoryIdentityId: execution.scmRepositoryIdentityId,
      pullRequestNumber: execution.pullRequestNumber,
    });
    const event = parseReviewStatisticsSettledEvent({
      version: 1,
      executionId: execution.executionId,
      workspaceId: execution.workspaceId,
      repositoryConnectionId: execution.repositoryConnectionId,
      scmRepositoryIdentityId: execution.scmRepositoryIdentityId,
      pullRequestNumber: execution.pullRequestNumber,
      finalizedArtifactId: artifact.artifactId,
      publicationAttemptId: publication.publicationAttemptId,
      projectionHash: artifact.projectionHash,
      state:
        settlement.state === ReviewCompletionProcessState.Completed
          ? ReviewStatisticsSettlementState.Completed
          : ReviewStatisticsSettlementState.CompletedSuperseded,
      settledAt: settlement.settledAt.toISOString(),
      issues,
    });
    await writer.write(transaction, event);
  };
}

/** Read only structured occurrence metadata; publication text never becomes telemetry. */
export function readCapturedIssues(input: {
  readonly canonicalJson: string;
  readonly expectedFindingCount: number;
  readonly scmRepositoryIdentityId: string;
  readonly pullRequestNumber: number;
}): ReviewStatisticsSettledEvent["issues"] {
  if (
    Buffer.byteLength(input.canonicalJson, "utf8") >
    reviewExecutionAbsoluteMaxProjectionBytes
  ) {
    throw invalidSettlement();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.canonicalJson);
  } catch {
    throw invalidSettlement();
  }
  if (
    !isRecord(parsed) ||
    parsed.envelopeVersion !== "review_projection.v1" ||
    !isRecord(parsed.scope) ||
    parsed.scope.scmRepositoryIdentityId !== input.scmRepositoryIdentityId ||
    parsed.scope.pullRequestNumber !== input.pullRequestNumber ||
    !isRecord(parsed.coverage) ||
    parsed.coverage.state !== "complete" ||
    !Array.isArray(parsed.occurrences) ||
    parsed.occurrences.length > reviewExecutionAbsoluteMaxFindingCount ||
    parsed.occurrences.length !== input.expectedFindingCount
  )
    throw invalidSettlement();
  const hints = new Map<string, Readonly<Record<string, unknown>>>();
  if (
    isRecord(parsed.snapshot) &&
    Array.isArray(parsed.snapshot.lineageHints)
  ) {
    for (const hint of parsed.snapshot.lineageHints) {
      if (isRecord(hint) && typeof hint.lineageId === "string")
        hints.set(hint.lineageId, hint);
    }
  }
  const issues = new Map<
    string,
    ReviewStatisticsSettledEvent["issues"][number]
  >();
  for (const occurrence of parsed.occurrences) {
    if (
      !isRecord(occurrence) ||
      typeof occurrence.lineageId !== "string" ||
      occurrence.lineageId.length === 0 ||
      occurrence.lineageId.length > 256
    )
      throw invalidSettlement();
    switch (occurrence.state) {
      case "new":
      case "reconfirmed":
      case "changed":
        break;
      case "carried_unverified":
      case "resolved":
      case "uncertain":
      case "suppressed_by_human":
        continue;
      default:
        throw invalidSettlement();
    }
    const hint = hints.get(occurrence.lineageId);
    const severity =
      hint?.severity === "critical"
        ? StatisticsSeverity.Critical
        : hint?.severity === "major"
          ? StatisticsSeverity.Major
          : hint?.severity === "minor"
            ? StatisticsSeverity.Minor
            : StatisticsSeverity.Unknown;
    const title =
      typeof hint?.title === "string"
        ? hint.title.replace(/\s+/g, " ").trim().slice(0, 240)
        : "";
    issues.set(occurrence.lineageId, {
      lineageId: occurrence.lineageId,
      severity,
      title: title || "Reported issue",
    });
  }
  return [...issues.values()];
}

const publicationOutcomes = {
  succeeded: ReviewPublicationTerminalOutcome.Succeeded,
  superseded_no_effect: ReviewPublicationTerminalOutcome.SupersededNoEffect,
  failed_no_effect: ReviewPublicationTerminalOutcome.FailedNoEffect,
  stale_compensated: ReviewPublicationTerminalOutcome.StaleCompensated,
  stale_visible: ReviewPublicationTerminalOutcome.StaleVisible,
  terminal_unknown: ReviewPublicationTerminalOutcome.TerminalUnknown,
} satisfies Record<
  ReviewPublicationTerminalOutcomeV2,
  ReviewPublicationTerminalOutcome
>;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalidSettlement(): Error {
  return new Error("review_statistics_settlement_invalid");
}

function correctedPublicationOutcome(
  value: ReviewPublicationTerminalOutcomeV2,
):
  | ReviewPublicationTerminalOutcome.Succeeded
  | ReviewPublicationTerminalOutcome.StaleCompensated
  | ReviewPublicationTerminalOutcome.StaleVisible {
  switch (value) {
    case "succeeded":
      return ReviewPublicationTerminalOutcome.Succeeded;
    case "stale_compensated":
      return ReviewPublicationTerminalOutcome.StaleCompensated;
    case "stale_visible":
      return ReviewPublicationTerminalOutcome.StaleVisible;
    default:
      throw invalidSettlement();
  }
}
