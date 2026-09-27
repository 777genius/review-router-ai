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

export type ProviderApiKeyApplySession = {
  readonly operationId: string;
  readonly keyVersion: number;
  readonly repositoryIds: readonly string[];
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
  findConnectedRepositoryIds(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<readonly string[]>;
  prepareApply(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly encryptedApiKey?: string;
    readonly repositoryIds: readonly string[];
  }): Promise<ProviderApiKeyApplySession>;
  markRepositoryApplying(input: {
    readonly operationId: string;
    readonly repositoryId: string;
  }): Promise<boolean>;
  recordRepositoryResult(input: {
    readonly operationId: string;
    readonly keyVersion: number;
    readonly result: ProviderApiKeyRepositoryResult;
  }): Promise<"recorded" | "superseded">;
  markRepositoryReconciliationNeeded(input: {
    readonly operationId: string;
    readonly repositoryId: string;
    readonly errorReason: ProviderApiKeyErrorReason;
  }): Promise<void>;
  findState(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<ProviderApiKeyState>;
}

export interface ProviderApiKeyLockPort {
  withLock<T>(key: string, ttlMs: number, run: () => Promise<T>): Promise<T>;
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
