import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  resolveEffectiveReviewConfiguration,
  resolveEffectiveReviewConfigurations,
  resolveReviewPolicy,
  resolveReviewRuntimeEnv,
  type ReviewPolicyHead,
  type ReviewPolicyHeadReaderPort,
} from "../index";
import { workspacePolicyFixture } from "./current-policy-fixture";

const workspaceId = "workspace_1";
const repositoryTarget = {
  scope: "repository",
  workspaceId,
  repositoryId: "repository_1",
} as const;
const override = { schemaVersion: 3, reviewLanguage: "Russian" } as const;

function head(
  version: number,
  policy: unknown,
  schemaVersion = 3,
): ReviewPolicyHead {
  return { version, schemaVersion, policyJson: JSON.stringify(policy) };
}

function policyHeads(
  workspace: ReviewPolicyHead | null,
  repositories: Readonly<Record<string, ReviewPolicyHead>> = {},
): ReviewPolicyHeadReaderPort {
  return {
    readPolicyHeads: async (target) => ({
      workspace,
      repository:
        target.scope === "repository"
          ? (repositories[target.repositoryId] ?? null)
          : null,
    }),
    readRepositoryPolicyHeads: async () => ({
      workspace,
      repositories: new Map(Object.entries(repositories)),
    }),
  };
}

function digest(config: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
}

describe("resolveEffectiveReviewConfiguration", () => {
  it("lets a repository override win over the workspace policy", async () => {
    const config = resolveReviewPolicy(workspacePolicyFixture, override);
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspacePolicyFixture), {
          repository_1: head(5, override),
        }),
      }),
    ).resolves.toEqual({
      status: "ready",
      version: 5,
      config,
      policy: override,
      source: "repository",
      workspaceVersion: 2,
      repositoryVersion: 5,
      effectivePolicyDigest: digest(config),
      revisionToken: `policy:2:5:${digest(config)}`,
    });
    expect(config.reviewLanguage).toBe("Russian");
  });

  it("inherits the workspace policy when the repository has no head", async () => {
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(head(2, workspacePolicyFixture)),
      }),
    ).resolves.toEqual({
      status: "ready",
      version: 2,
      config: workspacePolicyFixture,
      policy: workspacePolicyFixture,
      source: "workspace",
      workspaceVersion: 2,
      repositoryVersion: null,
      effectivePolicyDigest: digest(workspacePolicyFixture),
      revisionToken: `policy:2:0:${digest(workspacePolicyFixture)}`,
    });
  });

  it("reports a missing workspace policy even when a repository head remains", async () => {
    await expect(
      resolveEffectiveReviewConfiguration(repositoryTarget, {
        policyHeads: policyHeads(null, { repository_1: head(7, override) }),
      }),
    ).resolves.toEqual({
      status: "missing",
      workspaceVersion: null,
      repositoryVersion: 7,
    });
  });

  it.each([
    ["a retired workspace format", head(4, workspacePolicyFixture, 2), null],
    [
      "an unreadable workspace document",
      { version: 4, schemaVersion: 3, policyJson: "{" },
      null,
    ],
    [
      "a workspace head without a document",
      { version: 4, schemaVersion: 3, policyJson: null },
      null,
    ],
    [
      "a retired repository format",
      head(4, workspacePolicyFixture),
      head(9, override, 2),
    ],
    [
      "a repository override that no longer composes",
      head(4, workspacePolicyFixture),
      head(9, { schemaVersion: 3, execution: { providerLimit: 2 } }),
    ],
  ])(
    "requires a resave for %s and keeps both head versions",
    async (_case, workspace, repository) => {
      await expect(
        resolveEffectiveReviewConfiguration(repositoryTarget, {
          policyHeads: policyHeads(
            workspace,
            repository ? { repository_1: repository } : {},
          ),
        }),
      ).resolves.toEqual({
        status: "resave_required",
        workspaceVersion: 4,
        repositoryVersion: repository?.version ?? null,
      });
    },
  );

  it("maps the non-ready variants to the runtime error codes", async () => {
    await expect(
      resolveReviewRuntimeEnv(repositoryTarget, {
        policyHeads: policyHeads(null),
      }),
    ).rejects.toThrow("review_workspace_policy_required");
    await expect(
      resolveReviewRuntimeEnv(repositoryTarget, {
        policyHeads: policyHeads(head(4, workspacePolicyFixture, 2)),
      }),
    ).rejects.toThrow("review_policy_resave_required");
  });
});

describe("resolveEffectiveReviewConfigurations", () => {
  it("resolves every requested repository against one workspace head", async () => {
    const resolved = await resolveEffectiveReviewConfigurations(
      {
        workspaceId,
        repositoryIds: ["repository_2", "repository_1", "repository_2"],
      },
      {
        policyHeads: policyHeads(head(2, workspacePolicyFixture), {
          repository_1: head(5, override),
          repository_3: head(6, override, 2),
        }),
      },
    );

    expect(resolved.workspace).toMatchObject({
      status: "ready",
      source: "workspace",
      version: 2,
    });
    expect([...resolved.repositories.keys()]).toEqual([
      "repository_2",
      "repository_1",
    ]);
    expect(resolved.repositories.get("repository_2")).toEqual(
      resolved.workspace,
    );
    expect(resolved.repositories.get("repository_1")).toMatchObject({
      status: "ready",
      source: "repository",
      version: 5,
      workspaceVersion: 2,
    });
  });

  it("keeps repository head versions when the workspace is missing or retired", async () => {
    const repositories = { repository_1: head(5, override) };
    const missing = await resolveEffectiveReviewConfigurations(
      { workspaceId, repositoryIds: ["repository_1", "repository_2"] },
      { policyHeads: policyHeads(null, repositories) },
    );
    expect(missing.workspace).toEqual({
      status: "missing",
      workspaceVersion: null,
      repositoryVersion: null,
    });
    expect(missing.repositories.get("repository_1")).toEqual({
      status: "missing",
      workspaceVersion: null,
      repositoryVersion: 5,
    });

    const retired = await resolveEffectiveReviewConfigurations(
      { workspaceId, repositoryIds: ["repository_1"] },
      {
        policyHeads: policyHeads(
          head(3, workspacePolicyFixture, 2),
          repositories,
        ),
      },
    );
    expect(retired.repositories.get("repository_1")).toEqual({
      status: "resave_required",
      workspaceVersion: 3,
      repositoryVersion: 5,
    });
  });
});
