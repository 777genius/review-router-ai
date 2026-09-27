import { encryptApiKeyForGitHubSecret } from "@reviewrouter/features-codex-oauth-rotating";
import {
  isProviderApiKeySecretPutOutcomeUnknownError,
  providerApiKeySecretName,
  type ProviderApiKeyErrorReason,
  type ProviderApiKeyProvider,
  type ProviderApiKeyRepositoryResult,
} from "./provider-api-key";
import type {
  ProviderApiKeyErrorClassifier,
  ProviderApiKeyGitHubSecretGatewayPort,
  ProviderApiKeyLockPort,
  ProviderApiKeyRepositoryPort,
  ProviderApiKeyStorageCipherPort,
  ProviderApiKeyStorePort,
} from "./provider-api-key-ports";

export class ProviderApiKeyUnavailableError extends Error {
  constructor() {
    super("stored_api_key_unavailable");
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
    readonly lock: ProviderApiKeyLockPort;
  },
): Promise<{
  readonly providerType: ProviderApiKeyProvider;
  readonly results: readonly ProviderApiKeyRepositoryResult[];
}> {
  const workspaceId = input.workspaceId.trim();
  const providerType = input.providerType;
  const requestedRepositoryIds = [...new Set(input.repositoryIds)];
  const providedApiKey = input.apiKey?.trim();

  return dependencies.lock.withLock(
    `provider-api-key:${workspaceId}:${providerType}`,
    15 * 60 * 1000,
    async () => {
      const connectedRepositoryIds =
        await dependencies.providerApiKeys.findConnectedRepositoryIds({
          workspaceId,
          providerType,
        });
      const candidateRepositoryIds = providedApiKey
        ? [...new Set([...connectedRepositoryIds, ...requestedRepositoryIds])]
        : requestedRepositoryIds;
      const targets =
        await dependencies.providerApiKeyRepositories.findRepositoryTargets({
          workspaceId,
          repositoryIds: candidateRepositoryIds,
        });
      const candidateRepositoryIdSet = new Set(candidateRepositoryIds);
      const allowedTargets = targets.filter((target) =>
        candidateRepositoryIdSet.has(target.repositoryId),
      );
      const targetByRepositoryId = new Map(
        allowedTargets.map((target) => [target.repositoryId, target] as const),
      );
      const deniedResults = candidateRepositoryIds
        .filter((repositoryId) => !targetByRepositoryId.has(repositoryId))
        .map(
          (repositoryId): ProviderApiKeyRepositoryResult => ({
            repositoryId,
            repositoryFullName: repositoryId,
            status: "denied",
            errorReason: "repository_not_allowed",
            errorSummary: sanitizeProviderApiKeyError("repository_not_allowed"),
          }),
        );
      const allowedRepositoryIds = allowedTargets.map(
        (target) => target.repositoryId,
      );
      if (allowedRepositoryIds.length === 0) {
        return { providerType, results: deniedResults };
      }

      let encryptedApiKey: string | undefined;
      let plaintextApiKey: string;
      if (providedApiKey) {
        plaintextApiKey = providedApiKey;
        encryptedApiKey = dependencies.storageCipher.encrypt(providedApiKey);
      } else {
        const storedApiKey =
          await dependencies.providerApiKeys.findEncryptedApiKey({
            workspaceId,
            providerType,
          });
        if (!storedApiKey) throw new ProviderApiKeyUnavailableError();
        try {
          plaintextApiKey = dependencies.storageCipher.decrypt(storedApiKey);
        } catch {
          throw new ProviderApiKeyUnavailableError();
        }
      }

      const session = await dependencies.providerApiKeys.prepareApply({
        workspaceId,
        providerType,
        ...(encryptedApiKey ? { encryptedApiKey } : {}),
        repositoryIds: allowedRepositoryIds,
      });
      const recordResult = async (
        result: ProviderApiKeyRepositoryResult,
      ): Promise<ProviderApiKeyRepositoryResult> => {
        try {
          const recorded =
            await dependencies.providerApiKeys.recordRepositoryResult({
              operationId: session.operationId,
              keyVersion: session.keyVersion,
              result,
            });
          return recorded === "recorded"
            ? result
            : {
                repositoryId: result.repositoryId,
                repositoryFullName: result.repositoryFullName,
                status: "stale",
                keyVersion: session.keyVersion,
              };
        } catch {
          try {
            await dependencies.providerApiKeys.markRepositoryReconciliationNeeded(
              {
                operationId: session.operationId,
                repositoryId: result.repositoryId,
                errorReason: "persistence_failed",
              },
            );
          } catch {}
          return {
            repositoryId: result.repositoryId,
            repositoryFullName: result.repositoryFullName,
            status: "reconciliation_needed",
            errorReason: "persistence_failed",
            errorSummary: sanitizeProviderApiKeyError("persistence_failed"),
            keyVersion: session.keyVersion,
          };
        }
      };
      const results = await mapWithConcurrency(
        session.repositoryIds,
        5,
        async (repositoryId): Promise<ProviderApiKeyRepositoryResult> => {
          const target = targetByRepositoryId.get(repositoryId);
          if (!target) {
            return {
              repositoryId,
              repositoryFullName: repositoryId,
              status: "denied",
              errorReason: "repository_not_allowed",
              errorSummary: sanitizeProviderApiKeyError(
                "repository_not_allowed",
              ),
            };
          }
          let applying = false;
          try {
            applying =
              await dependencies.providerApiKeys.markRepositoryApplying({
                operationId: session.operationId,
                repositoryId,
              });
          } catch {
            return recordResult({
              repositoryId,
              repositoryFullName: target.repositoryFullName,
              status: "reconciliation_needed",
              errorReason: "persistence_failed",
              errorSummary: sanitizeProviderApiKeyError("persistence_failed"),
              keyVersion: session.keyVersion,
            });
          }
          if (!applying) {
            return {
              repositoryId,
              repositoryFullName: target.repositoryFullName,
              status: "stale",
              keyVersion: session.keyVersion,
            };
          }

          let result: ProviderApiKeyRepositoryResult;
          try {
            const publicKey =
              await dependencies.githubSecrets.getRepositoryActionsPublicKey({
                githubInstallationId: target.githubInstallationId,
                githubRepositoryId: target.githubRepositoryId,
                owner: target.owner,
                repo: target.repo,
              });
            const encrypted = await encryptApiKeyForGitHubSecret({
              apiKey: plaintextApiKey,
              githubPublicKeyBase64: publicKey.key,
              githubKeyId: publicKey.keyId,
            });
            await dependencies.githubSecrets.putEncryptedRepositorySecret({
              githubInstallationId: target.githubInstallationId,
              githubRepositoryId: target.githubRepositoryId,
              repositoryFullName: target.repositoryFullName,
              owner: target.owner,
              repo: target.repo,
              secretName: providerApiKeySecretName(providerType),
              encryptedValue: encrypted.encryptedValue,
              keyId: encrypted.keyId,
            });
            result = {
              repositoryId,
              repositoryFullName: target.repositoryFullName,
              status: "applied",
              keyVersion: session.keyVersion,
            };
          } catch (error) {
            const errorReason = dependencies.classifyError(error);
            result = {
              repositoryId,
              repositoryFullName: target.repositoryFullName,
              status: isProviderApiKeySecretPutOutcomeUnknownError(error)
                ? "reconciliation_needed"
                : "failed",
              errorReason,
              errorSummary: sanitizeProviderApiKeyError(errorReason),
              keyVersion: session.keyVersion,
            };
          }

          return recordResult(result);
        },
      );
      return { providerType, results: [...deniedResults, ...results] };
    },
  );
}

export function sanitizeProviderApiKeyError(
  reason: ProviderApiKeyErrorReason,
): string {
  switch (reason) {
    case "repository_not_allowed":
      return "This repository is not allowed for this workspace.";
    case "repository_not_found":
      return "The repository is no longer available.";
    case "repository_not_available_to_github_app":
      return "The GitHub App does not have access to this repository.";
    case "insufficient_permissions":
      return "The GitHub App cannot update this repository secret.";
    case "rate_limited":
      return "GitHub rate limit reached. Try again later.";
    case "github_secret_encryption_failed":
      return "The repository secret could not be encrypted.";
    case "stored_api_key_unavailable":
      return "The saved provider key is unavailable.";
    case "persistence_failed":
      return "The GitHub update needs reconciliation.";
    case "github_request_failed":
    default:
      return "GitHub could not update this repository secret.";
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
