import { describe, expect, it, vi } from "vitest";
import {
  applyProviderApiKey,
  classifyProviderApiKeyError,
} from "./apply-provider-api-key";
import type {
  ProviderApiKeyGitHubSecretGatewayPort,
  ProviderApiKeyRepositoryPort,
  ProviderApiKeyStorageCipherPort,
  ProviderApiKeyStorePort,
} from "./provider-api-key-ports";

const publicKey = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);

describe("provider API key versioning", () => {
  it("rotates the key and rewrites the union of connected and selected repositories", async () => {
    const store = new TestStore();
    await store.seed({
      repositoryId: "repo_1",
      appliedKeyVersion: 1,
      status: "applied",
    });
    store.connection = {
      encryptedApiKey: "encrypted:saved-key",
      keyVersion: 1,
      latestOperationId: "old-operation",
    };
    const githubSecrets = gateway();

    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey: "new-key",
        repositoryIds: ["repo_2"],
      },
      dependencies({ githubSecrets, providerApiKeys: store }),
    );

    expect(store.connection?.keyVersion).toBe(2);
    expect(store.preparedRepositoryIds).toEqual(["repo_1", "repo_2"]);
    expect(githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledTimes(2);
    expect(result.results.map((item) => item.status)).toEqual([
      "applied",
      "applied",
    ]);
  });

  it("adds repositories with a saved key without accepting plaintext again", async () => {
    const store = new TestStore();
    await store.seed({
      repositoryId: "repo_1",
      appliedKeyVersion: 1,
      status: "applied",
    });
    store.connection = {
      encryptedApiKey: "encrypted:saved-key",
      keyVersion: 1,
      latestOperationId: "old-operation",
    };
    const githubSecrets = gateway();

    await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        repositoryIds: ["repo_2"],
      },
      dependencies({ githubSecrets, providerApiKeys: store }),
    );

    expect(store.preparedRepositoryIds).toEqual(["repo_2"]);
    expect(store.prepareInputs[0]?.encryptedApiKey).toBeUndefined();
    expect(store.connection?.keyVersion).toBe(1);
    expect(githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledTimes(1);
  });

  it("serializes rotations and ignores a late result from a superseded operation", async () => {
    const store = new TestStore();
    store.connection = {
      encryptedApiKey: "encrypted:key-1",
      keyVersion: 1,
      latestOperationId: "old-operation",
    };
    await store.seed({
      repositoryId: "repo_1",
      appliedKeyVersion: 1,
      status: "applied",
    });
    const githubSecrets = gateway();
    const lock = new SerializedLock();
    const first = applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey: "key-2",
        repositoryIds: ["repo_1"],
      },
      dependencies({ githubSecrets, providerApiKeys: store, lock }),
    );
    const second = applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey: "key-3",
        repositoryIds: ["repo_1"],
      },
      dependencies({ githubSecrets, providerApiKeys: store, lock }),
    );

    await Promise.all([first, second]);

    expect(store.connection?.keyVersion).toBe(3);
    expect(store.operationVersions).toEqual([2, 3]);
    expect(store.link?.appliedKeyVersion).toBe(3);
    expect(store.link?.lastOperationId).toBe(
      store.connection?.latestOperationId,
    );
  });

  it("marks GitHub success followed by persistence failure as reconciliation-needed", async () => {
    const store = new TestStore();
    store.failResultPersistence = true;
    const githubSecrets = gateway();

    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey: "new-key",
        repositoryIds: ["repo_1"],
      },
      dependencies({ githubSecrets, providerApiKeys: store }),
    );

    expect(result.results[0]?.status).toBe("reconciliation_needed");
    expect(store.link?.reconciliationNeeded).toBe(true);
    expect(store.link?.status).toBe("applying");
    expect(githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledTimes(1);
  });

  it("returns denied repositories without invoking the GitHub gateway", async () => {
    const store = new TestStore();
    const githubSecrets = gateway();

    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey: "new-key",
        repositoryIds: ["denied_repo"],
      },
      dependencies({ githubSecrets, providerApiKeys: store }),
    );

    expect(result.results).toEqual([
      expect.objectContaining({
        repositoryId: "denied_repo",
        status: "denied",
        errorReason: "repository_not_allowed",
      }),
    ]);
    expect(githubSecrets.getRepositoryActionsPublicKey).not.toHaveBeenCalled();
    expect(githubSecrets.putEncryptedRepositorySecret).not.toHaveBeenCalled();
  });

  it("sanitizes provider errors so key material never reaches results", async () => {
    const githubSecrets = gateway();
    githubSecrets.putEncryptedRepositorySecret.mockRejectedValue(
      new Error("failed while processing sk-or-v1-must-never-leak"),
    );

    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "openrouter",
        apiKey: "sk-or-v1-must-never-leak",
        repositoryIds: ["repo_1"],
      },
      dependencies({ githubSecrets }),
    );

    expect(JSON.stringify(result)).not.toContain("must-never-leak");
    expect(result.results[0]?.errorSummary).toBe(
      "GitHub could not update this repository secret.",
    );
    expect(classifyProviderApiKeyError(new Error("secret"))).toBe(
      "github_request_failed",
    );
  });
});

