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
} from "../domain/producer-release";
import { ProducerReleaseState } from "../domain/review-run-control-types";
import {
  trustedProducerReleaseMaterializationLimits,
  trustedProducerReleaseMaterializationOwnerRefs,
  trustedProducerReleaseMaterializationRunbookRefs,
  trustedProducerReleaseMaterializationThresholds,
} from "../producer-release-defaults";

export { trustedProducerReleaseMaterializationLimits } from "../producer-release-defaults";

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
            ...(release.reviewerPlanProfile !== undefined
              ? { reviewerPlanProfile: release.reviewerPlanProfile }
              : {}),
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
