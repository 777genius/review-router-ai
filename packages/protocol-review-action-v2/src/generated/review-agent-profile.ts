// Generated from shared/src/review-agent-profile.ts. Do not edit.
/** Approved toolchain metadata; model providers never select an agent kind. */
export type ReviewAgentProfile = Readonly<{
  profileRef: string;
  agentKind: "codex" | "claude";
  binarySha256: string;
  packageVersion: string;
  modelTransports: readonly ("account_gateway" | "provider_api")[];
  contextGateway: true;
  cancellation: true;
}>;

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
      if (
        (row.agentKind !== "codex" && row.agentKind !== "claude") ||
        row.contextGateway !== true ||
        row.cancellation !== true
      )
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
      refs.add(row.profileRef);
      return Object.freeze({
        profileRef: row.profileRef,
        agentKind: row.agentKind,
        binarySha256: row.binarySha256,
        packageVersion: row.packageVersion,
        modelTransports: Object.freeze([
          ...transports,
        ]) as ReviewAgentProfile["modelTransports"],
        contextGateway: true,
        cancellation: true,
      });
    }),
  );
}

function invalid(code: string): never {
  throw new Error(code);
}
