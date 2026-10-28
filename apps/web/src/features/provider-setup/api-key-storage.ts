import {
  apiKeyProviderForAuthMode,
  type ApiKeyProviderId,
  type ProviderAuthMode,
} from "@reviewrouter/features-review-providers";
import type { ProviderCredentialKind } from "@reviewrouter/features-review-config/workspace-provider-profile";
import type { AccountProfileView } from "../../server/account-gateway-accounts";
import {
  apiKeyProviderForGatewayProfile,
  setupProviders,
  type SetupProviderId,
} from "./setup-provider";
export { apiKeyProviderForGatewayProfile } from "./setup-provider";

export type ApiKeyStorage = "github_secrets" | "reviewrouter";

export const apiKeyStorageOptions = [
  {
    value: "reviewrouter",
    label: "ReviewRouter",
    description: "Store the key encrypted and reuse it across repositories.",
  },
  {
    value: "github_secrets",
    label: "GitHub Secrets",
    description: "Add the key to each repository on GitHub.",
  },
] as const;

export function apiKeyStorageLabel(
  kind: ProviderCredentialKind,
): string | null {
  if (kind === "gateway_binding") return "ReviewRouter";
  if (kind === "user_ci_secret" || kind === "repository_rotating")
    return "GitHub Secrets";
  if (kind === "managed_api_key")
    return "GitHub Secrets · managed by ReviewRouter";
  return null;
}

export function apiKeyProviderForCredential(input: {
  authMode: ProviderAuthMode;
  profile?: AccountProfileView | undefined;
}): ApiKeyProviderId | undefined {
  return input.authMode === "codex_account_gateway"
    ? apiKeyProviderForGatewayProfile(input.profile)
    : apiKeyProviderForAuthMode(input.authMode);
}

export type ApiKeySetupIntent = Readonly<{
  provider: SetupProviderId;
  storage: ApiKeyStorage;
  workspaceId: string;
  repositoryIds: readonly string[];
}>;

const intentKeys = [
  "keyProvider",
  "keyStorage",
  "keyWorkspace",
  "keyRepository",
] as const;
const reference = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/;

/** Navigation hints only. Destination reads and every write reauthorize scope. */
export function readApiKeySetupIntent(
  params: Record<string, string | string[] | undefined>,
  workspaceId: string,
): ApiKeySetupIntent | null {
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const provider = setupProviders.find(
    (row) => row.id === one("keyProvider"),
  )?.id;
  const storage = one("keyStorage");
  const raw = params.keyRepository;
  const repositoryIds =
    raw === undefined ? [] : typeof raw === "string" ? [raw] : raw;
  if (
    !provider ||
    (storage !== "github_secrets" && storage !== "reviewrouter") ||
    one("keyWorkspace") !== workspaceId ||
    repositoryIds.length > 100 ||
    repositoryIds.some((id) => !reference.test(id)) ||
    new Set(repositoryIds).size !== repositoryIds.length
  )
    return null;
  return { provider, storage, workspaceId, repositoryIds };
}

export function apiKeySetupHref(
  destination: "accounts" | "providers",
  intent: ApiKeySetupIntent,
): string {
  const query = new URLSearchParams({
    workspace: intent.workspaceId,
    keyProvider: intent.provider,
    keyStorage: intent.storage,
    keyWorkspace: intent.workspaceId,
  });
  if (destination === "providers") query.set("section", "providers");
  for (const id of intent.repositoryIds) query.append("keyRepository", id);
  return `${destination === "accounts" ? "/dashboard/setup" : "/dashboard"}?${query}`;
}

export function consumeApiKeySetupIntent(): void {
  const url = new URL(window.location.href);
  for (const key of intentKeys) url.searchParams.delete(key);
  window.history.replaceState(
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`,
  );
}
