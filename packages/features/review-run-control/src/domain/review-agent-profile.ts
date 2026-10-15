import { invalid } from "./review-run-control-types";
import {
  parseReviewAgentProfiles as parseProfileWire,
  type ReviewAgentProfile,
} from "@reviewrouter/shared";
export type { ReviewAgentProfile } from "@reviewrouter/shared";
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