function dependencies(overrides: {
  readonly githubSecrets?: ProviderApiKeyGitHubSecretGatewayPort;
  readonly providerApiKeys?: TestStore;
  readonly lock?: SerializedLock;
}): {
  providerApiKeys: ProviderApiKeyStorePort;
  providerApiKeyRepositories: ProviderApiKeyRepositoryPort;
  storageCipher: ProviderApiKeyStorageCipherPort;
  githubSecrets: ProviderApiKeyGitHubSecretGatewayPort;
  classifyError: typeof classifyProviderApiKeyError;
  lock: SerializedLock;
} {
  return {
    providerApiKeys: (overrides.providerApiKeys ??
      new TestStore()) as unknown as ProviderApiKeyStorePort,
    providerApiKeyRepositories: {
      findRepositoryTargets: vi.fn(
        async (input: { readonly repositoryIds: readonly string[] }) => {
          const targets = {
            repo_1: {
              repositoryId: "repo_1",
              repositoryFullName: "acme/one",
              githubInstallationId: "installation_1",
              githubRepositoryId: "repository_1",
              owner: "acme",
              repo: "one",
            },
            repo_2: {
              repositoryId: "repo_2",
              repositoryFullName: "acme/two",
              githubInstallationId: "installation_1",
              githubRepositoryId: "repository_2",
              owner: "acme",
              repo: "two",
            },
          } as const;
          return input.repositoryIds.flatMap((repositoryId) =>
            repositoryId === "repo_1" || repositoryId === "repo_2"
              ? [targets[repositoryId]]
              : [],
          );
        },
      ),
    },
    storageCipher: {
      encrypt: (value) => `encrypted:${value}`,
      decrypt: (value) => value.replace("encrypted:", ""),
    },
    githubSecrets: overrides.githubSecrets ?? gateway(),
    classifyError: classifyProviderApiKeyError,
    lock: overrides.lock ?? new SerializedLock(),
  };
}

function gateway(): ProviderApiKeyGitHubSecretGatewayPort & {
  readonly getRepositoryActionsPublicKey: ReturnType<typeof vi.fn>;
  readonly putEncryptedRepositorySecret: ReturnType<typeof vi.fn>;
} {
  return {
    getRepositoryActionsPublicKey: vi.fn().mockResolvedValue({
      keyId: "github-key-id",
      key: publicKey,
    }),
    putEncryptedRepositorySecret: vi.fn().mockResolvedValue(undefined),
  };
}

type TestLink = {
  repositoryId: string;
  appliedKeyVersion: number | null;
  attemptedKeyVersion: number | null;
  status: string;
  lastOperationId: string | null;
  reconciliationNeeded: boolean;
  errorReason?: string;
};

class TestStore {
  connection: {
    encryptedApiKey: string;
    keyVersion: number;
    latestOperationId: string;
  } | null = null;
  private readonly links = new Map<string, TestLink>();
  private latestLinkRepositoryId: string | null = null;
  preparedRepositoryIds: string[] = [];
  prepareInputs: {
    encryptedApiKey?: string;
    repositoryIds: readonly string[];
  }[] = [];
  operationVersions: number[] = [];
  failResultPersistence = false;

  get link(): TestLink | null {
    return this.latestLinkRepositoryId
      ? (this.links.get(this.latestLinkRepositoryId) ?? null)
      : null;
  }

