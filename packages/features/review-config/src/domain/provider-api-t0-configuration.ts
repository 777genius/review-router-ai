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

export type ProviderApiDirectPolicyIssue =
  | typeof openRouterDirectPolicyIssue
  | "provider_api_direct_requires_single_provider"
  | "provider_api_fast_mode_unsupported"
  | "provider_api_reasoning_effort_unsupported";

export type ProviderApiConfigurationUnsupported = Readonly<{
  status: "unsupported";
  reason: ProviderApiDirectPolicyIssue;
}>;

export type ProviderApiConfigurationInspection =
  | Readonly<{ status: "not_selected" }>
  | Readonly<{ status: "supported"; mode: ProviderApiAuthMode }>
  | ProviderApiConfigurationUnsupported;

/** Inspect saved policy without changing it or selecting a legacy fallback. */
export function inspectProviderApiDirectConfiguration(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): ProviderApiConfigurationInspection {
  const provider = configuration.providers[0];
  const mode = providerApiModeForAuthMode(provider?.authMode ?? "");
  if (mode === undefined) return { status: "not_selected" };
  const descriptor = providerApiDescriptors[mode];
  if (mode === "mimo-token-plan-api" && provider?.fastMode)
    return {
      status: "unsupported",
      reason: "provider_api_fast_mode_unsupported",
    };
  if (
    mode === "mimo-token-plan-api" &&
    provider &&
    !["low", "medium", "high"].includes(provider.reasoningEffort ?? "")
  )
    return {
      status: "unsupported",
      reason: "provider_api_reasoning_effort_unsupported",
    };
  if (
    !provider ||
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
    return {
      status: "unsupported",
      reason:
        mode === "openrouter-api"
          ? openRouterDirectPolicyIssue
          : "provider_api_direct_requires_single_provider",
    };
  }
  return { status: "supported", mode };
}

/** Strict operation selector. Reads use the non-throwing inspection above. */
export function providerApiConfigurationMode(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): ProviderApiAuthMode | undefined {
  const selection = inspectProviderApiDirectConfiguration(configuration);
  if (selection.status === "unsupported") throw new Error(selection.reason);
  return selection.status === "supported" ? selection.mode : undefined;
}

/** Save-time validation retains its throwing contract. */
export function isProviderApiDirectConfiguration(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): boolean {
  return providerApiConfigurationMode(configuration) !== undefined;
}

export function assertProviderApiDirectConfigurationSupported(
  configuration: Pick<ReviewConfiguration, "providers" | "execution">,
): ProviderApiAuthMode {
  const selection = inspectProviderApiDirectConfiguration(configuration);
  if (selection.status !== "supported")
    throw new Error(
      selection.status === "unsupported"
        ? selection.reason
        : "provider_api_direct_requires_single_provider",
    );
  return selection.mode;
}
