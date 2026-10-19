import { describe, expect, it } from "vitest";
import {
  parseReviewAgentProfiles,
  reviewAgentExecutionProviderKind,
  selectReviewAgentProfile,
  selectProviderApiReviewAgentProfile,
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
  it("rejects OCR profiles that claim a context gateway or drop the gateway transport", () => {
    const ocr = {
      ...profile,
      profileRef: "approved-ocr",
      agentKind: "ocr",
      modelTransports: ["account_gateway"],
      contextGateway: false,
    };
    for (const row of [
      { ...ocr, contextGateway: true },
      { ...ocr, modelTransports: ["provider_api"] },
    ])
      expect(() => parseReviewAgentProfiles([row])).toThrow();
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
