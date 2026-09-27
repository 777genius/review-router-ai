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

type MockedGitHubSecretGateway = ProviderApiKeyGitHubSecretGatewayPort & {
  readonly getRepositoryActionsPublicKey: ReturnType<typeof vi.fn>;
  readonly putEncryptedRepositorySecret: ReturnType<typeof vi.fn>;
};

const apiKey = "sk-or-v1-fake-provider-key";
const publicKey = Buffer.from("0123456789abcdef0123456789abcdef").toString(
  "base64",
);

describe("applyProviderApiKey", () => {
  it("reuses the encrypted saved key when a later batch omits apiKey", async () => {
    const providerApiKeys = store();
    const githubSecrets = gateway();

    await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        repositoryIds: ["repo_2"],
      },
      dependencies({ githubSecrets, providerApiKeys }),
    );

    expect(providerApiKeys.findEncryptedApiKey).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      providerType: "mimo",
    });
    expect(githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledWith(
      expect.objectContaining({ secretName: "MIMO_TOKEN_PLAN_API_KEY" }),
    );
  });

  it("writes the same provider key to every selected repository", async () => {
    const githubSecrets = gateway();
    const providerApiKeys = store();
    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "openrouter",
        apiKey,
        repositoryIds: ["repo_1", "repo_2"],
      },
      dependencies({ githubSecrets, providerApiKeys }),
    );

    expect(result.results).toEqual([
      {
        repositoryId: "repo_1",
        repositoryFullName: "acme/one",
        status: "applied",
      },
      {
        repositoryId: "repo_2",
        repositoryFullName: "acme/two",
        status: "applied",
      },
    ]);
    expect(providerApiKeys.saveEncryptedApiKey).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      providerType: "openrouter",
      encryptedApiKey: `encrypted:${apiKey}`,
    });
    expect(githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledTimes(2);
    expect(githubSecrets.putEncryptedRepositorySecret).toHaveBeenCalledWith(
      expect.objectContaining({
        secretName: "OPENROUTER_API_KEY",
        encryptedValue: expect.any(String),
      }),
    );
  });

  it("keeps successful repositories and reports failures in a partial batch", async () => {
    const githubSecrets = gateway();
    githubSecrets.putEncryptedRepositorySecret
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        Object.assign(new Error("forbidden"), { status: 403 }),
      );

    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey,
        repositoryIds: ["repo_1", "repo_2"],
      },
      dependencies({ githubSecrets }),
    );

    expect(result.results).toEqual([
      {
        repositoryId: "repo_1",
        repositoryFullName: "acme/one",
        status: "applied",
      },
      {
        repositoryId: "repo_2",
        repositoryFullName: "acme/two",
        status: "failed",
        errorReason: "insufficient_permissions",
      },
    ]);
  });

  it("classifies GitHub rate limits for each affected repository", async () => {
    const githubSecrets = gateway();
    githubSecrets.getRepositoryActionsPublicKey.mockRejectedValue(
      Object.assign(new Error("rate limited"), {
        status: 403,
        response: {
          status: 403,
          headers: { "x-ratelimit-remaining": "0" },
        },
      }),
    );

    const result = await applyProviderApiKey(
      {
        workspaceId: "workspace_1",
        providerType: "mimo",
        apiKey,
        repositoryIds: ["repo_1", "repo_2"],
      },
      dependencies({ githubSecrets }),
    );

    expect(result.results.map((item) => item.errorReason)).toEqual([
      "rate_limited",
      "rate_limited",
    ]);
    expect(githubSecrets.putEncryptedRepositorySecret).not.toHaveBeenCalled();
  });

  it("classifies rate-limit status before generic GitHub errors", () => {
    expect(classifyProviderApiKeyError({ status: 429 })).toBe("rate_limited");
  });
});

function dependencies(overrides?: {
  readonly githubSecrets?: MockedGitHubSecretGateway;
  readonly providerApiKeys?: ProviderApiKeyStorePort;
}): {
  providerApiKeys: ProviderApiKeyStorePort;
  providerApiKeyRepositories: ProviderApiKeyRepositoryPort;
  storageCipher: ProviderApiKeyStorageCipherPort;
  githubSecrets: ProviderApiKeyGitHubSecretGatewayPort;
  classifyError: typeof classifyProviderApiKeyError;
} {
  return {
    providerApiKeys: overrides?.providerApiKeys ?? store(),
    providerApiKeyRepositories: {
      findRepositoryTargets: vi.fn().mockResolvedValue([
        {
          repositoryId: "repo_1",
          repositoryFullName: "acme/one",
          githubInstallationId: "101",
          githubRepositoryId: "201",
          owner: "acme",
          repo: "one",
        },
        {
          repositoryId: "repo_2",
          repositoryFullName: "acme/two",
          githubInstallationId: "101",
          githubRepositoryId: "202",
          owner: "acme",
          repo: "two",
        },
      ]),
    },
    storageCipher: {
      encrypt: vi.fn((value: string) => `encrypted:${value}`),
      decrypt: vi.fn((value: string) => value.replace("encrypted:", "")),
    },
    githubSecrets: overrides?.githubSecrets ?? gateway(),
    classifyError: classifyProviderApiKeyError,
  };
}

function gateway(): MockedGitHubSecretGateway {
  return {
    getRepositoryActionsPublicKey: vi.fn().mockResolvedValue({
      keyId: "github-key-id",
      key: publicKey,
    }),
    putEncryptedRepositorySecret: vi.fn().mockResolvedValue(undefined),
  };
}

function store(): ProviderApiKeyStorePort {
  return {
    findEncryptedApiKey: vi.fn().mockResolvedValue(`encrypted:${apiKey}`),
    saveEncryptedApiKey: vi.fn().mockResolvedValue(undefined),
    saveRepositoryResults: vi.fn().mockResolvedValue(undefined),
    findState: vi.fn(),
  };
}
