import { createGitHubAppInstallationOctokit } from "./dashboard-mutations";
import { createOrganizationSecretPolicyLoader } from "./dashboard-organization-secret-policy";

/** GitHub App adapter. Cache policy and metadata parsing are tested in isolation. */
export const loadOrganizationSecretPolicy =
  createOrganizationSecretPolicyLoader({
    readPlan: async ({ accountLogin, githubInstallationId }) => {
      const octokit = await createGitHubAppInstallationOctokit(
        githubInstallationId.toString(),
      );
      const response = await octokit.request("GET /orgs/{org}", {
        org: accountLogin,
      });
      return (response.data as { readonly plan?: unknown }).plan;
    },
  });
