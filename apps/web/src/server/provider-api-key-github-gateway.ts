import { App } from "@octokit/app";
import type { ProviderApiKeyGitHubSecretGatewayPort } from "@reviewrouter/features-provider-setup";

type InstallationAuth = {
  readonly token?: unknown;
  readonly permissions?: { readonly secrets?: unknown };
};

export class ProviderApiKeyGitHubGateway implements ProviderApiKeyGitHubSecretGatewayPort {
  private readonly app: App;

  constructor(input: { readonly appId: string; readonly privateKey: string }) {
    this.app = new App(input);
  }

  async getRepositoryActionsPublicKey(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly owner: string;
    readonly repo: string;
  }): Promise<{ readonly keyId: string; readonly key: string }> {
    const token = await this.repositoryToken(input, "read");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/secrets/public-key`,
      {
        headers: githubHeaders(token),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok)
      throw new Error(`github_public_key_http_${response.status}`);
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("key_id" in body) ||
      !("key" in body) ||
      typeof body.key_id !== "string" ||
      typeof body.key !== "string" ||
      !body.key_id ||
      !body.key
    ) {
      throw new Error("provider_api_key_public_key_invalid_response");
    }
    return { keyId: body.key_id, key: body.key };
  }

  async putEncryptedRepositorySecret(input: {
    readonly githubInstallationId: string;
    readonly githubRepositoryId: string;
    readonly repositoryFullName: string;
    readonly owner: string;
    readonly repo: string;
    readonly secretName: string;
    readonly encryptedValue: string;
    readonly keyId: string;
  }): Promise<void> {
    const token = await this.repositoryToken(input, "write");
    const response = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/actions/secrets/${encodeURIComponent(input.secretName)}`,
      {
        method: "PUT",
        headers: {
          ...githubHeaders(token),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          encrypted_value: input.encryptedValue,
          key_id: input.keyId,
        }),
        redirect: "error",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (response.status !== 201 && response.status !== 204) {
      throw new Error(`github_secret_put_http_${response.status}`);
    }
  }

  private async repositoryToken(
    input: {
      readonly githubInstallationId: string;
      readonly githubRepositoryId: string;
    },
    permission: "read" | "write",
  ): Promise<string> {
    const installationId = positiveId(input.githubInstallationId);
    const repositoryId = positiveId(input.githubRepositoryId);
    const auth = (await this.app.octokit.auth({
      type: "installation",
      installationId,
      repositoryIds: [repositoryId],
      permissions: { secrets: permission },
    })) as InstallationAuth;
    if (
      typeof auth.token !== "string" ||
      !auth.token ||
      auth.permissions?.secrets !== permission
    ) {
      throw new Error("provider_api_key_installation_token_invalid_response");
    }
    return auth.token;
  }
}

function positiveId(value: string): number {
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) {
    throw new Error("provider_api_key_github_id_invalid");
  }
  return id;
}

function githubHeaders(token: string): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  };
}
