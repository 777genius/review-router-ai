import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseReviewConfiguration } from "@reviewrouter/features-review-config";
import { switchRepositoryConfigurationAuthMode } from "../infrastructure/prisma/prisma-hosted-pool-configuration";

const mocks = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn() }));
vi.mock("@reviewrouter/features-review-config", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-review-config")
  >()),
  acquireReviewConfigurationWriteScope: vi.fn(),
  PrismaReviewConfigurationTransactionRepository: class {},
  findReviewConfiguration: mocks.find,
  saveReviewConfiguration: mocks.save,
}));
const config = parseReviewConfiguration({
  schemaVersion: 3,
  providers: [
    {
      kind: "codex",
      authMode: "codex_subscription_oauth_rotating",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      agenticContext: true,
      fastMode: false,
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 0, targetTokensPerBatch: 50000 },
  reviewLanguage: "French",
  investigationRollout: {
    recordingEnabled: false,
    shadowEnabled: false,
    contextCriticEnabled: false,
    verifiedCleanEnabled: false,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: false,
  },
});
const input = {
  transaction: {} as Parameters<
    typeof switchRepositoryConfigurationAuthMode
  >[0]["transaction"],
  workspaceId: "workspace",
  repositoryId: "repo",
  authMode: "codex_subscription_oauth_hosted_pool" as const,
};
beforeEach(() => {
  mocks.find.mockReset();
  mocks.save.mockReset();
});
describe("hosted pool current policy", () => {
  it("refuses missing policy without creating defaults", async () => {
    mocks.find.mockResolvedValue(null);
    await expect(switchRepositoryConfigurationAuthMode(input)).rejects.toThrow(
      "workspace_review_policy_not_configured",
    );
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("switches providers while retaining sparse overrides and CAS", async () => {
    mocks.find
      .mockResolvedValueOnce({
        version: 7,
        source: "repository",
        repositoryVersion: 7,
        config,
        policy: { schemaVersion: 3, limits: { inlineMaxComments: 0 } },
      })
      .mockResolvedValueOnce({ version: 2, config, policy: config });
    await expect(switchRepositoryConfigurationAuthMode(input)).resolves.toBe(
      true,
    );
    const saved = mocks.save.mock.calls[0]![0];
    expect(saved.expectedVersion).toBe(7);
    expect(saved.policy).toEqual({
      schemaVersion: 3,
      limits: { inlineMaxComments: 0 },
      providers: [{ ...config.providers[0], authMode: input.authMode }],
    });
    expect(saved.policy.reviewLanguage).toBeUndefined();
    expect(saved.config).toBeUndefined();
  });
});
