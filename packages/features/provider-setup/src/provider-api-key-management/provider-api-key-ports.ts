import type {
  ProviderApiKeyErrorReason,
  ProviderApiKeyProvider,
  ProviderApiKeyRepositoryResult,
  ProviderApiKeyState,
} from "./provider-api-key";

export type ProviderApiKeyRepositoryTarget = {
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly githubInstallationId: string;
  readonly githubRepositoryId: string;
  readonly owner: string;
  readonly repo: string;
};

export interface ProviderApiKeyRepositoryPort {
  findRepositoryTargets(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }): Promise<readonly ProviderApiKeyRepositoryTarget[]>;
}

export interface ProviderApiKeyStorePort {
  findEncryptedApiKey(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<string | null>;
  saveEncryptedApiKey(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly encryptedApiKey: string;
  }): Promise<void>;
  saveRepositoryResults(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly results: readonly ProviderApiKeyRepositoryResult[];
  }): Promise<void>;
  findState(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<ProviderApiKeyState>;
}

export interface ProviderApiKeyStorageCipherPort {
  encrypt(plaintext: string): string;
  decrypt(payload: string): string;
}

export interface ProviderApiKeyGitHubSecretGatewayPort {
  getRepositoryActionsPublicKey(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
  }): Promise<{ readonly keyId: string; readonly key: string }>;
  putEncryptedRepositorySecret(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly owner: string;
    readonly repo: string;
    readonly secretName: string;
    readonly encryptedValue: string;
    readonly keyId: string;
  }): Promise<unknown>;
}

export type ProviderApiKeyErrorClassifier = (
  error: unknown,
) => ProviderApiKeyErrorReason;
