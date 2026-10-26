import {
  ProducerReleaseAttestationStatus,
  type ProducerReleaseAttestationPort,
  type ProducerReleaseAttestationResult,
} from "@reviewrouter/features-review-run-control";
import {
  reviewActionV2SupportedContracts,
  type ReviewActionV2ContractDescriptor,
} from "@reviewrouter/protocol-review-action-v2";

type CompiledProducerContractAttestation =
  | (Extract<
      ProducerReleaseAttestationResult,
      { status: ProducerReleaseAttestationStatus.Attested }
    > & {
      readonly contract: ReviewActionV2ContractDescriptor;
    })
  | Exclude<
      ProducerReleaseAttestationResult,
      { status: ProducerReleaseAttestationStatus.Attested }
    >;

/** The Action SHA must already come from verified SCM identity, never the wire body. */
export async function attestCompiledReviewActionV2ProducerContract(
  attestations: ProducerReleaseAttestationPort,
  actionCommitSha: string,
  schemaDigest: string,
): Promise<CompiledProducerContractAttestation> {
  for (const contract of reviewActionV2SupportedContracts()) {
    if (contract.schemaDigest !== schemaDigest) continue;
    const attested = await attestations.attest({
      actionCommitSha,
      expectedSchemaDigest: schemaDigest,
      expectedCanonicalizerDigest: contract.canonicalizerDigest,
    });
    if (attested.status === ProducerReleaseAttestationStatus.Attested) {
      if (
        attested.release.schemaDigest !== schemaDigest ||
        attested.release.actionCommitSha !== actionCommitSha.toLowerCase()
      )
        return { status: ProducerReleaseAttestationStatus.Mismatch };
      return { ...attested, contract };
    }
    // A different compiled canonicalizer may match this schema. No other denial permits fallback.
    if (attested.status !== ProducerReleaseAttestationStatus.Mismatch)
      return attested;
  }
  return { status: ProducerReleaseAttestationStatus.Mismatch };
}
