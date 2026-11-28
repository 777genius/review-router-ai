import { App } from "@octokit/app";
import { Octokit } from "@octokit/core";
import { createRetainedOperationRunner } from "@reviewrouter/shared";
import type { ReviewProgressInstallationRequesterFactory } from "./review-progress-publisher";
import { createProgressHttpTransport } from "./review-progress-http-transport";

/** One GitHub App client for every writer of the progress comment. */
export function createProgressInstallationRequester(input: {
  readonly githubAppId: string;
  readonly githubPrivateKey: string;
  readonly requestTimeoutMs?: number;
  readonly fetch?: typeof fetch;
}): ReviewProgressInstallationRequesterFactory {
  const requestTimeoutMs = input.requestTimeoutMs ?? 15_000;
  const requests = createRetainedOperationRunner(4);
  const app = new App({
    appId: input.githubAppId,
    privateKey: input.githubPrivateKey,
    Octokit: Octokit.defaults({
      request: {
        fetch: createProgressHttpTransport(input.fetch, requestTimeoutMs),
      },
    }),
  });
  let botLogin: Promise<string> | null = null;
  const resolveBotLogin = () => {
    botLogin ??= app.octokit
      .request("GET /app")
      .then((response) => {
        const slug = response.data?.slug;
        if (!slug) throw new Error("review_progress_github_app_slug_missing");
        return `${slug}[bot]`;
      })
      .catch((error: unknown) => {
        botLogin = null;
        throw error;
      });
    return botLogin;
  };
  return async (installationId, options) => {
    const numericInstallationId = Number(installationId);
    if (
      !Number.isSafeInteger(numericInstallationId) ||
      numericInstallationId < 1
    ) {
      throw new Error("review_progress_github_installation_id_invalid");
    }
    return requests.run(
      async (signal) => {
        const octokit = await app.getInstallationOctokit(numericInstallationId);
        signal.throwIfAborted();
        const login = await resolveBotLogin();
        signal.throwIfAborted();
        return {
          request: async (route, parameters) => {
            return requests.run(
              async (requestSignal) => {
                const response = await octokit.request(
                  route as "GET /rate_limit",
                  {
                    ...parameters,
                    request: {
                      ...(parameters?.request as
                        | Record<string, unknown>
                        | undefined),
                      signal: requestSignal,
                    },
                  } as never,
                );
                requestSignal.throwIfAborted();
                return { data: response.data, headers: response.headers };
              },
              {
                timeoutMs: requestTimeoutMs,
                ...(options?.signal ? { signal: options.signal } : {}),
              },
            );
          },
          botLogin: login,
        };
      },
      {
        timeoutMs: requestTimeoutMs,
        ...(options?.signal ? { signal: options.signal } : {}),
      },
    );
  };
}
