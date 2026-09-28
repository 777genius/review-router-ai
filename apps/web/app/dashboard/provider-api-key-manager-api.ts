import type {
  ProviderApiKeyProvider,
  ProviderApiKeyRepositoryResult,
  ProviderApiKeyState,
} from "@reviewrouter/features-provider-setup";

export type ProviderKeyRepositorySearchResponse = {
  readonly repositories: readonly {
    readonly id: string;
    readonly fullName: string;
    readonly provider: string;
  }[];
};

export type ApplyProviderApiKeyResponse = {
  readonly providerType: ProviderApiKeyProvider;
  readonly results: readonly ProviderApiKeyRepositoryResult[];
};

export function providerKeyRepositoryQueryKey(workspaceId: string) {
  return ["provider-key-repositories", workspaceId] as const;
}

export function providerApiKeyStateQueryKey(
  workspaceId: string,
  providerType: ProviderApiKeyProvider,
) {
  return ["provider-api-key-state", workspaceId, providerType] as const;
}

export async function fetchProviderKeyRepositories(
  workspaceId: string,
): Promise<ProviderKeyRepositorySearchResponse> {
  const response = await fetch(
    `/api/dashboard/repositories/search?workspace=${encodeURIComponent(workspaceId)}`,
  );
  if (!response.ok) throw new Error("repository_search_failed");
  return response.json();
}

export async function fetchProviderApiKeyState(input: {
  readonly workspaceId: string;
  readonly providerType: ProviderApiKeyProvider;
}): Promise<ProviderApiKeyState> {
  const response = await fetch(
    `/api/dashboard/provider-keys?workspace=${encodeURIComponent(input.workspaceId)}&providerType=${input.providerType}`,
  );
  if (!response.ok) {
    throw new Error(await responseError(response, "provider_key_state_failed"));
  }
  return response.json();
}

export async function applyProviderApiKeyRequest(input: {
  readonly workspaceId: string;
  readonly providerType: ProviderApiKeyProvider;
  readonly apiKey?: string;
  readonly repositoryIds: readonly string[];
}): Promise<ApplyProviderApiKeyResponse> {
  const response = await fetch("/api/dashboard/provider-keys/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: input.workspaceId,
      providerType: input.providerType,
      ...(input.apiKey ? { apiKey: input.apiKey } : {}),
      repositoryIds: input.repositoryIds,
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "provider_key_apply_failed");
  return body;
}

async function responseError(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "string"
    ) {
      return body.error;
    }
  } catch {
    // A non-JSON response uses the stable fallback error code.
  }
  return fallback;
}
