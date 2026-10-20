import type {
  ReviewAgentProfile,
  TrustedProducerReleaseAttestation,
} from "@reviewrouter/features-review-run-control";
import { readConfiguredProducerReleaseAttestations } from "@reviewrouter/features-review-run-control/composition";

/**
 * Deployment gate for offering OCR engine profiles in the Account Gateway
 * provider editor. A registered OCR producer release alone must not advertise
 * the engine for user selection; the rollout explicitly enables selection.
 */
export const reviewOcrProfileSelectionEnv =
  "REVIEW_ROUTER_REVIEW_V2_OCR_PROFILE_SELECTION_ENABLED";

export type GatewayAgentProfileOption = {
  readonly profileRef: string;
  readonly agentKind: ReviewAgentProfile["agentKind"];
  readonly label: string;
  readonly description: string;
};

/** Write validation uses all approved definitions, including hidden old releases.
 * Offering a choice and knowing its native-context capability are distinct rules.
 */
export function loadApprovedGatewayAgentProfiles(input?: {
  readonly env?: Readonly<Record<string, string | undefined>>;
}): readonly ReviewAgentProfile[] {
  return readConfiguredProducerReleaseAttestations(input?.env ?? process.env)
    .flatMap((release) => release.agentProfiles ?? [])
    .filter((profile) => profile.modelTransports.includes("account_gateway"));
}

/**
 * Approved engine profiles offered on the Account Gateway provider row. The
 * list is derived from the producer-release approved profile authority (the
 * same parseReviewAgentProfiles the runtime capture resolves against); the
 * component never keeps its own list of engine names.
 *
 * Capture resolves an explicit agentProfileRef ONLY against the run's exact
 * producer release's approved profiles (selectReviewAgentProfile), so an
 * option may be offered only when every configured producer release that can
 * reach profile resolution accepts the ref identically: same agentKind and
 * the account_gateway transport on the exact first ref match. Aggregating
 * across attestations with a profileRef dedupe would offer refs some
 * producers cannot resolve (those runs answer agent_profile_unavailable) and
 * could hide an agentKind disagreement the per-kind agentic-context save rule
 * depends on. Releases without approved profiles bail out of capture before
 * any ref resolution, so they do not constrain the list.
 */
export function gatewayAgentProfileOptions(input: {
  readonly attestations: readonly TrustedProducerReleaseAttestation[];
  readonly ocrSelectionEnabled: boolean;
}): readonly GatewayAgentProfileOption[] {
  const authorities = input.attestations
    .map((attestation) => attestation.agentProfiles ?? null)
    .filter(
      (profiles): profiles is readonly ReviewAgentProfile[] =>
        profiles !== null,
    );
  const options = new Map<string, GatewayAgentProfileOption>();
  for (const profiles of authorities) {
    for (const profile of profiles) {
      if (options.has(profile.profileRef)) continue;
      if (profile.agentKind === "ocr" && !input.ocrSelectionEnabled) continue;
      if (!everyProducerResolves(authorities, profile)) continue;
      options.set(profile.profileRef, agentProfileOption(profile));
    }
  }
  return [...options.values()];
}

function everyProducerResolves(
  authorities: readonly (readonly ReviewAgentProfile[])[],
  profile: ReviewAgentProfile,
): boolean {
  for (const authority of authorities) {
    // Capture matches the exact producer's first profileRef entry and then
    // requires the model transport on that entry.
    const match = authority.find(
      (candidate) => candidate.profileRef === profile.profileRef,
    );
    if (match === undefined) return false;
    if (!match.modelTransports.includes("account_gateway")) return false;
    if (match.agentKind !== profile.agentKind) return false;
  }
  return true;
}

export function loadGatewayAgentProfileOptions(input?: {
  readonly env?: Readonly<Record<string, string | undefined>>;
}): readonly GatewayAgentProfileOption[] {
  const env = input?.env ?? process.env;
  let attestations: readonly TrustedProducerReleaseAttestation[];
  try {
    attestations = readConfiguredProducerReleaseAttestations(env);
  } catch {
    // No configured release registry means no approved profiles to offer and
    // (critically) no OCR advertisement.
    return [];
  }
  return gatewayAgentProfileOptions({
    attestations,
    ocrSelectionEnabled: env[reviewOcrProfileSelectionEnv] === "1",
  });
}

function agentProfileOption(
  profile: ReviewAgentProfile,
): GatewayAgentProfileOption {
  return {
    profileRef: profile.profileRef,
    agentKind: profile.agentKind,
    label: profile.profileRef,
    description: agentProfileDescription(profile.agentKind),
  };
}

function agentProfileDescription(
  agentKind: ReviewAgentProfile["agentKind"],
): string {
  switch (agentKind) {
    case "codex":
      return "Approved Codex agent profile.";
    case "claude":
      return "Approved Claude Code agent profile.";
    case "ocr":
      return "Approved OpenCodeReview agent profile (native context tools).";
  }
}
