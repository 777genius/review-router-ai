import { parseReviewModelDispatchProfileV2 } from "@reviewrouter/shared";
import type { ProducerReleaseQueryPort } from "../application/ports/producer-release-ports";
import { parseReviewAgentProfiles } from "../domain/review-agent-profile";
import {
  ProducerReleaseAttestationStatus,
  type ProducerReleaseAttestationPort,
  type TrustedProducerReleaseAttestation,
} from "../application/ports/producer-release-attestation-ports";
import {
  ProducerDistributionKind,
  ProducerReleaseState,
  ReviewCapabilityProfile,
  assertCommitSha,
  assertIdentifier,
  assertSha256,
  canonicalJson,
} from "../domain/review-run-control-types";
import {
  createProducerRelease,
  parseProducerPrDescriptionProfile,
  parseProducerLifecycleVerificationProfile,
  producerReleaseImmutableKey,
  parseProducerContextToolsProfile,
  reviewInvestigationCapabilityV1,
} from "../domain/producer-release";

export const reviewRunProducerReleaseAttestationsEnv =
  "REVIEW_ROUTER_REVIEW_V2_PRODUCER_RELEASE_ATTESTATIONS_JSON";

export class ConfiguredProducerReleaseAttestationRegistry implements ProducerReleaseAttestationPort {
  private readonly byActionCommitSha: ReadonlyMap<
    string,
    TrustedProducerReleaseAttestation
  >;

  constructor(
    attestations: readonly TrustedProducerReleaseAttestation[],
    private readonly releases: ProducerReleaseQueryPort,
  ) {
    if (attestations.length === 0 || attestations.length > 100) {
      throw new Error("producer_release_attestations_count_invalid");
    }
    const entries = new Map<string, TrustedProducerReleaseAttestation>();
    for (const attestation of attestations) {
      assertAttestation(attestation);
      const actionCommitSha = attestation.actionCommitSha.toLowerCase();
      if (entries.has(actionCommitSha)) {
        throw new Error("producer_release_attestation_action_commit_duplicate");
      }
      entries.set(
        actionCommitSha,
        Object.freeze({
          ...attestation,
          ...(attestation.contextToolsProfile !== undefined
            ? {
                contextToolsProfile: parseProducerContextToolsProfile(
                  attestation.contextToolsProfile,
                ),
              }
            : {}),
          ...(attestation.modelDispatchProfile == null
            ? {}
            : {
                modelDispatchProfile: parseReviewModelDispatchProfileV2(
                  attestation.modelDispatchProfile,
                ),
              }),
          ...(attestation.prDescriptionProfile == null
            ? {}
            : {
                prDescriptionProfile: parseProducerPrDescriptionProfile(
                  attestation.prDescriptionProfile,
                ),
              }),
          ...(attestation.lifecycleVerificationProfile == null
            ? {}
            : {
                lifecycleVerificationProfile:
                  parseProducerLifecycleVerificationProfile(
                    attestation.lifecycleVerificationProfile,
                  ),
              }),
        }),
      );
    }
    this.byActionCommitSha = entries;
  }

