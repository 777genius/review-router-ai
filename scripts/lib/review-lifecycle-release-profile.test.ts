import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
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
  extensionId: "lifecycle-verification.v1",
  descriptorDigest:
    "sha256:ac66b0d04cb2cc26ba5dc2a65c59a8d39cbd248bef426a25d249c96d141cf720",
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
        generatedFileDigests: {
          "companion-contracts.ts": sha256Digest("export const legacy = 1;"),
        },
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
  it.each([
    "a206503361f316703f86b6741b114591d9beda0e65f3d665d2336d5e36d3b412",
    "6394d8b5b1b922da6ae6fa6fec7897bb414676dbb847f9ba9e80192ce293749b",
  ])("preserves reviewed historical companion digest %s", (companionDigest) => {
    const bound = { "companion-contracts.ts": companionDigest };
    expect(bindLifecycleVerificationReleaseProfile(profile, bound)).toEqual(
      profile,
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
    const release = {
      ...legacy,
      lifecycleVerificationProfile: profile,
      generatedFileDigests: { ...legacy.generatedFileDigests, ...bound },
    };
    expect(canonicalJson(parseReleaseManifest(canonicalJson(release)))).toBe(
      canonicalJson(release),
    );
    expect(
      buildReleaseRegistrationCandidateFields(release)
        .lifecycleVerificationProfile,
    ).toEqual(profile);
  });
  it("rejects unknown binding hashes and bytes that differ from their handoff", () => {
    expect(() =>
      bindLifecycleVerificationReleaseProfile(profile, {
        "companion-contracts.ts": "f".repeat(64),
      }),
    ).toThrow("not bound");
    expect(
      projectLifecycleVerificationReleaseProfile({
        bytes,
        generatedFileDigests,
      }),
    ).toEqual(profile);
    expect(() =>
      projectLifecycleVerificationReleaseProfile({
        bytes: Buffer.concat([bytes, Buffer.from("\n")]),
        generatedFileDigests,
      }),
    ).toThrow("do not match handoff digest");
    const unknownBytes = Buffer.concat([bytes, Buffer.from("\n")]);
    expect(() =>
      projectLifecycleVerificationReleaseProfile({
        bytes: unknownBytes,
        generatedFileDigests: {
          "companion-contracts.ts": sha256Digest(unknownBytes),
        },
      }),
    ).toThrow("unsupported lifecycle");
  });

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
