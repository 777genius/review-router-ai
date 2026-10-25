import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
} from "../../packages/protocol-review-action-v2/src/generated/companion-contracts.ts";

export const lifecycleCompanionContractFile = "companion-contracts.ts";
const trustedBytes = readFileSync(
  new URL(
    "../../packages/protocol-review-action-v2/src/generated/companion-contracts.ts",
    import.meta.url,
  ),
);
const trustedFileDigest = digest(trustedBytes);
const supportedProfile = Object.freeze({
  extensionId: lifecycleVerificationContract.extensionId,
  descriptorDigest: lifecycleVerificationDescriptorDigest,
});

export function parseLifecycleVerificationReleaseProfile(value: unknown) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join(",") !== "descriptorDigest,extensionId" ||
    (value as Record<string, unknown>).extensionId !==
      supportedProfile.extensionId ||
    (value as Record<string, unknown>).descriptorDigest !==
      supportedProfile.descriptorDigest
  )
    throw new Error("unsupported lifecycle verification release profile");
  return supportedProfile;
}

export function bindLifecycleVerificationReleaseProfile(
  value: unknown,
  generatedFileDigests: Readonly<Record<string, string>>,
) {
  const profile = parseLifecycleVerificationReleaseProfile(value);
  if (
    generatedFileDigests[lifecycleCompanionContractFile] !== trustedFileDigest
  )
    throw new Error(
      "lifecycle verification profile is not bound to the supported companion contract",
    );
  return profile;
}

/** Public TypeScript is data: recognize only exact trusted, handoff-bound bytes. */
export function projectLifecycleVerificationReleaseProfile(input: {
  readonly bytes?: Uint8Array;
  readonly generatedFileDigests: Readonly<Record<string, string>>;
  readonly declaredProfile?: unknown;
}) {
  if (
    input.bytes === undefined ||
    !/lifecycleVerification|lifecycle-verification/.test(
      Buffer.from(input.bytes).toString("utf8"),
    )
  ) {
    if (input.declaredProfile !== undefined)
      throw new Error(
        "declared lifecycle verification profile has no bound descriptor",
      );
    return undefined;
  }
  if (!Buffer.from(input.bytes).equals(trustedBytes))
    throw new Error(
      "unsupported lifecycle verification companion contract bytes",
    );
  return bindLifecycleVerificationReleaseProfile(
    input.declaredProfile === undefined
      ? supportedProfile
      : input.declaredProfile,
    input.generatedFileDigests,
  );
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
