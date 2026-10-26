import type { Sha256DigestPort } from "../application/ports/platform-ports";
import type {
  ProducerReleaseQueryPort,
  TrustedProducerReleaseMaterializerPort,
  ReviewOperationalSloProfileQueryPort,
  ReviewProtocolLimitsProfileQueryPort,
} from "../application/ports/producer-release-ports";
import { ImmutableRegistryWriteStatus } from "../application/ports/producer-release-ports";
import type { ManageProducerReleases } from "../application/use-cases/manage-producer-releases";
import {
  canonicalReviewOperationalSloProfile,
  canonicalReviewProtocolLimits,
  producerReleaseImmutableKey,
  type ProducerRelease,
  type ReviewOperationalSloThresholds,
  type ReviewProtocolLimits,
} from "../domain/producer-release";
import { ProducerReleaseState } from "../domain/review-run-control-types";

export type { TrustedProducerReleaseMaterializerPort } from "../application/ports/producer-release-ports";

export type TrustedProducerReleaseManagement = Pick<
  ManageProducerReleases,
  | "registerProtocolLimitsProfile"
  | "registerOperationalSloProfile"
  | "registerProducerRelease"
>;

export function createTrustedProducerReleaseMaterializer(input: {
  readonly digest: Sha256DigestPort;
  readonly producerReleases: TrustedProducerReleaseManagement;
  readonly releaseQueries: ProducerReleaseQueryPort;
  readonly protocolLimitsQueries: ReviewProtocolLimitsProfileQueryPort;
  readonly operationalSloQueries: ReviewOperationalSloProfileQueryPort;
}): TrustedProducerReleaseMaterializerPort {
  return {
    async ensureRegistered(release: ProducerRelease): Promise<void> {
      if (release.state !== ProducerReleaseState.Registered)
        throw new Error("trusted_producer_release_revoked");
      const existing = await input.releaseQueries.findProducerReleaseById(
        release.producerReleaseId,
      );
      if (existing) {
        if (existing.state !== ProducerReleaseState.Registered)
          throw new Error("trusted_producer_release_revoked");
        if (
          producerReleaseImmutableKey(existing) !==
          producerReleaseImmutableKey(release)
        )
          throw new Error("trusted_producer_release_conflict");
        return;
      }
      const sloProfile = {
        thresholds: trustedProducerReleaseMaterializationThresholds,
        ownerRefs: trustedProducerReleaseMaterializationOwnerRefs,
        runbookRefs: trustedProducerReleaseMaterializationRunbookRefs,
      } as const;
      const [existingLimits, existingSlo] = await Promise.all([
        input.protocolLimitsQueries.findProtocolLimitsProfileById(
          release.protocolLimitsProfileId,
        ),
        input.operationalSloQueries.findOperationalSloProfileById(
          release.operationalSloProfileId,
        ),
      ]);
      const limitsDigest =
        existingLimits?.limitsDigest ??
        (await input.digest.digestUtf8(
          canonicalReviewProtocolLimits(
            trustedProducerReleaseMaterializationLimits,
          ),
        ));
      const sloDigest =
        existingSlo?.sloDigest ??
        (await input.digest.digestUtf8(
          canonicalReviewOperationalSloProfile(sloProfile),
        ));
      if (!existingLimits) {
        assertTrustedMaterializationResult(
          await input.producerReleases.registerProtocolLimitsProfile({
            protocolLimitsProfileId: release.protocolLimitsProfileId,
            limitsDigest,
            limits: trustedProducerReleaseMaterializationLimits,
          }),
          "trusted_producer_release_limits_conflict",
        );
      }
      if (!existingSlo) {
        assertTrustedMaterializationResult(
          await input.producerReleases.registerOperationalSloProfile({
            operationalSloProfileId: release.operationalSloProfileId,
            sloDigest,
            ...sloProfile,
          }),
          "trusted_producer_release_slo_conflict",
        );
      }
      assertTrustedMaterializationResult(
        await input.producerReleases.registerProducerRelease({
          candidate: {
            producerReleaseId: release.producerReleaseId,
            distributionKind: release.distributionKind,
            actionCommitSha: release.actionCommitSha,
            runtimeCommitSha: release.runtimeCommitSha,
            wrapperEntrypointDigest: release.wrapperEntrypointDigest,
            runtimeEntrypointDigest: release.runtimeEntrypointDigest,
            contextGatewayPolicyVersion: release.contextGatewayPolicyVersion,
            contextGatewayEntrypointDigest:
              release.contextGatewayEntrypointDigest,
            schemaDigest: release.schemaDigest,
            capabilityProfile: release.capabilityProfile,
            protocolLimitsProfileId: release.protocolLimitsProfileId,
            operationalSloProfileId: release.operationalSloProfileId,
            reviewInvestigationProfile: release.reviewInvestigationProfile,
            agentProfiles: release.agentProfiles ?? null,
            ...(release.contextToolsProfile !== undefined
              ? { contextToolsProfile: release.contextToolsProfile }
              : {}),
            ...(release.lifecycleVerificationProfile == null
              ? {}
              : {
                  lifecycleVerificationProfile:
                    release.lifecycleVerificationProfile,
                }),
            ...(release.modelDispatchProfile == null
              ? {}
              : { modelDispatchProfile: release.modelDispatchProfile }),
            ...(release.prDescriptionProfile == null
              ? {}
              : { prDescriptionProfile: release.prDescriptionProfile }),
          },
          expectedProtocolLimitsDigest: limitsDigest,
          expectedOperationalSloDigest: sloDigest,
        }),
        "trusted_producer_release_conflict",
      );
    },
  };
}

function assertTrustedMaterializationResult(
  result: { readonly status: ImmutableRegistryWriteStatus },
  issue: string,
): void {
  if (result.status === ImmutableRegistryWriteStatus.Conflict) {
    throw new Error(issue);
  }
}

export const trustedProducerReleaseMaterializationLimits: ReviewProtocolLimits =
  Object.freeze({
    maxWorkSlots: 200,
    maxAttemptsPerSlot: 4,
    maxObservationBytes: 1_000_000,
    maxObservationFindings: 1_000,
    maxProjectionBytes: 2_000_000,
    maxProjectionFindings: 2_000,
    maxPublicationOperations: 500,
    maxPublicationChunks: 500,
    maxPublicationBodyBytes: 2_000_000,
    maxRequestBatchSize: 100,
    maxLeaseDurationMs: 600_000,
    maxResultReportDurationMs: 1_200_000,
    maxReconciliationDurationMs: 3_600_000,
  });

const trustedProducerReleaseMaterializationThresholds: ReviewOperationalSloThresholds =
  Object.freeze({
    integrationEventDeliveryMs: 60_000,
    outboxClaimAgeMs: 120_000,
    missingCompletionProcessMs: 300_000,
    dueCompletionProcessMs: 300_000,
    publicationReconciliationMs: 600_000,
    v1DrainMs: 3_600_000,
    admissionMs: 30_000,
    pruningBacklogAgeMs: 86_400_000,
  });

const trustedProducerReleaseMaterializationOwnerRefs = [
  "team-reviewrouter",
] as const;
const trustedProducerReleaseMaterializationRunbookRefs = [
  "docs/operations/review-action-v2-cutover.md",
] as const;
