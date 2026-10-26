import { createHash } from "node:crypto";

export const lifecycleCompanionContractFile = "companion-contracts.ts";
const supportedProfile = Object.freeze({
  extensionId: "lifecycle-verification.v1",
  descriptorDigest:
    "sha256:ac66b0d04cb2cc26ba5dc2a65c59a8d39cbd248bef426a25d249c96d141cf720",
} as const);
// Append-only historical release evidence, independent of today's generated file.
// New exports require source review; callers cannot supply trusted digests.
const supportedCompanionProfiles: Readonly<
  Record<string, typeof supportedProfile>
> = Object.freeze({
  // Public214/215: original lifecycle companion export.
  a206503361f316703f86b6741b114591d9beda0e65f3d665d2336d5e36d3b412:
    supportedProfile,
  // Public216: additive direct API credential modes; same lifecycle descriptor.
  "6394d8b5b1b922da6ae6fa6fec7897bb414676dbb847f9ba9e80192ce293749b":
    supportedProfile,
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
  const bound =
    supportedCompanionProfiles[
      generatedFileDigests[lifecycleCompanionContractFile] ?? ""
    ];
  if (
    !bound ||
    profile.extensionId !== bound.extensionId ||
    profile.descriptorDigest !== bound.descriptorDigest
  )
    throw new Error(
      "lifecycle verification profile is not bound to the supported companion contract",
    );
  return bound;
}

/** Public TypeScript is data: require reviewed historical bytes and their handoff binding. */
export function projectLifecycleVerificationReleaseProfile(input: {
  readonly bytes?: Uint8Array;
  readonly generatedFileDigests: Readonly<Record<string, string>>;
  readonly declaredProfile?: unknown;
}) {
  const boundDigest =
    input.generatedFileDigests[lifecycleCompanionContractFile];
  if (input.bytes === undefined) {
    if (input.declaredProfile !== undefined || boundDigest !== undefined)
      throw new Error(
        "declared lifecycle verification profile has no bound descriptor",
      );
    return undefined;
  }
  const actualDigest = digest(input.bytes);
  if (actualDigest !== boundDigest)
    throw new Error("companion contract bytes do not match handoff digest");
  const boundProfile = supportedCompanionProfiles[actualDigest];
  if (!boundProfile) {
    if (
      input.declaredProfile !== undefined ||
      /lifecycleVerification|lifecycle-verification/.test(
        Buffer.from(input.bytes).toString("utf8"),
      )
    )
      throw new Error(
        "unsupported lifecycle verification companion contract bytes",
      );
    return undefined;
  }
  return bindLifecycleVerificationReleaseProfile(
    input.declaredProfile === undefined ? boundProfile : input.declaredProfile,
    input.generatedFileDigests,
  );
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}