  async attest(
    input: Parameters<ProducerReleaseAttestationPort["attest"]>[0],
  ): ReturnType<ProducerReleaseAttestationPort["attest"]> {
    const configured = this.byActionCommitSha.get(
      input.actionCommitSha.toLowerCase(),
    );
    if (!configured) {
      return { status: ProducerReleaseAttestationStatus.Unregistered };
    }
    if (
      input.expectedSchemaDigest !== configured.schemaDigest ||
      input.expectedCanonicalizerDigest !== configured.canonicalizerDigest
    ) {
      return { status: ProducerReleaseAttestationStatus.Mismatch };
    }
    const release = await this.releases.findProducerReleaseById(
      configured.producerReleaseId,
    );
    if (!release) {
      return {
        status: ProducerReleaseAttestationStatus.Attested,
        release: createProducerRelease(
          {
            producerReleaseId: configured.producerReleaseId,
            distributionKind: configured.distributionKind,
            actionCommitSha: configured.actionCommitSha,
            runtimeCommitSha: configured.runtimeCommitSha,
            wrapperEntrypointDigest: configured.wrapperEntrypointDigest,
            runtimeEntrypointDigest: configured.runtimeEntrypointDigest,
            contextGatewayPolicyVersion: configured.contextGatewayPolicyVersion,
            contextGatewayEntrypointDigest:
              configured.contextGatewayEntrypointDigest,
            reviewInvestigationProfile:
              configured.reviewInvestigationProfile ?? null,
            agentProfiles: configured.agentProfiles ?? null,
            ...(configured.contextToolsProfile !== undefined
              ? { contextToolsProfile: configured.contextToolsProfile }
              : {}),
            ...(configured.modelDispatchProfile == null
              ? {}
              : {
                  modelDispatchProfile: parseReviewModelDispatchProfileV2(
                    configured.modelDispatchProfile,
                  ),
                }),
            ...(configured.prDescriptionProfile == null
              ? {}
              : { prDescriptionProfile: configured.prDescriptionProfile }),
            ...(configured.lifecycleVerificationProfile == null
              ? {}
              : {
                  lifecycleVerificationProfile:
                    configured.lifecycleVerificationProfile,
                }),
            schemaDigest: configured.schemaDigest,
            capabilityProfile: configured.capabilityProfile,
            protocolLimitsProfileId: configured.protocolLimitsProfileId,
            operationalSloProfileId: configured.operationalSloProfileId,
          },
          new Date(0),
        ),
      };
    }
    if (release.state !== ProducerReleaseState.Registered) {
      return { status: ProducerReleaseAttestationStatus.Revoked };
    }
    if (
      producerReleaseImmutableKey(release) !== configuredReleaseKey(configured)
    ) {
      return { status: ProducerReleaseAttestationStatus.Mismatch };
    }
    return { status: ProducerReleaseAttestationStatus.Attested, release };
  }
}

export function readConfiguredProducerReleaseAttestations(
  env: Readonly<Record<string, string | undefined>>,
): readonly TrustedProducerReleaseAttestation[] {
  const raw = env[reviewRunProducerReleaseAttestationsEnv];
  if (!raw) throw new Error("producer_release_attestations_env_missing");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("producer_release_attestations_env_invalid");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("producer_release_attestations_env_invalid");
  }
  return parsed.map(parseAttestation);
}

