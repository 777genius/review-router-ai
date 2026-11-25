import { Octokit } from "@octokit/rest";

/** Isolated protocol qualification seam; it never supplies actor permission. */
export function githubAppTestTransport(
  env: NodeJS.ProcessEnv = process.env,
): { readonly Octokit: typeof Octokit } | Record<string, never> {
  const configured = env.REVIEW_ROUTER_GITHUB_APP_TEST_ORIGIN;
  if (!configured) return {};
  const database = new URL(env.DATABASE_URL ?? "invalid:");
  const origin = new URL(configured);
  if (
    env.NODE_ENV !== "development" ||
    env.REVIEW_ROUTER_SKILLS_E2E !== "1" ||
    database.pathname !== "/review_router_accounts_reference_e2e_test" ||
    ![database.hostname, origin.hostname].every((host) =>
      ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host),
    ) ||
    origin.protocol !== "http:" ||
    origin.pathname !== "/" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error("github_app_test_transport_refused");
  return { Octokit: Octokit.defaults({ baseUrl: origin.origin }) };
}
