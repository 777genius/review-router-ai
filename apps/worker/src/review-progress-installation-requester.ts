import { App } from "@octokit/app";
import type { ReviewProgressInstallationRequesterFactory } from "./review-progress-publisher";

/** One GitHub App client for every writer of the progress comment. */
export function createProgressInstallationRequester(input: {
  readonly githubAppId: string;
  readonly githubPrivateKey: string;
}): ReviewProgressInstallationRequesterFactory {
  const app = new App({
    appId: input.githubAppId,
    privateKey: input.githubPrivateKey,
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
  return async (installationId) => {
    const numericInstallationId = Number(installationId);
    if (
      !Number.isSafeInteger(numericInstallationId) ||
      numericInstallationId < 1
    ) {
      throw new Error("review_progress_github_installation_id_invalid");
    }
    const octokit = await app.getInstallationOctokit(numericInstallationId);
    return {
      request: async (route, parameters) => {
        const response = await octokit.request(
          route as "GET /rate_limit",
          parameters as never,
        );
        return { data: response.data, headers: response.headers };
      },
      botLogin: await resolveBotLogin(),
    };
  };
}