function parseAttestation(value: unknown): TrustedProducerReleaseAttestation {
  if (!isRecord(value)) {
    throw new Error("producer_release_attestation_invalid");
  }
  const legacyKeys = [
    "producerReleaseId",
    "distributionKind",
    "actionCommitSha",
    "runtimeCommitSha",
    "wrapperEntrypointDigest",
    "runtimeEntrypointDigest",
    "schemaDigest",
    "canonicalizerDigest",
    "capabilityProfile",
    "protocolLimitsProfileId",
    "operationalSloProfileId",
  ].sort();
  const expectedKeys = [
    ...legacyKeys,
    "contextGatewayPolicyVersion",
    "contextGatewayEntrypointDigest",
  ].sort();
  const investigationKeys = [
    ...expectedKeys,
    "reviewInvestigationCapability",
    "reviewInvestigationCoverageProfileHash",
    "reviewInvestigationPolicyHash",
  ].sort();
  const actualKeys = Object.keys(value)
    .filter((key) => key !== "contextToolsProfile")
    .filter((key) => key !== "prDescriptionProfile")
    .filter((key) => key !== "lifecycleVerificationProfile")
    .filter((key) => key !== "modelDispatchProfile")
    .sort();
  const currentKeys = [...investigationKeys, "agentProfiles"].sort();
  if (
    canonicalJson(actualKeys) !== canonicalJson(currentKeys) &&
    canonicalJson(actualKeys) !== canonicalJson(expectedKeys) &&
    canonicalJson(actualKeys) !== canonicalJson(legacyKeys) &&
    canonicalJson(actualKeys) !== canonicalJson(investigationKeys)
  ) {
    throw new Error("producer_release_attestation_shape_invalid");
  }
  const investigationValues = [
    value.reviewInvestigationCapability,
    value.reviewInvestigationCoverageProfileHash,
    value.reviewInvestigationPolicyHash,
  ];
  const investigationFieldPresence = investigationValues.map(
    (field) => field !== undefined && field !== null,
  );
  const hasReviewInvestigationProfile =
    investigationFieldPresence.every(Boolean);
  if (
    investigationFieldPresence.some(Boolean) &&
    !hasReviewInvestigationProfile
  ) {
    throw new Error(
      "producer_release_attestation_investigation_profile_incomplete",
    );
  }
  return {
    ...(value.modelDispatchProfile == null
      ? {}
      : {
          modelDispatchProfile: parseReviewModelDispatchProfileV2(
            value.modelDispatchProfile,
          ),
        }),
    ...(value.prDescriptionProfile == null
      ? {}
      : {
          prDescriptionProfile: parseProducerPrDescriptionProfile(
            value.prDescriptionProfile,
          ),
        }),
    ...(value.lifecycleVerificationProfile == null
      ? {}
      : {
          lifecycleVerificationProfile:
            parseProducerLifecycleVerificationProfile(
              value.lifecycleVerificationProfile,
            ),
        }),
    producerReleaseId: requiredString(value.producerReleaseId),
    ...("contextToolsProfile" in value
      ? {
          contextToolsProfile: parseProducerContextToolsProfile(
            value.contextToolsProfile,
          ),
        }
      : {}),
    agentProfiles:
      value.agentProfiles == null
        ? null
        : parseReviewAgentProfiles(value.agentProfiles),
    distributionKind: parseDistributionKind(value.distributionKind),
    actionCommitSha: requiredString(value.actionCommitSha),
    runtimeCommitSha: requiredString(value.runtimeCommitSha),
    wrapperEntrypointDigest:
      value.wrapperEntrypointDigest === null
        ? null
        : requiredString(value.wrapperEntrypointDigest),
    runtimeEntrypointDigest: requiredString(value.runtimeEntrypointDigest),
    contextGatewayPolicyVersion:
      value.contextGatewayPolicyVersion === undefined ||
      value.contextGatewayPolicyVersion === null
        ? null
        : requiredString(value.contextGatewayPolicyVersion),
    contextGatewayEntrypointDigest:
      value.contextGatewayEntrypointDigest === undefined ||
      value.contextGatewayEntrypointDigest === null
        ? null
        : requiredString(value.contextGatewayEntrypointDigest),
    reviewInvestigationProfile: hasReviewInvestigationProfile
      ? {
          capability: parseReviewInvestigationCapability(
            value.reviewInvestigationCapability,
          ),
          coverageProfileHash: requiredString(
            value.reviewInvestigationCoverageProfileHash,
          ),
          policyHash: requiredString(value.reviewInvestigationPolicyHash),
        }
      : null,
    schemaDigest: requiredString(value.schemaDigest),
    canonicalizerDigest: requiredString(value.canonicalizerDigest),
    capabilityProfile: parseCapabilityProfile(value.capabilityProfile),
    protocolLimitsProfileId: requiredString(value.protocolLimitsProfileId),
    operationalSloProfileId: requiredString(value.operationalSloProfileId),
  };
}

function assertAttestation(value: TrustedProducerReleaseAttestation): void {
  if (value.modelDispatchProfile != null)
    parseReviewModelDispatchProfileV2(value.modelDispatchProfile);
  if (value.contextToolsProfile !== undefined)
    parseProducerContextToolsProfile(value.contextToolsProfile);
  if (value.lifecycleVerificationProfile != null)
    parseProducerLifecycleVerificationProfile(
      value.lifecycleVerificationProfile,
    );
  if (value.prDescriptionProfile != null)
    parseProducerPrDescriptionProfile(value.prDescriptionProfile);
  assertIdentifier(value.producerReleaseId, "producer_release_id");
  assertCommitSha(value.actionCommitSha, "action_commit_sha");
  assertCommitSha(value.runtimeCommitSha, "runtime_commit_sha");
  if (value.wrapperEntrypointDigest !== null) {
    assertSha256(value.wrapperEntrypointDigest, "wrapper_entrypoint_digest");
  }
  assertSha256(value.runtimeEntrypointDigest, "runtime_entrypoint_digest");
  if (
    (value.contextGatewayPolicyVersion === null) !==
    (value.contextGatewayEntrypointDigest === null)
  ) {
    throw new Error("producer_release_context_gateway_artifact_incomplete");
  }
  const investigation = value.reviewInvestigationProfile ?? null;
  if (investigation !== null) {
    if (investigation.capability !== reviewInvestigationCapabilityV1) {
      throw new Error("producer_release_investigation_capability_invalid");
    }
    assertSha256(
      investigation.coverageProfileHash,
      "review_investigation_coverage_profile_hash",
    );
    assertSha256(investigation.policyHash, "review_investigation_policy_hash");
    if (
      value.contextGatewayPolicyVersion === null ||
      value.contextGatewayEntrypointDigest === null
    ) {
      throw new Error("producer_release_investigation_gateway_required");
    }
  }
  if (
    value.contextGatewayPolicyVersion !== null &&
    value.contextGatewayEntrypointDigest !== null
  ) {
    assertIdentifier(
      value.contextGatewayPolicyVersion,
      "context_gateway_policy_version",
    );
    assertSha256(
      value.contextGatewayEntrypointDigest,
      "context_gateway_entrypoint_digest",
    );
  }
  assertSha256(value.schemaDigest, "schema_digest");
  assertSha256(value.canonicalizerDigest, "canonicalizer_digest");
  assertIdentifier(value.protocolLimitsProfileId, "protocol_limits_profile_id");
  assertIdentifier(value.operationalSloProfileId, "operational_slo_profile_id");
}

