import { describe, expect, it } from "vitest";
import {
  isCurrentWorkflowSetupAuthority,
} from "../domain/workflow-setup-authority.js";

const oldHead = "a".repeat(40);
const matching = {
  attemptId: "attempt_1",
  revision: 7n,
  pullRequestHeadSha: oldHead,
  branch: "reviewrouter/setup",
  pullRequestUrl: "https://github.com/org/repo/pull/99",
} as const;
const artifact = {
  workflowPath: ".github/workflows/reviewrouter.yml",
  workflowStyle: "reusable",
  actionVersion: "777genius/review-router@stable",
} as const;
const current = {
  ...matching,
  workspaceId: "workspace_1",
  installationId: "installation_1",
  ...artifact,
};
const input = {
  observedRepositoryDefaultBranch: "main",
  expectedBaseBranch: "main",
  expectedAttempt: matching,
  currentAttempt: current,
  workspaceId: "workspace_1",
  installationId: "installation_1",
  historicalMergedSetupPullRequest: false,
  verifiedArtifact: artifact,
} as const;

describe("workflow setup durable authority", () => {
  it("accepts the exact revision, installation and verified workflow", () => {
    expect(isCurrentWorkflowSetupAuthority(input)).toBe(true);
  });
  it.each([
    ["changed default branch", { observedRepositoryDefaultBranch: "master" }],
    ["repository vanished", { observedRepositoryDefaultBranch: null }],
    ["attempt removed", { currentAttempt: null }],
    [
      "attempt replaced",
      { currentAttempt: { ...current, attemptId: "attempt_2" } },
    ],
    ["stale revision", { currentAttempt: { ...current, revision: 8n } }],
    ["different workspace",
      { currentAttempt: { ...current, workspaceId: "workspace_2" } },
    ],
    ["installation transferred",
      { currentAttempt: { ...current, installationId: "installation_2" } },
    ],
    ["head changed",
      { currentAttempt: { ...current, pullRequestHeadSha: "b".repeat(40) } },
    ],
    ["branch changed",
      { currentAttempt: { ...current, branch: "reviewrouter/other" } },
    ],
    ["PR URL changed",
      { currentAttempt: { ...current, pullRequestUrl: "https://github.com/org/repo/pull/100" } },
    ],
    ["workflow path changed",
      { currentAttempt: { ...current, workflowPath: ".github/workflows/other.yml" } },
    ],
    ["workflow style changed",
      { currentAttempt: { ...current, workflowStyle: "explicit" } },
    ],
    ["action release changed",
      { currentAttempt: { ...current, actionVersion: "unexpected" } },
    ],
  ] as const)("%s is not current", (_case, changes) => {
    expect(isCurrentWorkflowSetupAuthority({ ...input, ...changes })).toBe(false);
  });
  it("refuses an unexpected record if no prior attempt existed", () => {
    expect(
      isCurrentWorkflowSetupAuthority({ ...input, expectedAttempt: null }),
    ).toBe(false);
  });
  it("accepts no prior attempt only while no current attempt exists", () => {
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        expectedAttempt: null,
        currentAttempt: null,
      }),
    ).toBe(true);
  });
  it("does not authorize workflow changes from an unbound legacy marker", () => {
    const unbound = { ...matching, pullRequestHeadSha: null };
    const altered = {
      ...current,
      pullRequestHeadSha: null,
      workflowPath: "other",
    };
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        expectedAttempt: unbound,
        currentAttempt: altered,
      }),
    ).toBe(true);
    // A historically merged PR always requires an exact artifact match.
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        expectedAttempt: unbound,
        currentAttempt: altered,
        historicalMergedSetupPullRequest: true,
      }),
    ).toBe(false);
  });
  it("preserves the nullable repository installation identity from Prisma", () => {
    // RepositoryConnection.installationId is String? in the real schema.
    // The previous in-host CAS comparison admitted two equal null values.
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        installationId: null,
        currentAttempt: { ...current, installationId: null },
      }),
    ).toBe(true);
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        installationId: null,
      }),
    ).toBe(false);
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        currentAttempt: { ...current, installationId: null },
      }),
    ).toBe(false);
  });

  it("treats number and bigint revisions as different CAS identities", () => {
    expect(
      isCurrentWorkflowSetupAuthority({
        ...input,
        currentAttempt: { ...current, revision: 7 },
      }),
    ).toBe(false);
  });
});
