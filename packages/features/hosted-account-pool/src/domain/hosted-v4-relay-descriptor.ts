/** Immutable v1 contract identities. The API regression compares these to the
 * generated protocol constants so a future contract change cannot drift. */
export const hostedV4DescriptorExtensionIdentities = Object.freeze({
  shadow: Object.freeze({
    extensionId: "review-investigation-shadow.v1",
    schemaDigest:
      "9ab22a39cc983b88ae50576ece6a777d72d904d09654d3f4c51a20fc13c29003",
    canonicalizerDigest:
      "20dc769dd28947fe6ee0c7770199fbb6c5cd490a7d7f71785159da99d793ff77",
  }),
  relay: Object.freeze({
    extensionId: "review-investigation-hosted-relay.v1",
    schemaDigest:
      "a3a84ea23a3e6ab72e6c455cd0e5f192f05ad1ec97f8456cbda4ff47e793ab11",
    canonicalizerDigest:
      "8ab48c59e135e5f20bb79b1b37e507ae3f529958b9ec90dd6f735ad6d7077e62",
  }),
});

type Provider = Readonly<{
  providerKind: "codex" | "claude_code";
  capabilities: readonly string[];
}>;
export type InvestigationAuthorizationDescriptor = Readonly<{
  authorizationDescriptorVersion: 3;
  capability: "review_investigation_v1";
  coverageProfileHash: string;
  extensionCanonicalizerDigest: string;
  extensionId: string;
  extensionSchemaDigest: string;
  policyHash: string;
  providerCapabilities: readonly Provider[];
  hostedRelayExtension?: Readonly<{
    capability: "hosted_relay_turn_v1";
    extensionCanonicalizerDigest: string;
    extensionId: string;
    extensionSchemaDigest: string;
  }>;
}>;

const dependencies: Readonly<Record<string, readonly string[]>> = {
  context_critic: ["shadow"],
  cross_revision_replay: ["shadow"],
  production_effects: ["context_critic", "shadow"],
  recording: [],
  shadow: ["recording"],
  verified_clean: ["context_critic", "production_effects"],
};
const sha256 = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).sort().join(",") === [...keys].sort().join(",");
const sorted = (values: readonly string[]) =>
  values.every((value, index) => index === 0 || values[index - 1]! < value);

/** The immutable negotiated v1 descriptor, shared by API and durable admission. */
export function parseInvestigationAuthorizationDescriptor(
  value: unknown,
): InvestigationAuthorizationDescriptor | null {
  if (!record(value)) return null;
  const combined = Object.hasOwn(value, "hostedRelayExtension");
  if (
    !exact(value, [
      "authorizationDescriptorVersion",
      "capability",
      "coverageProfileHash",
      "extensionCanonicalizerDigest",
      "extensionId",
      "extensionSchemaDigest",
      "policyHash",
      "providerCapabilities",
      ...(combined ? ["hostedRelayExtension"] : []),
    ]) ||
    value.authorizationDescriptorVersion !== 3 ||
    value.capability !== "review_investigation_v1" ||
    !sha256(value.coverageProfileHash) ||
    !sha256(value.policyHash) ||
    value.extensionId !==
      hostedV4DescriptorExtensionIdentities.shadow.extensionId ||
    value.extensionSchemaDigest !==
      hostedV4DescriptorExtensionIdentities.shadow.schemaDigest ||
    value.extensionCanonicalizerDigest !==
      hostedV4DescriptorExtensionIdentities.shadow.canonicalizerDigest ||
    !Array.isArray(value.providerCapabilities) ||
    value.providerCapabilities.length < 1 ||
    value.providerCapabilities.length > 2
  )
    return null;

  const kinds: string[] = [];
  for (const provider of value.providerCapabilities) {
    if (
      !record(provider) ||
      !exact(provider, ["capabilities", "providerKind"]) ||
      (provider.providerKind !== "codex" &&
        provider.providerKind !== "claude_code") ||
      !Array.isArray(provider.capabilities) ||
      provider.capabilities.length < 1 ||
      provider.capabilities.length > 6 ||
      provider.capabilities.some(
        (capability) =>
          typeof capability !== "string" ||
          !Object.hasOwn(dependencies, capability),
      ) ||
      !sorted(provider.capabilities) ||
      !provider.capabilities.includes("recording") ||
      provider.capabilities.some((capability: string) =>
        dependencies[capability]!.some(
          (dependency) =>
            !(provider.capabilities as string[]).includes(dependency),
        ),
      )
    )
      return null;
    kinds.push(provider.providerKind);
  }
  if (!sorted(kinds)) return null;
  if (combined) {
    const relay = value.hostedRelayExtension;
    if (
      !record(relay) ||
      !exact(relay, [
        "capability",
        "extensionCanonicalizerDigest",
        "extensionId",
        "extensionSchemaDigest",
      ]) ||
      relay.capability !== "hosted_relay_turn_v1" ||
      relay.extensionId !==
        hostedV4DescriptorExtensionIdentities.relay.extensionId ||
      relay.extensionSchemaDigest !==
        hostedV4DescriptorExtensionIdentities.relay.schemaDigest ||
      relay.extensionCanonicalizerDigest !==
        hostedV4DescriptorExtensionIdentities.relay.canonicalizerDigest ||
      !value.providerCapabilities.some(
        (provider) =>
          provider.providerKind === "codex" &&
          provider.capabilities.includes("recording"),
      )
    )
      return null;
  }
  return value as InvestigationAuthorizationDescriptor;
}

export function parseInvestigationAuthorizationDescriptorJson(
  canonical: string | null | undefined,
): InvestigationAuthorizationDescriptor | null {
  if (!canonical) return null;
  try {
    const parsed: unknown = JSON.parse(canonical);
    return canonicalJson(parsed) === canonical
      ? parseInvestigationAuthorizationDescriptor(parsed)
      : null;
  } catch {
    return null;
  }
}

// Matches the run authorization snapshot's recursively sorted JSON encoding.
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (record(value))
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "";
}
