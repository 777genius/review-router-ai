import {
  providerApiDescriptors,
  type ProviderApiAuthMode,
} from "@reviewrouter/shared";
import type { ProviderAuthMode } from "../../domain/provider-catalog";

export type ApiKeyProviderId = "openrouter" | "mimo" | "kimi";
const modes = {
  openrouter: "openrouter-api",
  mimo: "mimo-token-plan-api",
  kimi: "kimi-code-api",
} as const satisfies Record<ApiKeyProviderId, ProviderApiAuthMode>;
const labels = {
  openrouter: "OpenRouter",
  mimo: "MiMo Token Plan",
  kimi: "Kimi Code",
} as const;
export function getApiKeyProvider(id: ApiKeyProviderId) {
  const descriptor = providerApiDescriptors[modes[id]];
  return {
    id,
    label: labels[id],
    directAuthMode: descriptor.authMode,
    directProviderKind: descriptor.providerKind,
    gatewayUpstreamProvider: id,
    defaultModel: descriptor.defaultModel,
  } as const;
}
export const apiKeyProviders = Object.freeze(
  (["openrouter", "mimo", "kimi"] as const).map(getApiKeyProvider),
);
export function apiKeyProviderForAuthMode(
  authMode: ProviderAuthMode,
): ApiKeyProviderId | undefined {
  return apiKeyProviders.find(
    (provider) => provider.directAuthMode === authMode,
  )?.id;
}
export function providerApiModeForAuthMode(
  authMode: string,
): ProviderApiAuthMode | undefined {
  return (Object.keys(providerApiDescriptors) as ProviderApiAuthMode[]).find(
    (mode) => providerApiDescriptors[mode].authMode === authMode,
  );
}
