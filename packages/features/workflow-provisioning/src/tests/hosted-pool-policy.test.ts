import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseReviewConfiguration,
  reviewProviderSelectionFor,
} from "@reviewrouter/features-review-config";
import { switchRepositoryConfigurationAuthMode } from "../infrastructure/prisma/prisma-hosted-pool-configuration";

const mocks = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn() }));
vi.mock("@reviewrouter/features-review-config", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@reviewrouter/features-review-config")
  >()),
  acquireReviewConfigurationWriteScope: vi.fn(),
  PrismaReviewConfigurationTransactionRepository: class {
    saveNextVersions = mocks.save;
  },
  findReviewConfiguration: mocks.find,
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
  it("selects a hosted pool profile while retaining sparse overrides and CAS", async () => {
    const selection = reviewProviderSelectionFor(
      config.providers[0]!,
      "profile_rotating",
    );
    mocks.find.mockResolvedValueOnce({
      version: 7,
      source: "repository",
      repositoryVersion: 7,
      config,
      policy: {
        schemaVersion: 4,
        limits: { inlineMaxComments: 0 },
        providers: [selection],
      },
      selections: [selection],
    });
    await expect(switchRepositoryConfigurationAuthMode(input)).resolves.toBe(
      true,
    );
    const saved = mocks.save.mock.calls[0]![0];
    expect(saved.writes).toHaveLength(1);
    expect(saved.writes[0].expectedVersion).toBe(7);
    // Only the selected profile changes; settings and sparse fields remain.
    expect(saved.writes[0].policy).toEqual({
      schemaVersion: 4,
      limits: { inlineMaxComments: 0 },
      providers: [{ ...selection, profileId: "hosted-switch-0" }],
    });
    expect(saved.profileDrafts).toEqual([
      {
        draftId: "hosted-switch-0",
        credential: { kind: "hosted_pool" },
        model: config.providers[0]!.model,
        label: null,
      },
    ]);
    // A system write: the hosted pool profile has no creator.
    expect(saved.profileCreatorUserId).toBeNull();
  });
});
