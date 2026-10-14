import { describe, expect, it } from "vitest";
import {
  parseReviewAgentProfiles,
  selectReviewAgentProfile,
} from "../domain/review-agent-profile";
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
