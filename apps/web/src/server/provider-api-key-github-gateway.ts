import { App } from "@octokit/app";
import {
  ProviderApiKeyGitHubHttpError,
  ProviderApiKeySecretPutOutcomeUnknownError,
  ProviderApiKeySecretPutPreDispatchError,
  type ProviderApiKeyGitHubSecretGatewayPort,
} from "@reviewrouter/features-provider-setup";
import {
  Agent as HttpAgent,
  request as httpRequest,
  type ClientRequestArgs,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import type { Duplex } from "node:stream";

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
    if (!response.ok) {
      throw Object.assign(new ProviderApiKeyGitHubHttpError(response.status), {
        response: {
          status: response.status,
          headers: {
            "x-ratelimit-remaining":
              response.headers.get("x-ratelimit-remaining") ?? undefined,
          },
        },
      });
    }
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
    const response = await putProviderApiKeySecretExactlyOnce({
      baseUrl: "https://api.github.com",
      owner: input.owner,
      repo: input.repo,
      secretName: input.secretName,
      encryptedValue: input.encryptedValue,
      keyId: input.keyId,
      token,
      timeoutMs: 15_000,
    });
    if (response.status !== 201 && response.status !== 204) {
      throw new ProviderApiKeyGitHubHttpError(response.status);
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

export type ProviderApiKeySecretPutInput = Readonly<{
  baseUrl: string;
  owner: string;
  repo: string;
  secretName: string;
  encryptedValue: string;
  keyId: string;
  token: string;
  timeoutMs: number;
}>;

export async function putProviderApiKeySecretExactlyOnce(
  input: ProviderApiKeySecretPutInput,
  testTransport?: Readonly<{
    createConnection(options: ClientRequestArgs): Duplex;
  }>,
): Promise<{ readonly status: number }> {
  let url: URL;
  let body: Buffer;
  try {
    if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs <= 0) {
      throw new Error("timeout_invalid");
    }
    const baseUrl = new URL(input.baseUrl);
    if (
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.search ||
      baseUrl.hash ||
      (baseUrl.protocol !== "https:" &&
        !(baseUrl.protocol === "http:" && isLoopback(baseUrl.hostname)))
    ) {
      throw new Error("base_url_invalid");
    }
    const path = [
      "repos",
      input.owner,
      input.repo,
      "actions",
      "secrets",
      input.secretName,
    ]
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    url = new URL(path, `${baseUrl.toString().replace(/\/+$/u, "")}/`);
    body = Buffer.from(
      JSON.stringify({
        encrypted_value: input.encryptedValue,
        key_id: input.keyId,
      }),
      "utf8",
    );
  } catch (cause) {
    throw new ProviderApiKeySecretPutPreDispatchError(cause);
  }

  const dispatch = url.protocol === "https:" ? httpsRequest : httpRequest;
  const testAgent = testTransport
    ? url.protocol === "https:"
      ? new HttpsAgent({ keepAlive: false })
      : new HttpAgent({ keepAlive: false })
    : null;
  if (testAgent && testTransport) {
    testAgent.createConnection =
      testTransport.createConnection as typeof testAgent.createConnection;
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let requestBytesMayHaveLeft = false;
    const settle = (
      outcome:
        | Readonly<{ status: "resolved"; statusCode: number }>
        | Readonly<{ status: "rejected"; error: Error }>,
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (outcome.status === "resolved") {
        resolve({ status: outcome.statusCode });
      } else {
        reject(outcome.error);
      }
    };

    let request: ReturnType<typeof httpRequest>;
    try {
      request = dispatch(
        url,
        {
          method: "PUT",
          agent: testAgent ?? false,
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${input.token}`,
            "content-length": body.byteLength,
            "content-type": "application/json",
            "user-agent": "ReviewRouter-Provider-Api-Key/1",
            "x-github-api-version": "2022-11-28",
          },
        },
        (response) => {
          response.once("aborted", () =>
            settle({
              status: "rejected",
              error: new ProviderApiKeySecretPutOutcomeUnknownError(
                "response_incomplete",
              ),
            }),
          );
          response.once("error", (cause) =>
            settle({
              status: "rejected",
              error: new ProviderApiKeySecretPutOutcomeUnknownError(
                "response_incomplete",
                cause,
              ),
            }),
          );
          response.on("data", () => undefined);
          response.once("end", () => {
            if (!response.complete || response.statusCode === undefined) {
              settle({
                status: "rejected",
                error: new ProviderApiKeySecretPutOutcomeUnknownError(
                  "response_incomplete",
                ),
              });
              return;
            }
            settle({ status: "resolved", statusCode: response.statusCode });
          });
        },
      );
    } catch (cause) {
      reject(new ProviderApiKeySecretPutPreDispatchError(cause));
      return;
    }

    request.once("socket", (socket) => {
      if (url.protocol === "https:") {
        if ("encrypted" in socket) {
          socket.once("secureConnect", () => {
            requestBytesMayHaveLeft = true;
          });
          return;
        }
      } else if ("connecting" in socket && socket.connecting) {
        socket.once("connect", () => {
          requestBytesMayHaveLeft = true;
        });
        return;
      }
      requestBytesMayHaveLeft = true;
    });
    request.once("error", (cause) =>
      settle({
        status: "rejected",
        error: requestBytesMayHaveLeft
          ? new ProviderApiKeySecretPutOutcomeUnknownError(
              timedOut ? "timeout" : "transport_unknown",
              cause,
            )
          : new ProviderApiKeySecretPutPreDispatchError(cause),
      }),
    );
    const timeout = setTimeout(() => {
      timedOut = true;
      request.destroy(
        new ProviderApiKeySecretPutOutcomeUnknownError("timeout"),
      );
    }, input.timeoutMs);
    try {
      request.end(body);
    } catch (cause) {
      settle({
        status: "rejected",
        error: requestBytesMayHaveLeft
          ? new ProviderApiKeySecretPutOutcomeUnknownError(
              "transport_unknown",
              cause,
            )
          : new ProviderApiKeySecretPutPreDispatchError(cause),
      });
    }
  });
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

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}