  async seed(link: {
    readonly repositoryId: string;
    readonly appliedKeyVersion: number;
    readonly status: string;
  }): Promise<void> {
    this.links.set(link.repositoryId, {
      repositoryId: link.repositoryId,
      appliedKeyVersion: link.appliedKeyVersion,
      attemptedKeyVersion: link.appliedKeyVersion,
      status: link.status,
      lastOperationId: "old-operation",
      reconciliationNeeded: false,
    });
    this.latestLinkRepositoryId = link.repositoryId;
  }

  async findEncryptedApiKey(): Promise<string | null> {
    return this.connection?.encryptedApiKey ?? null;
  }

  async findConnectedRepositoryIds(): Promise<readonly string[]> {
    return [...this.links.keys()];
  }

  async prepareApply(input: {
    readonly encryptedApiKey?: string;
    readonly repositoryIds: readonly string[];
  }): Promise<{
    readonly operationId: string;
    readonly keyVersion: number;
    readonly repositoryIds: readonly string[];
  }> {
    this.prepareInputs.push(input);
    const keyVersion = input.encryptedApiKey
      ? (this.connection?.keyVersion ?? 0) + 1
      : (this.connection?.keyVersion ?? 0) || 1;
    const operationId = `operation_${keyVersion}`;
    this.connection = {
      encryptedApiKey:
        input.encryptedApiKey ?? this.connection?.encryptedApiKey ?? "",
      keyVersion,
      latestOperationId: operationId,
    };
    this.operationVersions.push(keyVersion);
    this.preparedRepositoryIds = [...input.repositoryIds];
    for (const repositoryId of input.repositoryIds) {
      const previous = this.links.get(repositoryId);
      this.links.set(repositoryId, {
        repositoryId,
        appliedKeyVersion: previous?.appliedKeyVersion ?? null,
        attemptedKeyVersion: keyVersion,
        status: "pending",
        lastOperationId: operationId,
        reconciliationNeeded: false,
      });
      this.latestLinkRepositoryId = repositoryId;
    }
    return { operationId, keyVersion, repositoryIds: input.repositoryIds };
  }

  async markRepositoryApplying(input: {
    readonly operationId: string;
    readonly repositoryId: string;
  }): Promise<boolean> {
    const link = this.links.get(input.repositoryId);
    if (this.connection?.latestOperationId !== input.operationId || !link) {
      return false;
    }
    link.status = "applying";
    link.reconciliationNeeded = true;
    this.latestLinkRepositoryId = input.repositoryId;
    return true;
  }

  async recordRepositoryResult(input: {
    readonly operationId: string;
    readonly keyVersion: number;
    readonly result: {
      readonly repositoryId: string;
      readonly status: string;
      readonly errorReason?: string;
    };
  }): Promise<"recorded" | "superseded"> {
    if (this.failResultPersistence) throw new Error("database_unavailable");
    const link = this.links.get(input.result.repositoryId);
    if (
      this.connection?.latestOperationId !== input.operationId ||
      !link ||
      this.connection.keyVersion !== input.keyVersion
    ) {
      return "superseded";
    }
    link.status = input.result.status;
    link.attemptedKeyVersion = input.keyVersion;
    link.lastOperationId = input.operationId;
    link.reconciliationNeeded = false;
    if (input.result.status === "applied")
      link.appliedKeyVersion = input.keyVersion;
    if (input.result.errorReason) link.errorReason = input.result.errorReason;
    this.latestLinkRepositoryId = input.result.repositoryId;
    return "recorded";
  }

  async markRepositoryReconciliationNeeded(input: {
    readonly operationId: string;
    readonly repositoryId: string;
    readonly errorReason: string;
  }): Promise<void> {
    const link = this.links.get(input.repositoryId);
    if (this.connection?.latestOperationId !== input.operationId || !link) {
      return;
    }
    link.status = "applying";
    link.reconciliationNeeded = true;
    link.errorReason = input.errorReason;
    this.latestLinkRepositoryId = input.repositoryId;
  }

  async findState(): Promise<never> {
    throw new Error("not_used");
  }
}

class SerializedLock {
  private tail: Promise<unknown> = Promise.resolve();

  async withLock<T>(
    _key: string,
    _ttlMs: number,
    run: () => Promise<T>,
  ): Promise<T> {
    const result = this.tail.then(run);
    this.tail = result.catch(() => undefined);
    return result;
  }
}
