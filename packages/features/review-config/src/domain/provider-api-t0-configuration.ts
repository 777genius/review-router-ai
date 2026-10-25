import {
  providerApiDescriptors,
  type ProviderApiAuthMode,
} from "@reviewrouter/shared";
import { providerApiModeForAuthMode } from "@reviewrouter/features-review-providers";
import type { ReviewConfiguration } from "./review-configuration";

export const openRouterDirectPolicyIssue =
  "openrouter_direct_requires_single_provider";

export function isOpenRouterDirectConfiguration(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): boolean {
  // Runtime authentication follows the primary provider. Secondary OpenRouter
  // rows in an existing mixed policy do not turn it into the direct route.
  if (configuration.providers[0]?.authMode !== "openrouter_api_key")
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

/** Exact direct selection. Legacy secondary rows never choose a transport. */
export function providerApiConfigurationMode(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): ProviderApiAuthMode | undefined {
  const mode = providerApiModeForAuthMode(
    configuration.providers[0]?.authMode ?? "",
  );
  if (mode === undefined) return undefined;
  return assertProviderApiDirectConfigurationSupported(configuration);
}
export function isProviderApiDirectConfiguration(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): boolean {
  return providerApiConfigurationMode(configuration) !== undefined;
}
export function assertProviderApiDirectConfigurationSupported(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): ProviderApiAuthMode {
  const provider = configuration.providers[0];
  const mode = providerApiModeForAuthMode(provider?.authMode ?? "");
  const descriptor =
    mode === undefined ? undefined : providerApiDescriptors[mode];
  if (
    mode === "mimo-token-plan-api" &&
    provider &&
    !["low", "medium", "high"].includes(provider.reasoningEffort ?? "")
  )
    throw new Error("provider_api_reasoning_effort_unsupported");
  if (
    !provider ||
    !mode ||
    !descriptor ||
    configuration.providers.length !== 1 ||
    provider.kind !== descriptor.providerKind ||
    configuration.execution.providerLimit !== 1 ||
    configuration.execution.providerMaxParallel !== 1 ||
    configuration.execution.inlineMinAgreement !== 1 ||
    (mode === "openrouter-api"
      ? provider.model.length > 512 ||
        !/^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(
          provider.model,
        )
      : provider.model !== descriptor.defaultModel) ||
    (mode === "kimi-code-api" &&
      (provider.reasoningEffort !== undefined || provider.fastMode))
  ) {
    throw new Error(
      mode === "openrouter-api"
        ? openRouterDirectPolicyIssue
        : "provider_api_direct_requires_single_provider",
    );
  }
  return mode;
}
