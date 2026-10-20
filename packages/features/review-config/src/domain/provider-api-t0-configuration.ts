import type { ReviewConfiguration } from "./review-configuration";

export const openRouterDirectPolicyIssue =
  "openrouter_direct_requires_single_provider";

export function isOpenRouterDirectConfiguration(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): boolean {
  if (
    !configuration.providers.some((provider) => provider.kind === "openrouter")
  )
    return false;
  assertOpenRouterDirectConfigurationSupported(configuration);
  return true;
}

/** A finite native-engine route; never reduce a saved multi-provider policy. */
export function assertOpenRouterDirectConfigurationSupported(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): void {
  const provider = configuration.providers[0];
  if (
    configuration.providers.length !== 1 ||
    provider?.kind !== "openrouter" ||
    provider.authMode !== "openrouter_api_key" ||
    provider.model.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(
      provider.model,
    ) ||
    configuration.execution.providerLimit !== 1 ||
    configuration.execution.providerMaxParallel !== 1 ||
    configuration.execution.inlineMinAgreement !== 1
  ) {
    throw new Error(openRouterDirectPolicyIssue);
  }
}
