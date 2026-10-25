import { describe, expect, it } from "vitest";
import {
  fitExecutionLimits,
  resolveEffectiveReviewPolicy,
  ReviewPolicyMaterializationError,
  type RepositoryReviewPolicy,
  type WorkspaceReviewPolicy,
} from "../domain/review-policy-document";
import {
  providerProfileFixture,
  workspacePolicyDocumentFixture,
  workspacePolicyFixture,
} from "./current-policy-fixture";

const profiles = new Map(
  (["profile_a", "profile_b"] as const).map((id, index) => [
    id,
    providerProfileFixture({
      id,
      credential: {
        kind: "hosted_pool",
        authMode: "codex_subscription_oauth_hosted_pool",
      },
      model: index === 0 ? "gpt-5.5" : "gpt-5.4",
    }),
  ]),
);
const selection = (profileId: string) => ({
  profileId,
  reasoningEffort: "high" as const,
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
});
const target = {
  scope: "repository",
  workspaceId: "workspace_1",
  repositoryId: "repo_1",
} as const;
/** Two default providers run in parallel and must both agree. */
const twoProviderWorkspace: WorkspaceReviewPolicy = {
  ...workspacePolicyDocumentFixture(workspacePolicyFixture),
  providers: [selection("profile_a"), selection("profile_b")],
  execution: { providerMaxParallel: 2, inlineMinAgreement: 2 },
};

function materialize(
  workspace: WorkspaceReviewPolicy,
  repository: RepositoryReviewPolicy | null,
) {
  return resolveEffectiveReviewPolicy({
    target,
    workspace,
    repository,
    profiles,
  });
}

function refusal(run: () => unknown): string | null {
  try {
    run();
    return null;
  } catch (error) {
    if (error instanceof ReviewPolicyMaterializationError) return error.code;
    throw error;
  }
}

describe("execution limits", () => {
  it("fits inherited workspace limits to a repository's own providers", () => {
    const resolved = materialize(twoProviderWorkspace, {
      schemaVersion: 4,
      providers: [selection("profile_a")],
    });
    expect(resolved?.config.execution).toEqual({
      providerLimit: 1,
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    });
    // Inheriting the default keeps the workspace limits as they are.
    expect(materialize(twoProviderWorkspace, null)?.config.execution).toEqual({
      providerLimit: 2,
      providerMaxParallel: 2,
      inlineMinAgreement: 2,
    });
  });

  it("never fits limits a document stores next to the providers they govern", () => {
    // A repository override asking for two agreeing votes of one provider.
    expect(
      refusal(() =>
        materialize(twoProviderWorkspace, {
          schemaVersion: 4,
          providers: [selection("profile_a")],
          execution: { inlineMinAgreement: 2 },
        }),
      ),
    ).toBe("review_execution_limits_incompatible");
    // The same override over a one-provider default it inherits.
    const oneProviderWorkspace = {
      ...twoProviderWorkspace,
      providers: [selection("profile_a")],
      execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
    };
    expect(
      refusal(() =>
        materialize(oneProviderWorkspace, {
          schemaVersion: 4,
          execution: { inlineMinAgreement: 2 },
        }),
      ),
    ).toBe("review_execution_limits_incompatible");
    // A workspace document whose own limits exceed its own default.
    expect(
      refusal(() =>
        resolveEffectiveReviewPolicy({
          target: { scope: "workspace", workspaceId: "workspace_1" },
          workspace: {
            ...twoProviderWorkspace,
            providers: [selection("profile_a")],
          },
          repository: null,
          profiles,
        }),
      ),
    ).toBe("review_execution_limits_incompatible");
  });

  it("lowers a document's own limits when a selection write shrinks its providers", () => {
    expect(fitExecutionLimits(twoProviderWorkspace, 1).execution).toEqual({
      providerMaxParallel: 1,
      inlineMinAgreement: 1,
    });
    // Never raised, and a document without limits stays without them.
    expect(fitExecutionLimits(twoProviderWorkspace, 3)).toEqual(
      twoProviderWorkspace,
    );
    const repository: RepositoryReviewPolicy = {
      schemaVersion: 4,
      execution: { inlineMinAgreement: 2 },
    };
    expect(fitExecutionLimits(repository, 1)).toEqual({
      schemaVersion: 4,
      execution: { inlineMinAgreement: 1 },
    });
    expect(fitExecutionLimits({ schemaVersion: 4 }, 1)).toEqual({
      schemaVersion: 4,
    });
  });
});
