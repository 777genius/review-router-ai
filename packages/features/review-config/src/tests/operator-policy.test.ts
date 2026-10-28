import { describe, expect, it, vi } from "vitest";
import { parseReviewConfiguration } from "../domain/review-configuration";
import { ReviewReasoningEffort } from "../domain/review-reasoning-effort";
import {
  setOperatorReviewReasoningEffort,
  type OperatorReviewConfigurationDependencies,
} from "../application/use-cases/manage-operator-review-configuration";
import type { PersistedReviewConfiguration } from "../application/ports/review-configuration-repository-port";
import {
  selectionsFor,
  workspacePolicyDocumentFixture,
} from "./current-policy-fixture";

const workspace = parseReviewConfiguration({
  schemaVersion: 3,
  providers: [
    {
      kind: "codex",
      authMode: "codex_subscription_oauth_rotating",
      model: "gpt-5.6-sol",
      reasoningEffort: "medium",
      requiredHealthy: true,
    },
  ],
  execution: {
    providerLimit: 1,
    providerMaxParallel: 1,
    inlineMinAgreement: 1,
  },
  blockingPolicy: { failOnSeverity: "critical" },
  limits: { inlineMaxComments: 5, targetTokensPerBatch: 50000 },
  reviewLanguage: null,
  investigationRollout: {
    recordingEnabled: false,
    shadowEnabled: false,
    contextCriticEnabled: false,
    verifiedCleanEnabled: false,
    crossRevisionReplayEnabled: false,
    productionEffectsEnabled: false,
  },
});
const selections = selectionsFor(workspace, ["profile_rotating"]);
const input = {
  credential: "test-only",
  repositoryFullName: "owner/repo",
  provider: "github" as const,
  effort: ReviewReasoningEffort.High,
};
function fixture(current: PersistedReviewConfiguration | null) {
  const commit = vi.fn<
    OperatorReviewConfigurationDependencies["mutations"]["commit"]
  >(async (command) => ({
    version: 1,
    config: workspace,
    policy: command.policy,
    source: "repository",
    workspaceVersion: 1,
    repositoryVersion: 1,
    effectivePolicyDigest: "sha256:test",
    revisionToken: "saved-revision",
    selections: command.policy.providers ?? selections,
  }));
  const dependencies: OperatorReviewConfigurationDependencies = {
    authorization: {
      authenticate: async () => ({ operatorId: "test-operator" }),
    },
    rateLimits: { consume: async () => true },
    repositories: {
      findActiveCandidates: async () => [
        {
          id: "repo",
          workspaceId: "workspace",
          workspaceSlug: "workspace",
          provider: "github",
          sourceBaseUrl: "https://github.com",
          fullName: "owner/repo",
        },
      ],
    },
    configurations: {
      findLatest: async () => current,
      saveNextVersion: async () => {
        throw new Error("unexpected write");
      },
      saveNextVersions: async () => {
        throw new Error("unexpected write");
      },
      deleteTarget: async () => false,
    },
    mutations: { commit },
    audit: { record: async () => {} },
  };
  return { dependencies, commit };
}
function persisted(
  source: "workspace" | "repository",
): PersistedReviewConfiguration {
  return {
    source,
    policy:
      source === "repository"
        ? { schemaVersion: 4, limits: { inlineMaxComments: 0 } }
        : workspacePolicyDocumentFixture(workspace, ["profile_rotating"]),
    config:
      source === "repository"
        ? parseReviewConfiguration({
            ...workspace,
            limits: { ...workspace.limits, inlineMaxComments: 0 },
          })
        : workspace,
    version: 1,
    workspaceVersion: 1,
    repositoryVersion: source === "repository" ? 1 : null,
    effectivePolicyDigest: "sha256:test",
    revisionToken: "expected-revision",
    selections,
  };
}
describe("operator writes sparse current policy", () => {
  it("makes a requested setting explicit even when the inherited value already matches", async () => {
    const current = persisted("repository");
    const config = parseReviewConfiguration({
      ...current.config,
      providers: current.config.providers.map((provider) => ({
        ...provider,
        reasoningEffort: "high",
      })),
    });
    const { dependencies, commit } = fixture({ ...current, config });
    await setOperatorReviewReasoningEffort(input, dependencies);
    expect(commit).toHaveBeenCalledOnce();
    expect(
      commit.mock.calls[0]?.[0].policy.providers?.[0]?.reasoningEffort,
    ).toBe("high");
  });
  it("keeps workspace settings inherited and the same profile when changing provider effort", async () => {
    const { dependencies, commit } = fixture(persisted("workspace"));
    await setOperatorReviewReasoningEffort(input, dependencies);
    expect(commit.mock.calls[0]?.[0].policy).toEqual({
      schemaVersion: 4,
      providers: [{ ...selections[0], reasoningEffort: "high" }],
    });
    expect(commit.mock.calls[0]?.[0].expectedRevisionToken).toBe(
      "expected-revision",
    );
  });
  it("preserves an existing explicit zero override", async () => {
    const { dependencies, commit } = fixture(persisted("repository"));
    await setOperatorReviewReasoningEffort(input, dependencies);
    expect(commit.mock.calls[0]?.[0].policy.limits).toEqual({
      inlineMaxComments: 0,
    });
    expect(commit.mock.calls[0]?.[0].policy.blockingPolicy).toBeUndefined();
  });
  it("denies a repository without a usable configuration before any mutation", async () => {
    const { dependencies, commit } = fixture(null);
    await expect(
      setOperatorReviewReasoningEffort(input, dependencies),
    ).rejects.toMatchObject({ code: "configuration_missing" });
    expect(commit).not.toHaveBeenCalled();
  });
});
