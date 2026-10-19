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

/**
 * Approved engine profiles offered on the Account Gateway provider row. The
 * list is derived from the producer-release approved profile authority (the
 * same parseReviewAgentProfiles the runtime capture resolves against); the
 * component never keeps its own list of engine names.
 */
export function gatewayAgentProfileOptions(input: {
  readonly attestations: readonly TrustedProducerReleaseAttestation[];
  readonly ocrSelectionEnabled: boolean;
}): readonly GatewayAgentProfileOption[] {
  const options = new Map<string, GatewayAgentProfileOption>();
  for (const attestation of input.attestations) {
    for (const profile of attestation.agentProfiles ?? []) {
      // The Account Gateway row selects a profile for the account_gateway
      // model transport only; anything else cannot resolve at capture time.
      if (!profile.modelTransports.includes("account_gateway")) continue;
      if (profile.agentKind === "ocr" && !input.ocrSelectionEnabled) continue;
      if (options.has(profile.profileRef)) continue;
      options.set(profile.profileRef, agentProfileOption(profile));
    }
  }
  return [...options.values()];
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
