import { encryptApiKeyForGitHubSecret } from "@reviewrouter/features-codex-oauth-rotating";
import {
  providerApiKeySecretName,
  type ProviderApiKeyErrorReason,
  type ProviderApiKeyProvider,
  type ProviderApiKeyRepositoryResult,
} from "./provider-api-key";
import type {
  ProviderApiKeyErrorClassifier,
  ProviderApiKeyGitHubSecretGatewayPort,
  ProviderApiKeyRepositoryPort,
  ProviderApiKeyStorageCipherPort,
  ProviderApiKeyStorePort,
} from "./provider-api-key-ports";

export class ProviderApiKeyUnavailableError extends Error {
  constructor() {
    super("provider_api_key_unavailable");
    this.name = "ProviderApiKeyUnavailableError";
  }
}

export async function applyProviderApiKey(
  input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly apiKey?: string;
    readonly repositoryIds: readonly string[];
  },
  dependencies: {
    readonly providerApiKeys: ProviderApiKeyStorePort;
    readonly providerApiKeyRepositories: ProviderApiKeyRepositoryPort;
    readonly storageCipher: ProviderApiKeyStorageCipherPort;
    readonly githubSecrets: ProviderApiKeyGitHubSecretGatewayPort;
    readonly classifyError: ProviderApiKeyErrorClassifier;
  },
): Promise<{
  readonly providerType: ProviderApiKeyProvider;
  readonly results: readonly ProviderApiKeyRepositoryResult[];
}> {
  const repositoryIds = [...new Set(input.repositoryIds)];
  const apiKey = await resolveApiKey(input, dependencies);
  await dependencies.providerApiKeys.saveEncryptedApiKey({
    workspaceId: input.workspaceId,
    providerType: input.providerType,
    encryptedApiKey: dependencies.storageCipher.encrypt(apiKey),
  });
  const targets =
    await dependencies.providerApiKeyRepositories.findRepositoryTargets({
      workspaceId: input.workspaceId,
      repositoryIds,
    });
  const targetByRepositoryId = new Map(
    targets.map((target) => [target.repositoryId, target] as const),
  );
  const results = await mapWithConcurrency(
    repositoryIds,
    5,
    async (repositoryId): Promise<ProviderApiKeyRepositoryResult> => {
      const target = targetByRepositoryId.get(repositoryId);
      if (!target) {
        return {
          repositoryId,
          repositoryFullName: repositoryId,
          status: "failed",
          errorReason: "repository_not_found",
        };
      }
      try {
        const publicKey =
          await dependencies.githubSecrets.getRepositoryActionsPublicKey({
            githubInstallationId: target.githubInstallationId,
            githubRepositoryId: target.githubRepositoryId,
            owner: target.owner,
            repo: target.repo,
          });
        const encrypted = await encryptApiKeyForGitHubSecret({
          apiKey,
          githubPublicKeyBase64: publicKey.key,
          githubKeyId: publicKey.keyId,
        });
        await dependencies.githubSecrets.putEncryptedRepositorySecret({
          githubInstallationId: target.githubInstallationId,
          githubRepositoryId: target.githubRepositoryId,
          repositoryFullName: target.repositoryFullName,
          owner: target.owner,
          repo: target.repo,
          secretName: providerApiKeySecretName(input.providerType),
          encryptedValue: encrypted.encryptedValue,
          keyId: encrypted.keyId,
        });
        return {
          repositoryId: target.repositoryId,
          repositoryFullName: target.repositoryFullName,
          status: "applied",
        };
      } catch (error) {
        return {
          repositoryId: target.repositoryId,
          repositoryFullName: target.repositoryFullName,
          status: "failed",
          errorReason: dependencies.classifyError(error),
        };
      }
    },
  );
  await dependencies.providerApiKeys.saveRepositoryResults({
    workspaceId: input.workspaceId,
    providerType: input.providerType,
    results,
  });
  return { providerType: input.providerType, results };
}

async function resolveApiKey(
  input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly apiKey?: string;
  },
  dependencies: {
    readonly providerApiKeys: ProviderApiKeyStorePort;
    readonly storageCipher: ProviderApiKeyStorageCipherPort;
  },
): Promise<string> {
  const provided = input.apiKey?.trim();
  if (provided) return provided;
  const encrypted = await dependencies.providerApiKeys.findEncryptedApiKey({
    workspaceId: input.workspaceId,
    providerType: input.providerType,
  });
  if (!encrypted) throw new ProviderApiKeyUnavailableError();
  try {
    return dependencies.storageCipher.decrypt(encrypted);
  } catch {
    throw new ProviderApiKeyUnavailableError();
  }
}

export function classifyProviderApiKeyError(
  error: unknown,
): ProviderApiKeyErrorReason {
  if (
    error instanceof Error &&
    error.message === "github_secret_public_key_invalid"
  ) {
    return "github_secret_encryption_failed";
  }
  const status = githubErrorStatus(error);
  if (status === 404) return "repository_not_found";
  if (isRateLimitError(error, status)) return "rate_limited";
  if (status === 403) return "insufficient_permissions";
  return "github_request_failed";
}

function githubErrorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    readonly status?: unknown;
    readonly statusCode?: unknown;
    readonly response?: { readonly status?: unknown };
  };
  for (const value of [
    candidate.status,
    candidate.statusCode,
    candidate.response?.status,
  ]) {
    if (typeof value === "number") return value;
  }
  return null;
}

function isRateLimitError(error: unknown, status: number | null): boolean {
  if (status === 429) return true;
  if (!error || typeof error !== "object") return false;
  const headers = (
    error as {
      readonly response?: {
        readonly headers?: Record<string, string | number | undefined>;
      };
    }
  ).response?.headers;
  return headers?.["x-ratelimit-remaining"] === "0";
}

async function mapWithConcurrency<Input, Output>(
  values: readonly Input[],
  concurrency: number,
  mapper: (value: Input) => Promise<Output>,
): Promise<Output[]> {
  const output = new Array<Output>(values.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(concurrency, Math.max(values.length, 1)) },
      async () => {
        while (nextIndex < values.length) {
          const currentIndex = nextIndex++;
          const value = values[currentIndex];
          if (value !== undefined) output[currentIndex] = await mapper(value);
        }
      },
    ),
  );
  return output;
}
