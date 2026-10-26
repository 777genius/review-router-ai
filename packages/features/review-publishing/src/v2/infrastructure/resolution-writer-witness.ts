import { createHash, createPublicKey, verify } from "node:crypto";
import {
  isQualifiedResolutionWriterProof,
  type ResolutionWriterDrainQualificationPort,
} from "../application/use-cases/activate-review-resolution-history";
import { canonicalReviewPublicationJson } from "../domain/canonical-review-publication-json";
import {
  resolutionWriterWitnessPurpose,
  type ResolutionWriterWitness,
  type ResolutionWriterWitnessBinding,
  type ResolutionWriterWitnessUnsigned,
} from "../domain/resolution-writer-witness";
import type { ReviewPublicationScope } from "../domain/review-publication-attempt";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/u;
const identityPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export function resolutionWriterWitnessDigest(
  unsigned: ResolutionWriterWitnessUnsigned,
): string {
  return `sha256:${sha(canonicalReviewPublicationJson(unsigned))}`;
}

export type ResolutionWriterWitnessTrust = Readonly<{
  keyId: string;
  publicKeyPem: string;
  maximumAgeMilliseconds: number;
}>;

function canonicalBinding(value: ResolutionWriterWitnessBinding): boolean {
  return (
    identityPattern.test(value.environmentId) &&
    /^[a-f0-9]{40}$/u.test(value.deploymentRevision) &&
    /^sha256:[a-f0-9]{64}$/u.test(value.artifactDigest) &&
    digestPattern.test(value.fleetDigest) &&
    !!value.database &&
    /^\d+$/u.test(value.database.serverIdentity) &&
    /^\d+$/u.test(value.database.databaseIdentity) &&
    /^[A-Za-z0-9_.-]{1,128}$/u.test(value.database.databaseName) &&
    digestPattern.test(value.database.recoveryWitnessSha256)
  );
}

export function verifyResolutionWriterWitness(
  value: unknown,
  expected: ResolutionWriterWitnessBinding,
  trust: ResolutionWriterWitnessTrust,
  now: Date,
): ResolutionWriterWitness | null {
  try {
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !canonicalBinding(expected)
    )
      return null;
    const witness = value as ResolutionWriterWitness;
    if (
      Object.keys(witness).sort().join(",") !==
      [
        "purpose",
        "environmentId",
        "deploymentRevision",
        "artifactDigest",
        "fleetDigest",
        "database",
        "proof",
        "observedAt",
        "expiresAt",
        "bindingSha256",
        "signature",
      ]
        .sort()
        .join(",")
    )
      return null;
    if (
      witness.purpose !== resolutionWriterWitnessPurpose ||
      !canonicalBinding(witness) ||
      !identityPattern.test(trust.keyId) ||
      !Number.isSafeInteger(trust.maximumAgeMilliseconds) ||
      trust.maximumAgeMilliseconds < 1 ||
      trust.maximumAgeMilliseconds > 300_000
    )
      return null;
    const { signature, bindingSha256, ...unsigned } = witness;
    const {
      purpose: _purpose,
      proof,
      observedAt,
      expiresAt,
      ...binding
    } = unsigned;
    if (
      canonicalReviewPublicationJson(binding) !==
        canonicalReviewPublicationJson(expected) ||
      !isQualifiedResolutionWriterProof(proof, now, sha)
    )
      return null;
    const observed = Date.parse(observedAt);
    const expires = Date.parse(expiresAt);
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(observed) ||
      !Number.isFinite(expires) ||
      observed > now.getTime() ||
      now.getTime() >= expires ||
      observed >= expires ||
      expires - observed > trust.maximumAgeMilliseconds ||
      now.getTime() - observed > trust.maximumAgeMilliseconds ||
      (proof.qualificationSource === "retired_legacy_writers_quarantine.v1" &&
        Date.parse(proof.ingress.observedAt) > observed) ||
      bindingSha256 !== resolutionWriterWitnessDigest(unsigned) ||
      !signature ||
      Object.keys(signature).sort().join(",") !== "algorithm,keyId,value" ||
      signature.algorithm !== "Ed25519" ||
      signature.keyId !== trust.keyId ||
      !/^[A-Za-z0-9+/]{86}==$/u.test(signature.value)
    )
      return null;
    const key = createPublicKey(trust.publicKeyPem);
    if (
      key.asymmetricKeyType !== "ed25519" ||
      !verify(
        null,
        Buffer.from(bindingSha256, "utf8"),
        key,
        Buffer.from(signature.value, "base64"),
      )
    )
      return null;
    return witness;
  } catch {
    return null;
  }
}

/** No deployment snapshot is cached: revocation/expiry also closes existing guarded authority. */
export class SignedResolutionWriterQualification implements ResolutionWriterDrainQualificationPort {
  constructor(
    private readonly dependencies: Readonly<{
      readWitness: () => Promise<unknown>;
      observeBinding: () => Promise<ResolutionWriterWitnessBinding>;
      trust: ResolutionWriterWitnessTrust;
      now: () => Date;
    }>,
  ) {}

  async qualify(
    _scope: ReviewPublicationScope,
  ): ReturnType<ResolutionWriterDrainQualificationPort["qualify"]> {
    try {
      const [value, binding] = await Promise.all([
        this.dependencies.readWitness(),
        this.dependencies.observeBinding(),
      ]);
      const witness = verifyResolutionWriterWitness(
        value,
        binding,
        this.dependencies.trust,
        this.dependencies.now(),
      );
      return witness
        ? { status: "qualified", proof: witness.proof }
        : {
            status: "unqualified",
            reasonCode: "resolution_writer_witness_invalid",
          };
    } catch {
      return {
        status: "unqualified",
        reasonCode: "resolution_writer_witness_unavailable",
      };
    }
  }
}
