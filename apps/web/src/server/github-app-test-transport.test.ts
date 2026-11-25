import { expect, it } from "vitest";
import { githubAppTestTransport } from "./github-app-test-transport";
const fixture = {
  NODE_ENV: "development",
  REVIEW_ROUTER_SKILLS_E2E: "1",
  DATABASE_URL:
    "postgres://rr_skills_test@127.0.0.1:55441/review_router_accounts_reference_e2e_test",
  REVIEW_ROUTER_GITHUB_APP_TEST_ORIGIN: "http://127.0.0.1:32123",
} as const;
it("uses the ordinary production transport unless the explicit qualification seam is configured", () => {
  expect(githubAppTestTransport({ NODE_ENV: "production" })).toEqual({});
  expect(githubAppTestTransport(fixture).Octokit).toBeTypeOf("function");
});
it("cannot redirect production or a different database/network to a fixture", () => {
  for (const change of [
    { NODE_ENV: "production" },
    { REVIEW_ROUTER_SKILLS_E2E: "0" },
    { DATABASE_URL: "postgres://rr_skills_test@127.0.0.1:55441/other" },
    {
      DATABASE_URL:
        "postgres://rr_skills_test@db.example/review_router_accounts_reference_e2e_test",
    },
    { REVIEW_ROUTER_GITHUB_APP_TEST_ORIGIN: "https://example.com" },
    {
      REVIEW_ROUTER_GITHUB_APP_TEST_ORIGIN: "http://user:pass@127.0.0.1:32123",
    },
  ] as const)
    expect(() => githubAppTestTransport({ ...fixture, ...change })).toThrow(
      "github_app_test_transport_refused",
    );
});
