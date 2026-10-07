import { describe, expect, it, vi } from "vitest";

const compose = vi.hoisted(() =>
  vi.fn(() => ({
    authentication: { authenticate: vi.fn() },
    service: {},
  })),
);

vi.mock("./sdk-growth-authority-composition.js", () => ({
  composeProductionSdkGrowthAuthorityRoutes: compose,
}));

// This startup test exercises app composition only. Keep the unrelated hosted
// runtime (an optional, postinstall-built dependency) outside this test graph.
vi.mock("@reviewrouter/features-hosted-account-pool", () => ({
  registerHostedCodexRelayRoutes: vi.fn(),
}));
vi.mock("./hosted-codex-relay-composition.js", () => ({
  composeProductionHostedCodexRelayRoutes: vi.fn(),
  readHostedCodexFeatureFlags: vi.fn(() => ({
    custody: false,
    admission: false,
    relay: false,
  })),
}));
vi.mock("./certified-fork-live-review-composition.js", () => ({
  composeProductionCertifiedForkLiveReview: vi.fn(),
}));
vi.mock("./hosted-pool-operator-composition.js", () => ({
  createHostedPoolOperatorComposition: vi.fn(),
}));
vi.mock("./hosted-pool-workflow-operator-composition.js", () => ({
  createDefaultHostedPoolOperatorConnect: vi.fn(),
}));

import { createApiApp } from "./app.js";

describe("SDK growth production startup", () => {
  it("composes and registers the five authority routes when enabled", async () => {
    const prisma = {} as never;
    const app = await createApiApp({
      prisma,
      reviewActionV2Env: {
        REVIEW_ROUTER_SDK_GROWTH_AUTHORITY_ENABLED: "1",
        REVIEW_ROUTER_ACTION_OIDC_AUDIENCE: "sdk-growth",
        GITHUB_APP_ID: "123",
        GITHUB_APP_PRIVATE_KEY: "configured-for-composition-test",
      },
    });
    expect(compose).toHaveBeenCalledWith({
      prisma,
      audience: "sdk-growth",
      githubAppId: "123",
      githubAppPrivateKey: "configured-for-composition-test",
    });
    const base = "/sdk-growth/v1/repositories/:repositoryId/pulls/:pullRequest";
    expect(app.hasRoute({ method: "POST", url: `${base}/requests` })).toBe(
      true,
    );
    expect(
      app.hasRoute({ method: "GET", url: `${base}/requests/:requestDigest` }),
    ).toBe(true);
    expect(app.hasRoute({ method: "POST", url: `${base}/completions` })).toBe(
      true,
    );
    expect(app.hasRoute({ method: "GET", url: `${base}/receipts` })).toBe(true);
    expect(app.hasRoute({ method: "GET", url: `${base}/status` })).toBe(true);
    await app.close();
  });
});
