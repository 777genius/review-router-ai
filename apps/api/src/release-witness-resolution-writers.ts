import { createHash } from "node:crypto";
import {
  isQualifiedResolutionWriterProof,
  resolutionWriterWitnessPurpose,
  type ResolutionWriterFleetObservationPort,
  type ResolutionWriterWitness,
} from "@reviewrouter/features-review-publishing/v2";
import { resolutionWriterWitnessDigest } from "@reviewrouter/features-review-publishing/v2/composition";
import type {
  ReleaseAuthorityMutationReadinessPort,
  ReleaseWitnessSignerPort,
} from "./release-witness-domain.js";

/** Only independently observed fleet/database facts enter this purpose-specific signer. */
export class AttestResolutionWriterQualification {
  constructor(
    private readonly observations: ResolutionWriterFleetObservationPort,
    private readonly signer: ReleaseWitnessSignerPort,
    private readonly readiness: ReleaseAuthorityMutationReadinessPort,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async execute(): Promise<ResolutionWriterWitness> {
    await this.readiness.assertOrdinary();
    const started = this.now().getTime();
    const observation = await this.observations.observe();
    await this.readiness.assertForceNew();
    const now = this.now();
    const observed = Date.parse(observation.observedAt);
    if (
      !Number.isFinite(started) ||
      !Number.isFinite(observed) ||
      observed < started ||
      observed > now.getTime() ||
      now.getTime() - started > 5_000 ||
      observation.proof.qualificationSource !==
        "retired_legacy_writers_quarantine.v1" ||
      !isQualifiedResolutionWriterProof(observation.proof, now, (value) =>
        createHash("sha256").update(value).digest("hex"),
      )
    )
      throw new Error("resolution_writer_observation_unqualified");
    const unsigned = {
      ...observation,
      purpose: resolutionWriterWitnessPurpose,
      expiresAt: new Date(observed + 60_000).toISOString(),
    };
    const bindingSha256 = resolutionWriterWitnessDigest(unsigned);
    return {
      ...unsigned,
      bindingSha256,
      signature: this.signer.sign(bindingSha256),
    };
  }
}
