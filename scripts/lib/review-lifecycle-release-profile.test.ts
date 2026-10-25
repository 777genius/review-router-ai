import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  lifecycleVerificationContract,
  lifecycleVerificationDescriptorDigest,
} from "../../packages/protocol-review-action-v2/src/generated/companion-contracts.js";
import {
  bindLifecycleVerificationReleaseProfile,
  parseLifecycleVerificationReleaseProfile,
  projectLifecycleVerificationReleaseProfile,
} from "./review-lifecycle-release-profile.js";
import {
  canonicalJson,
  buildReleaseRegistrationCandidateFields,
  parseReleaseManifest,
  sha256Digest,
} from "./review-action-v2-release-manifests.mjs";
const profile = {
  extensionId: lifecycleVerificationContract.extensionId,
  descriptorDigest: lifecycleVerificationDescriptorDigest,
};
const bytes = readFileSync(
  new URL(
    "../../packages/protocol-review-action-v2/src/generated/companion-contracts.ts",
    import.meta.url,
  ),
);
const generatedFileDigests = { "companion-contracts.ts": sha256Digest(bytes) };

describe("bound lifecycle release projection", () => {
  it("keeps legacy absence and rejects a declaration without bound bytes", () => {
    expect(
      projectLifecycleVerificationReleaseProfile({ generatedFileDigests: {} }),
    ).toBeUndefined();
    expect(
      projectLifecycleVerificationReleaseProfile({
        bytes: Buffer.from("export const legacy = 1;"),
        generatedFileDigests: {},
      }),
    ).toBeUndefined();
    expect(() =>
      projectLifecycleVerificationReleaseProfile({
        generatedFileDigests: {},
        declaredProfile: profile,
      }),
    ).toThrow("no bound descriptor");
  });
  it.each([
    null,
    { ...profile, extensionId: "lifecycle-verification.v2" },
    { ...profile, descriptorDigest: "sha256:" + "f".repeat(64) },
    { ...profile, bypass: true },
  ])(
    "rejects an unsupported or malformed declaration %#",
    (declaredProfile) => {
      expect(() =>
        parseLifecycleVerificationReleaseProfile(declaredProfile),
      ).toThrow("unsupported lifecycle");
      expect(() =>
        projectLifecycleVerificationReleaseProfile({
          bytes,
          generatedFileDigests,
          declaredProfile,
        }),
      ).toThrow("unsupported lifecycle");
    },
  );
  it("rejects an unbound profile even with a syntactically valid release", () => {
    expect(() => bindLifecycleVerificationReleaseProfile(profile, {})).toThrow(
      "not bound",
    );
    const legacy = JSON.parse(
      readFileSync(
        new URL(
          "../fixtures/review-action-v2-release/expected-release.json",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    expect(canonicalJson(parseReleaseManifest(canonicalJson(legacy)))).toBe(
      canonicalJson(legacy),
    );
    expect(buildReleaseRegistrationCandidateFields(legacy)).not.toHaveProperty(
      "lifecycleVerificationProfile",
    );
    expect(() =>
      parseReleaseManifest(
        canonicalJson({ ...legacy, lifecycleVerificationProfile: profile }),
      ),
    ).toThrow("not bound");
  });
});
