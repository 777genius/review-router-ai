import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindModelDispatchReleaseProfile } from "./review-model-dispatch-release-profile.js";

// Independent retained S2 identity, not derived from the binder under test.
const legacyFiles = {
  "review-model-dispatch-contract.ts":
    "c9d91addfd46122d095908c42cf416527d438c374e8bb4f65a333d62bf4b1728",
  "review-model-route-policy.ts":
    "ac13197c14ca384276f96eba7ad85969ff8de47f976f041bd05ef026a5fc829c",
  "review-agent-profile.ts":
    "6da405b0a67d717010f012ba114864a9dc1f69534062a9bb98e4729742ffa190",
};
const generatedFiles = Object.fromEntries(
  Object.keys(legacyFiles).map((name) => [
    name,
    createHash("sha256")
      .update(
        readFileSync(
          new URL(
            `../../packages/protocol-review-action-v2/src/generated/${name}`,
            import.meta.url,
          ),
        ),
      )
      .digest("hex"),
  ]),
);
const agentProfiles = [
  {
    profileRef: "ocr-qualified",
    agentKind: "ocr",
    binarySha256: "a".repeat(64),
    packageVersion: "1.0.0",
    modelTransports: ["account_gateway"],
    contextGateway: false,
    cancellation: true,
    reviewSkillsVersion: 1,
  },
];
const legacyProfile = {
  extensionId: "review-model-dispatch.v2",
  descriptorDigest:
    "sha256:be55241ba86af0788b6a60973ac7c55e6aa33244d18bba52a230cbc195ba4a2d",
  policyVersion: "model-dispatch-policy.v2",
  transports: ["account_gateway"],
  wireProtocols: ["openai-responses"],
  defaultAgentProfileRefs: { account_gateway: "ocr-qualified" },
  limits: {
    maxRequests: 32,
    maxConcurrentRequests: 1,
    maxRequestBytes: 16_777_216,
    maxResponseBytes: 8_388_608,
    maxOutputTokens: 32_768,
  },
};
const capacityProfile = {
  ...legacyProfile,
  descriptorDigest:
    "sha256:d529a458a0d6e6644df1d8e341f42988b5c137920f6883cd1467bfe524e8aadb",
  policyVersion: "model-dispatch-policy.capacity128.v1",
  limits: { ...legacyProfile.limits, maxRequests: 128 },
};

describe("complete policy-bound model dispatch release source tuples", () => {
  it("preserves legacy bytes only for their original policy and 32 allowance", () => {
    expect(
      bindModelDispatchReleaseProfile(legacyProfile, legacyFiles, agentProfiles),
    ).toEqual(legacyProfile);
    expect(() =>
      bindModelDispatchReleaseProfile(capacityProfile, legacyFiles, agentProfiles),
    ).toThrow("no reviewed contract binding");
    expect(() =>
      bindModelDispatchReleaseProfile(
        { ...legacyProfile, limits: capacityProfile.limits },
        legacyFiles,
        agentProfiles,
      ),
    ).toThrow();
  });

  it.each([legacyProfile, capacityProfile])(
    "accepts a known policy only with the complete reviewed new generated tuple: $policyVersion",
    (profile) => {
      expect(
        bindModelDispatchReleaseProfile(profile, generatedFiles, agentProfiles),
      ).toEqual(profile);
    },
  );

  it("rejects legacy/new file mixing rather than independently allowlisting files", () => {
    const differing = (
      Object.keys(legacyFiles) as (keyof typeof legacyFiles)[]
    ).filter((file) => generatedFiles[file] !== legacyFiles[file]);
    expect(differing.length).toBeGreaterThan(1);
    for (const file of differing) {
      expect(() =>
        bindModelDispatchReleaseProfile(
          legacyProfile,
          { ...generatedFiles, [file]: legacyFiles[file] },
          agentProfiles,
        ),
      ).toThrow("no reviewed contract binding");
    }
  });

  it("rejects missing/unknown bytes, unapproved policies and incompatible default agents", () => {
    for (const files of [
      {},
      { ...generatedFiles, "review-agent-profile.ts": "f".repeat(64) },
    ])
      expect(() =>
        bindModelDispatchReleaseProfile(capacityProfile, files, agentProfiles),
      ).toThrow("no reviewed contract binding");
    expect(() =>
      bindModelDispatchReleaseProfile(
        { ...capacityProfile, policyVersion: "unapproved" },
        generatedFiles,
        agentProfiles,
      ),
    ).toThrow();
    expect(() =>
      bindModelDispatchReleaseProfile(capacityProfile, generatedFiles, [
        { ...agentProfiles[0], profileRef: "unselected" },
      ]),
    ).toThrow("default agent is incompatible");
  });
});