function configuredReleaseKey(
  configured: TrustedProducerReleaseAttestation,
): string {
  return canonicalJson({
    ...(configured.contextToolsProfile !== undefined
      ? {
          contextToolsProfile: parseProducerContextToolsProfile(
            configured.contextToolsProfile,
          ),
        }
      : {}),
    ...(configured.modelDispatchProfile == null
      ? {}
      : {
          modelDispatchProfile: parseReviewModelDispatchProfileV2(
            configured.modelDispatchProfile,
          ),
        }),
    ...(configured.prDescriptionProfile == null
      ? {}
      : {
          prDescriptionProfile: parseProducerPrDescriptionProfile(
            configured.prDescriptionProfile,
          ),
        }),
    ...(configured.lifecycleVerificationProfile == null
      ? {}
      : {
          lifecycleVerificationProfile:
            parseProducerLifecycleVerificationProfile(
              configured.lifecycleVerificationProfile,
            ),
        }),
    agentProfiles: configured.agentProfiles ?? null,
    distributionKind: configured.distributionKind,
    actionCommitSha: configured.actionCommitSha,
    runtimeCommitSha: configured.runtimeCommitSha,
    wrapperEntrypointDigest: configured.wrapperEntrypointDigest,
    runtimeEntrypointDigest: configured.runtimeEntrypointDigest,
    contextGatewayPolicyVersion: configured.contextGatewayPolicyVersion,
    contextGatewayEntrypointDigest: configured.contextGatewayEntrypointDigest,
    reviewInvestigationCapability:
      configured.reviewInvestigationProfile?.capability ?? null,
    reviewInvestigationCoverageProfileHash:
      configured.reviewInvestigationProfile?.coverageProfileHash ?? null,
    reviewInvestigationPolicyHash:
      configured.reviewInvestigationProfile?.policyHash ?? null,
    schemaDigest: configured.schemaDigest,
    capabilityProfile: configured.capabilityProfile,
    protocolLimitsProfileId: configured.protocolLimitsProfileId,
    operationalSloProfileId: configured.operationalSloProfileId,
  });
}

function parseReviewInvestigationCapability(
  value: unknown,
): typeof reviewInvestigationCapabilityV1 {
  if (value !== reviewInvestigationCapabilityV1) {
    throw new Error("producer_release_investigation_capability_invalid");
  }
  return value;
}

function requiredString(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("producer_release_attestation_value_invalid");
  }
  return value;
}

function parseDistributionKind(value: unknown): ProducerDistributionKind {
  if (value === ProducerDistributionKind.HostedComposite) return value;
  if (value === ProducerDistributionKind.PublicReusable) return value;
  throw new Error("producer_release_attestation_distribution_invalid");
}

function parseCapabilityProfile(value: unknown): ReviewCapabilityProfile {
  if (value === ReviewCapabilityProfile.ExactRevisionV2) return value;
  throw new Error("producer_release_attestation_capability_profile_invalid");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
