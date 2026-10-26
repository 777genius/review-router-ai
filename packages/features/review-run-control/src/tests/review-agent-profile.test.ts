import { describe, expect, it } from "vitest";
import {
  parseReviewAgentProfiles,
  reviewAgentExecutionProviderKind,
  selectReviewAgentProfile,
  selectProviderApiReviewAgentProfile,
  selectModelDispatchReviewAgentProfile,
} from "../domain/review-agent-profile";
import { ReviewProviderKind } from "../domain/review-run-control-types";
const profile = {
  profileRef: "approved-codex",
  agentKind: "codex",
  binarySha256: "a".repeat(64),
  packageVersion: "0.159.2",
  modelTransports: ["account_gateway"],
  contextGateway: true,
  cancellation: true,
};
describe("approved producer agent profiles", () => {
  it("uses the exact trusted OCR default and preserves an explicit historical profile", () => {
    const legacy = { ...profile, reviewSkillsVersion: 1 };
    const ocr = {
      ...legacy,
      profileRef: "ocr-new",
      agentKind: "ocr",
      contextGateway: false,
    };
    const policy = {
      agentProfiles: [legacy, ocr],
      modelTransport: "account_gateway" as const,
      preparedRouteDefaultRef: ocr.profileRef,
      agenticContext: true,
      reviewSkillsDelivery: false,
    };
    expect(selectModelDispatchReviewAgentProfile(policy)).toEqual(ocr);
    expect(
      selectModelDispatchReviewAgentProfile({
        ...policy,
        explicitAgentProfileRef: legacy.profileRef,
      }),
    ).toEqual(legacy);
    expect(
      selectModelDispatchReviewAgentProfile({
        ...policy,
        agenticContext: false,
      }),
    ).toEqual(legacy);
    expect(() =>
      selectModelDispatchReviewAgentProfile({
        ...policy,
        explicitAgentProfileRef: "missing",
      }),
    ).toThrow("review_agent_profile_unavailable");
    expect(() =>
      selectModelDispatchReviewAgentProfile({
        ...policy,
        preparedRouteDefaultRef: legacy.profileRef,
      }),
    ).toThrow("review_agent_profile_incompatible");
    expect(() =>
      selectModelDispatchReviewAgentProfile({
        ...policy,
        explicitAgentProfileRef: ocr.profileRef,
        agenticContext: false,
      }),
    ).toThrow("review_agent_profile_incompatible");
  });

  it("requires captured-input delivery on new direct defaults and preserves supplied-diff selection", () => {
    const legacy = {
      ...profile,
      modelTransports: ["provider_api"],
      reviewSkillsVersion: 1,
    };
    const ocr = {
      ...legacy,
      profileRef: "ocr-direct",
      agentKind: "ocr",
      contextGateway: false,
    };
    const policy = {
      agentProfiles: [legacy, ocr],
      modelTransport: "provider_api" as const,
      preparedRouteDefaultRef: ocr.profileRef,
      agenticContext: true,
      reviewSkillsDelivery: true,
    };
    expect(selectModelDispatchReviewAgentProfile(policy)).toEqual(ocr);
    expect(
      selectModelDispatchReviewAgentProfile({
        ...policy,
        agenticContext: false,
      }),
    ).toEqual(legacy);
    expect(() =>
      selectModelDispatchReviewAgentProfile({
        ...policy,
        agentProfiles: [{ ...ocr, reviewSkillsVersion: undefined }],
      }),
    ).toThrow();
  });

  it("prefers the unique registered Skills producer while explicit legacy refs stay exact", () => {
    const legacy = {
      ...profile,
      modelTransports: ["provider_api", "account_gateway"],
    };
    const supporting = {
      ...legacy,
      profileRef: "codex-skills-v1",
      reviewSkillsVersion: 1,
    };
    expect(
      selectProviderApiReviewAgentProfile([legacy, supporting], {
        reviewSkillsDelivery: true,
      }),
    ).toEqual(supporting);
    expect(
      selectReviewAgentProfile(
        [legacy, supporting],
        legacy.profileRef,
        "account_gateway",
      ),
    ).toEqual(legacy);
    expect(() =>
      selectProviderApiReviewAgentProfile(
        [legacy, supporting, { ...supporting, profileRef: "other-skills" }],
        { reviewSkillsDelivery: true },
      ),
    ).toThrow("review_agent_profile_unavailable");
  });
  it("keeps provider API callers without captured-input delivery on a unique legacy profile", () => {
    const legacy = {
      ...profile,
      modelTransports: ["provider_api", "account_gateway"],
    };
    const supporting = {
      ...legacy,
      profileRef: "codex-skills-v1",
      reviewSkillsVersion: 1,
    };
    expect(selectProviderApiReviewAgentProfile([legacy, supporting])).toEqual(
      legacy,
    );
    expect(
      selectProviderApiReviewAgentProfile([legacy, supporting], {
        reviewSkillsDelivery: false,
      }),
    ).toEqual(legacy);
    expect(() => selectProviderApiReviewAgentProfile([supporting])).toThrow(
      "review_agent_profile_unavailable",
    );
    expect(() =>
      selectProviderApiReviewAgentProfile([
        legacy,
        { ...legacy, profileRef: "another-legacy" },
        supporting,
      ]),
    ).toThrow("review_agent_profile_unavailable");
  });
  it("accepts exactly the reference grammar supported by the runtime", () => {
    expect(
      parseReviewAgentProfiles([{ ...profile, profileRef: "a".repeat(160) }])[0]
        ?.profileRef,
    ).toHaveLength(160);
    for (const profileRef of [
      "a".repeat(161),
      "with/slash",
      " trailing",
      "-prefix",
      "",
    ])
      expect(() =>
        parseReviewAgentProfiles([{ ...profile, profileRef }]),
      ).toThrow();
  });
  it("selects the explicit agent independently of model-provider names", () => {
    const claude = {
      ...profile,
      profileRef: "approved-claude",
      agentKind: "claude",
    };
    expect(
      selectReviewAgentProfile(
        [profile, claude],
        "approved-claude",
        "account_gateway",
      ).agentKind,
    ).toBe("claude");
  });
  it("keeps the unique Secrets Codex independent of the explicit Gateway agent", () => {
    const codex = {
      ...profile,
      modelTransports: ["provider_api", "account_gateway"],
    };
    const claude = {
      ...codex,
      profileRef: "approved-claude",
      agentKind: "claude",
    };
    const profiles = [
      { ...profile, profileRef: "gateway-only-codex" },
      claude,
      codex,
    ];
    expect(
      selectReviewAgentProfile(profiles, claude.profileRef, "account_gateway"),
    ).toEqual(claude);
    expect(selectProviderApiReviewAgentProfile(profiles)).toEqual(codex);
  });
  it("rejects missing or ambiguous Secrets Codex profiles without fallback", () => {
    const codex = { ...profile, modelTransports: ["provider_api"] };
    const claude = {
      ...codex,
      profileRef: "approved-claude",
      agentKind: "claude",
    };
    for (const profiles of [
      [claude],
      [profile, claude],
      [codex, { ...codex, profileRef: "second-codex" }, claude],
    ])
      expect(() => selectProviderApiReviewAgentProfile(profiles)).toThrow(
        "review_agent_profile_unavailable",
      );
    // A valid matching row never bypasses validation of the approved bundle.
    expect(() =>
      selectProviderApiReviewAgentProfile([
        codex,
        { ...claude, cancellation: false },
      ]),
    ).toThrow();
  });
  it("rejects unknown profiles and unsupported transports without fallback", () => {
    expect(() =>
      selectReviewAgentProfile([profile], "missing", "account_gateway"),
    ).toThrow();
    expect(() =>
      selectReviewAgentProfile([profile], profile.profileRef, "provider_api"),
    ).toThrow();
  });
  it("rejects commands, duplicate refs, missing cancellation and unqualified hashes", () => {
    for (const row of [
      { ...profile, command: "arbitrary" },
      { ...profile, cancellation: false },
      { ...profile, binarySha256: "unknown" },
    ])
      expect(() => parseReviewAgentProfiles([row])).toThrow();
    expect(() => parseReviewAgentProfiles([profile, profile])).toThrow();
  });
  it("accepts the approved OCR profile with a real false context gateway", () => {
    const ocr = {
      ...profile,
      profileRef: "approved-ocr",
      agentKind: "ocr",
      modelTransports: ["account_gateway"],
      contextGateway: false,
    };
    const selected = selectReviewAgentProfile(
      [ocr],
      ocr.profileRef,
      "account_gateway",
    );
    expect(selected).toMatchObject({
      profileRef: "approved-ocr",
      agentKind: "ocr",
      contextGateway: false,
      cancellation: true,
      modelTransports: ["account_gateway"],
    });
    expect(reviewAgentExecutionProviderKind(selected)).toBe(
      ReviewProviderKind.Ocr,
    );
  });
  it("accepts registered direct OCR transports without granting a context gateway", () => {
    const ocr = {
      ...profile,
      profileRef: "approved-ocr",
      agentKind: "ocr",
      modelTransports: ["account_gateway"],
      contextGateway: false,
    };
    for (const row of [
      { ...ocr, contextGateway: true },
      { ...ocr, cancellation: false },
      { ...ocr, modelTransports: ["arbitrary"] },
    ])
      expect(() => parseReviewAgentProfiles([row])).toThrow();
    for (const modelTransports of [
      ["provider_api"],
      ["account_gateway", "provider_api"],
      ["provider_api", "account_gateway"],
    ])
      expect(
        parseReviewAgentProfiles([{ ...ocr, modelTransports }])[0]
          ?.modelTransports,
      ).toEqual(modelTransports);
  });
  it("keeps codex and claude bound to the context gateway contract", () => {
    for (const agentKind of ["codex", "claude"] as const) {
      const accepted = parseReviewAgentProfiles([
        { ...profile, profileRef: `approved-${agentKind}`, agentKind },
      ])[0];
      expect(accepted).toMatchObject({
        agentKind,
        contextGateway: true,
      });
      expect(reviewAgentExecutionProviderKind(accepted!)).toBe(
        agentKind === "codex"
          ? ReviewProviderKind.Codex
          : ReviewProviderKind.ClaudeCode,
      );
      expect(() =>
        parseReviewAgentProfiles([
          {
            ...profile,
            profileRef: `rejected-${agentKind}`,
            agentKind,
            contextGateway: false,
          },
        ]),
      ).toThrow();
    }
  });
  it("detaches and freezes the approved definition", () => {
    const input = { ...profile, modelTransports: [...profile.modelTransports] };
    const selected = selectReviewAgentProfile(
      [input],
      input.profileRef,
      "account_gateway",
    );
    input.modelTransports.push("provider_api");
    expect(selected.modelTransports).toEqual(["account_gateway"]);
    expect(Object.isFrozen(selected)).toBe(true);
  });
});
