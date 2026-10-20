import { invalid, ReviewProviderKind } from "./review-run-control-types";
import {
  parseReviewAgentProfiles as parseProfileWire,
  type ReviewAgentProfile,
} from "@reviewrouter/shared";
export type { ReviewAgentProfile } from "@reviewrouter/shared";

/** Execution identity comes from the captured engine, never from provider rows. */
export function reviewAgentExecutionProviderKind(
  profile: ReviewAgentProfile,
): ReviewProviderKind {
  switch (profile.agentKind) {
    case "codex":
      return ReviewProviderKind.Codex;
    case "claude":
      return ReviewProviderKind.ClaudeCode;
    case "ocr":
      return ReviewProviderKind.Ocr;
  }
}
export function parseReviewAgentProfiles(
  value: unknown,
): readonly ReviewAgentProfile[] {
  try {
    return parseProfileWire(value);
  } catch (error) {
    invalid(
      error instanceof Error ? error.message : "review_agent_profile_invalid",
    );
  }
}

export function selectReviewAgentProfile(
  profiles: unknown,
  profileRef: string,
  transport: ReviewAgentProfile["modelTransports"][number],
): ReviewAgentProfile {
  const selected = parseReviewAgentProfiles(profiles).find(
    (profile) => profile.profileRef === profileRef,
  );
  if (!selected || !selected.modelTransports.includes(transport))
    invalid("review_agent_profile_unavailable");
  return selected;
}

/** Matches the Secret-backed runtime's bundled Codex selection contract. */
export function selectProviderApiReviewAgentProfile(
  profiles: unknown,
): ReviewAgentProfile {
  return selectUniqueCodexProfile(profiles, "provider_api");
}

/** Preserve an implicit supplied-diff-only policy without enabling native tools. */
export function selectSuppliedDiffReviewAgentProfile(
  profiles: unknown,
): ReviewAgentProfile {
  return selectUniqueCodexProfile(profiles, "account_gateway");
}

function selectUniqueCodexProfile(
  profiles: unknown,
  transport: ReviewAgentProfile["modelTransports"][number],
): ReviewAgentProfile {
  const candidates = parseReviewAgentProfiles(profiles).filter(
    (profile) =>
      profile.agentKind === "codex" &&
      profile.modelTransports.includes(transport),
  );
  if (candidates.length !== 1) invalid("review_agent_profile_unavailable");
  return candidates[0]!;
}
