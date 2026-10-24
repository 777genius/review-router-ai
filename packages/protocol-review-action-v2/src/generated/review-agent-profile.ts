// Generated from shared/src/review-agent-profile.ts. Do not edit.
/** Approved toolchain metadata; model providers never select an agent kind. */
type ReviewAgentProfileCommon = Readonly<{
  profileRef: string;
  binarySha256: string;
  packageVersion: string;
  modelTransports: readonly ("account_gateway" | "provider_api")[];
  cancellation: true;
  /** Registered immutable producer capability; absence preserves historical profiles. */
  reviewSkillsVersion?: 1;
}>;

/** Correlated union keyed by agentKind; seven legacy keys plus an explicit capability. */
export type ReviewAgentProfile = Readonly<
  | (ReviewAgentProfileCommon & {
      agentKind: "codex";
      contextGateway: true;
    })
  | (ReviewAgentProfileCommon & {
      agentKind: "claude";
      contextGateway: true;
    })
  | (ReviewAgentProfileCommon & {
      agentKind: "ocr";
      contextGateway: false;
    })
>;

export function parseReviewAgentProfiles(
  value: unknown,
): readonly ReviewAgentProfile[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 16)
    invalid("review_agent_profiles_invalid");
  const refs = new Set<string>();
  return Object.freeze(
    value.map((item: unknown) => {
      if (!item || typeof item !== "object" || Array.isArray(item))
        invalid("review_agent_profile_invalid");
      const row = item as Record<string, unknown>;
      const names = [
        "profileRef",
        "agentKind",
        "binarySha256",
        "packageVersion",
        "modelTransports",
        "contextGateway",
        "cancellation",
      ];
      if (Object.hasOwn(row, "reviewSkillsVersion")) {
        if (row.reviewSkillsVersion !== 1)
          invalid("review_agent_skills_capability_invalid");
        names.push("reviewSkillsVersion");
      }
      if (
        Object.keys(row).length !== names.length ||
        names.some((name) => !Object.hasOwn(row, name))
      )
        invalid("review_agent_profile_invalid");
      if (
        typeof row.profileRef !== "string" ||
        typeof row.binarySha256 !== "string" ||
        typeof row.packageVersion !== "string"
      )
        invalid("review_agent_profile_invalid");
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(row.profileRef))
        invalid("review_agent_profile_ref_invalid");
      if (!/^[a-f0-9]{64}$/.test(row.binarySha256))
        invalid("review_agent_binary_sha256_invalid");
      if (
        !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(
          row.packageVersion,
        ) ||
        refs.has(row.profileRef)
      )
        invalid("review_agent_profile_invalid");
      const agentKind = row.agentKind;
      if (
        agentKind !== "codex" &&
        agentKind !== "claude" &&
        agentKind !== "ocr"
      )
        invalid("review_agent_profile_capabilities_invalid");
      // codex/claude keep the current contextGateway=true contract; OCR talks
      // to native Git context and returns the real false, never an attestation.
      const contextGateway = agentKind === "ocr" ? false : true;
      if (row.contextGateway !== contextGateway || row.cancellation !== true)
        invalid("review_agent_profile_capabilities_invalid");
      const transports = row.modelTransports;
      if (
        !Array.isArray(transports) ||
        transports.length < 1 ||
        transports.length > 2 ||
        new Set(transports).size !== transports.length ||
        transports.some((t) => t !== "account_gateway" && t !== "provider_api")
      )
        invalid("review_agent_profile_transport_invalid");
      // OCR speaks only through the Account Gateway transport.
      if (
        agentKind === "ocr" &&
        (transports.length !== 1 || transports[0] !== "account_gateway")
      )
        invalid("review_agent_profile_transport_invalid");
      refs.add(row.profileRef);
      return Object.freeze({
        profileRef: row.profileRef,
        agentKind,
        binarySha256: row.binarySha256,
        packageVersion: row.packageVersion,
        modelTransports: Object.freeze([
          ...transports,
        ]) as ReviewAgentProfile["modelTransports"],
        contextGateway,
        cancellation: true,
        ...(row.reviewSkillsVersion === 1
          ? { reviewSkillsVersion: 1 as const }
          : {}),
      } as ReviewAgentProfile);
    }),
  );
}

function invalid(code: string): never {
  throw new Error(code);
}
