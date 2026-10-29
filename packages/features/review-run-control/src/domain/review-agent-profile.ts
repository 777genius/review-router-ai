import { invalid, ReviewProviderKind } from "./review-run-control-types";
import {
  parseReviewAgentProfiles as parseProfileWire,
  type ReviewAgentProfile,
} from "@reviewrouter/shared";
export type { ReviewAgentProfile } from "@reviewrouter/shared";

/** Read the raw deployment value: an explicit default still disables preference. */
export function readImplicitReviewAgentSelection(raw: string | undefined) {
  const profileRef = raw ?? "ocr-managed-v2";
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(profileRef))
    invalid("review_agent_profile_ref_invalid");
  return Object.freeze({ profileRef, preferSkillsProfile: raw === undefined });
}

/** One selection policy for admission and advisory support reads. */
export function selectReviewRunAgentProfile(
  input: Readonly<{
    profiles: readonly ReviewAgentProfile[];
    modelTransport: ReviewAgentProfile["modelTransports"][number];
    explicitProfileRef?: string;
    suppliedDiffOnly: boolean;
    defaultProfileRef: string;
    preferSkillsProfile: boolean;
    reviewSkillsDelivery: boolean;
  }>,
): ReviewAgentProfile {
  if (input.explicitProfileRef !== undefined)
    return selectReviewAgentProfile(
      input.profiles,
      input.explicitProfileRef,
      input.modelTransport,
    );
  if (input.modelTransport === "provider_api")
    return selectProviderApiReviewAgentProfile(input.profiles, {
      reviewSkillsDelivery: input.reviewSkillsDelivery,
    });
  if (input.suppliedDiffOnly)
    return selectSuppliedDiffReviewAgentProfile(input.profiles);
  if (input.preferSkillsProfile) {
    const supporting = input.profiles.filter(
      (profile) =>
        profile.agentKind === "ocr" &&
        profile.reviewSkillsVersion === 1 &&
        profile.modelTransports.includes(input.modelTransport),
    );
    if (supporting.length > 1) invalid("review_agent_profile_unavailable");
    if (supporting[0]) return supporting[0];
  }
  return selectReviewAgentProfile(
    input.profiles,
    input.defaultProfileRef,
    input.modelTransport,
  );
}

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

/** Capability preference requires a transport that delivers the admitted input.
 * Older Secrets/Hosted callers share provider_api but lack that companion seam. */
export function selectProviderApiReviewAgentProfile(
  profiles: unknown,
  options: Readonly<{ reviewSkillsDelivery?: boolean }> = {},
): ReviewAgentProfile {
  return selectUniqueCodexProfile(
    profiles,
    "provider_api",
    options.reviewSkillsDelivery === true,
  );
}

/** Preserve an implicit supplied-diff-only policy without enabling native tools. */
export function selectSuppliedDiffReviewAgentProfile(
  profiles: unknown,
): ReviewAgentProfile {
  return selectUniqueCodexProfile(profiles, "account_gateway", true);
}

/** One policy selector for V2 admission and installed-runtime readiness. The
 * legacy producer branch keeps its historical selection rules at its caller. */
export function selectModelDispatchReviewAgentProfile(
  input: Readonly<{
    agentProfiles: unknown;
    modelTransport: ReviewAgentProfile["modelTransports"][number];
    preparedRouteDefaultRef: string;
    explicitAgentProfileRef?: string;
    agenticContext: boolean;
    reviewSkillsDelivery: boolean;
  }>,
): ReviewAgentProfile {
  const usesPreparedDefault =
    input.explicitAgentProfileRef === undefined && input.agenticContext;
  const selected =
    input.explicitAgentProfileRef !== undefined
      ? selectReviewAgentProfile(
          input.agentProfiles,
          input.explicitAgentProfileRef,
          input.modelTransport,
        )
      : input.agenticContext
        ? selectReviewAgentProfile(
            input.agentProfiles,
            input.preparedRouteDefaultRef,
            input.modelTransport,
          )
        : input.modelTransport === "provider_api"
          ? selectProviderApiReviewAgentProfile(input.agentProfiles, {
              reviewSkillsDelivery: input.reviewSkillsDelivery,
            })
          : selectSuppliedDiffReviewAgentProfile(input.agentProfiles);
  if (
    (selected.agentKind === "ocr" && !input.agenticContext) ||
    (usesPreparedDefault &&
      (selected.agentKind !== "ocr" || selected.reviewSkillsVersion !== 1)) ||
    (input.reviewSkillsDelivery && selected.reviewSkillsVersion !== 1)
  )
    invalid("review_agent_profile_incompatible");
  return selected;
}

function selectUniqueCodexProfile(
  profiles: unknown,
  transport: ReviewAgentProfile["modelTransports"][number],
  reviewSkillsDelivery: boolean,
): ReviewAgentProfile {
  const candidates = parseReviewAgentProfiles(profiles).filter(
    (profile) =>
      profile.agentKind === "codex" &&
      profile.modelTransports.includes(transport),
  );
  const supporting = candidates.filter(
    (profile) => profile.reviewSkillsVersion === 1,
  );
  const preferred = reviewSkillsDelivery
    ? supporting.length > 0
      ? supporting
      : candidates
    : candidates.filter((profile) => profile.reviewSkillsVersion === undefined);
  if (preferred.length !== 1) invalid("review_agent_profile_unavailable");
  return preferred[0]!;
}
