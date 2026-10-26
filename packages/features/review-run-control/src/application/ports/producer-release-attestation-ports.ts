import type { ReviewAgentProfile } from "../../domain/review-agent-profile";
import type {
  ProducerRelease,
  ProducerContextToolsProfile,
  ProducerPrDescriptionProfile,
  ProducerLifecycleVerificationProfile,
  ProducerReviewInvestigationProfile,
} from "../../domain/producer-release";
import type {
  ProducerDistributionKind,
  ReviewCapabilityProfile,
} from "../../domain/review-run-control-types";

export type TrustedProducerReleaseAttestation = {
  readonly contextToolsProfile?: ProducerContextToolsProfile;
  readonly producerReleaseId: string;
  readonly distributionKind: ProducerDistributionKind;
  readonly actionCommitSha: string;
  readonly runtimeCommitSha: string;
  readonly wrapperEntrypointDigest: string | null;
  readonly runtimeEntrypointDigest: string;
  readonly contextGatewayPolicyVersion: string | null;
  readonly contextGatewayEntrypointDigest: string | null;
  readonly lifecycleVerificationProfile?: ProducerLifecycleVerificationProfile | null;
  readonly prDescriptionProfile?: ProducerPrDescriptionProfile | null;
  readonly agentProfiles?: readonly ReviewAgentProfile[] | null;
  readonly reviewInvestigationProfile?: ProducerReviewInvestigationProfile | null;
  readonly schemaDigest: string;
  readonly canonicalizerDigest: string;
  readonly capabilityProfile: ReviewCapabilityProfile;
  readonly protocolLimitsProfileId: string;
  readonly operationalSloProfileId: string;
};

export enum ProducerReleaseAttestationStatus {
  Attested = "attested",
  Unregistered = "unregistered",
  Revoked = "revoked",
  Mismatch = "mismatch",
}

export type ProducerReleaseAttestationResult =
  | {
      readonly status: ProducerReleaseAttestationStatus.Attested;
      readonly release: ProducerRelease;
    }
  | {
      readonly status:
        | ProducerReleaseAttestationStatus.Unregistered
        | ProducerReleaseAttestationStatus.Revoked
        | ProducerReleaseAttestationStatus.Mismatch;
    };

export interface ProducerReleaseAttestationPort {
  attest(input: {
    readonly actionCommitSha: string;
    readonly expectedSchemaDigest: string;
    readonly expectedCanonicalizerDigest: string;
  }): Promise<ProducerReleaseAttestationResult>;
}
