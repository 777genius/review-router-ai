import { describe, expect, it, vi } from "vitest";
import {
  ProducerDistributionKind,
  ProducerReleaseAttestationStatus,
  ReviewCapabilityProfile,
  type ProducerReleaseAttestationResult,
  createProducerRelease,
} from "@reviewrouter/features-review-run-control";
import { reviewActionV2SupportedContracts } from "@reviewrouter/protocol-review-action-v2";
import { attestCompiledReviewActionV2ProducerContract } from "./review-action-v2-producer-contract-attestation.js";

const actionCommitSha = "66ac53a5953c2da498f7d2c3b644dd6ef5ccf3ff";
const release = (schemaDigest: string) =>
  createProducerRelease(
    {
      producerReleaseId: "approved171",
      distributionKind: ProducerDistributionKind.PublicReusable,
      actionCommitSha,
      runtimeCommitSha: "b".repeat(40),
      wrapperEntrypointDigest: null,
      runtimeEntrypointDigest: "c".repeat(64),
      schemaDigest,
      capabilityProfile: ReviewCapabilityProfile.ExactRevisionV2,
      protocolLimitsProfileId: "limits",
      operationalSloProfileId: "slos",
    },
    new Date(0),
  );

describe("compiled producer contract attestation", () => {
  it.each(reviewActionV2SupportedContracts())(
    "attests the exact compiled tuple $canonicalizerDigest for the verified Action",
    async (contract) => {
      const attest = vi.fn(
        async (input: {
          actionCommitSha: string;
          expectedSchemaDigest: string;
          expectedCanonicalizerDigest: string;
        }) =>
          input.actionCommitSha === actionCommitSha &&
          input.expectedSchemaDigest === contract.schemaDigest &&
          input.expectedCanonicalizerDigest === contract.canonicalizerDigest
            ? {
                status: ProducerReleaseAttestationStatus.Attested as const,
                release: release(contract.schemaDigest),
              }
            : { status: ProducerReleaseAttestationStatus.Mismatch as const },
      );
      await expect(
        attestCompiledReviewActionV2ProducerContract(
          { attest },
          actionCommitSha,
          contract.schemaDigest,
        ),
      ).resolves.toMatchObject({
        status: ProducerReleaseAttestationStatus.Attested,
        contract,
      });
      for (const [input] of attest.mock.calls)
        expect(input.actionCommitSha).toBe(actionCommitSha);
    },
  );

  it.each([
    ProducerReleaseAttestationStatus.Revoked,
    ProducerReleaseAttestationStatus.Unregistered,
  ] as const)("never retries %s with another canonicalizer", async (status) => {
    const attest = vi.fn(
      async (): Promise<ProducerReleaseAttestationResult> => ({ status }),
    );
    await expect(
      attestCompiledReviewActionV2ProducerContract(
        { attest },
        actionCommitSha,
        reviewActionV2SupportedContracts()[1]!.schemaDigest,
      ),
    ).resolves.toEqual({ status });
    expect(attest).toHaveBeenCalledOnce();
  });

  it("refuses unknown schema or canonicalizer and stops at the finite compiled candidates", async () => {
    const attest = vi.fn(async () => ({
      status: ProducerReleaseAttestationStatus.Mismatch as const,
    }));
    await expect(
      attestCompiledReviewActionV2ProducerContract(
        { attest },
        actionCommitSha,
        "f".repeat(64),
      ),
    ).resolves.toEqual({ status: ProducerReleaseAttestationStatus.Mismatch });
    expect(attest).not.toHaveBeenCalled();
    const schemaDigest = reviewActionV2SupportedContracts()[1]!.schemaDigest;
    await expect(
      attestCompiledReviewActionV2ProducerContract(
        { attest },
        actionCommitSha,
        schemaDigest,
      ),
    ).resolves.toEqual({ status: ProducerReleaseAttestationStatus.Mismatch });
    expect(attest).toHaveBeenCalledTimes(2);
    expect(attest.mock.calls).toEqual(
      reviewActionV2SupportedContracts()
        .filter((contract) => contract.schemaDigest === schemaDigest)
        .map((contract) => [
          {
            actionCommitSha,
            expectedSchemaDigest: schemaDigest,
            expectedCanonicalizerDigest: contract.canonicalizerDigest,
          },
        ]),
    );
  });
});
