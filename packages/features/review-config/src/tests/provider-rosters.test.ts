import { describe, expect, it, vi } from "vitest";
import {
  assignProviderSelectionsToRepositories,
  clearRepositoryProviderSelections,
  clearWorkspaceDefaultProviders,
  setWorkspaceDefaultProviders,
} from "../application/use-cases/manage-provider-rosters";
import type { ProviderSelectionDraft } from "../application/use-cases/manage-provider-selections";
import {
  ReviewConfigurationWriteConflictError,
  type ReviewConfigurationRepositoryPort,
  type SavedReviewPolicy,
} from "../application/ports/review-configuration-repository-port";
import {
  defaultWorkspaceReviewPolicy,
  parseWorkspaceReviewPolicy,
} from "../domain/review-policy-document";
import { InMemoryReviewConfigurationRepository } from "./in-memory-review-configuration";
import { providerProfileFixture } from "./current-policy-fixture";

const actor = { userId: "owner", auditActor: "user:owner" };
const selection = (profileId: string, requiredHealthy = true) => ({
  profileId,
  reasoningEffort: "high" as const,
  agenticContext: true,
  fastMode: false,
  requiredHealthy,
});
const profiles = ["one", "two", "three"].map((id, index) =>
  providerProfileFixture({
    id,
    model: `gpt-5.${index + 3}`,
    credential: {
      kind: "hosted_pool",
      authMode: "codex_subscription_oauth_hosted_pool",
    },
  }),
);
async function fixture() {
  const store = new InMemoryReviewConfigurationRepository();
  profiles.forEach((profile) => store.addProfile(profile));
  await store.saveNextVersions({
    workspaceId: "w",
    writes: [
      {
        target: { scope: "workspace", workspaceId: "w" },
        policy: {
          ...defaultWorkspaceReviewPolicy(),
          providers: [selection("one")],
        },
      },
    ],
  });
  const save = vi.fn(
    async (
      input: Parameters<
        ReviewConfigurationRepositoryPort["saveNextVersions"]
      >[0],
    ) =>
      store.saveNextVersions({
        workspaceId: input.workspaceId,
        writes: input.writes,
      }),
  );
  const dependencies = {
    configurations: {
      ...store,
      saveNextVersions: save,
    } as unknown as ReviewConfigurationRepositoryPort,
    policyHeads: store,
    validator: { validate: vi.fn(async () => {}) },
  };
  return { store, save, dependencies };
}

describe("whole reviewer roster writes", () => {
  it("saves two reviewers and parallelism atomically while preserving requiredness", async () => {
    const { save, dependencies } = await fixture();
    const saved = await setWorkspaceDefaultProviders(
      {
        workspaceId: "w",
        actor,
        selections: [selection("one", false), selection("two")],
        executionPatch: { providerMaxParallel: 2 },
        expectedVersion: 1,
      },
      dependencies,
    );
    expect(saved.configuration?.config.execution).toEqual({
      providerLimit: 2,
      providerMaxParallel: 2,
      inlineMinAgreement: 1,
    });
    expect(
      saved.configuration?.selections.map((row) => row.requiredHealthy),
    ).toEqual([false, true]);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("does not raise saved parallelism just because a reviewer is added", async () => {
    const { dependencies } = await fixture();
    const saved = await setWorkspaceDefaultProviders(
      {
        workspaceId: "w",
        actor,
        selections: [selection("one"), selection("two")],
        expectedVersion: 1,
      },
      dependencies,
    );
    expect(saved.configuration?.config.execution.providerMaxParallel).toBe(1);
  });

  it("preserves repository agreement inheritance and unrelated overrides", async () => {
    const { store, save, dependencies } = await fixture();
    await store.saveNextVersions({
      workspaceId: "w",
      writes: [
        {
          target: { scope: "repository", workspaceId: "w", repositoryId: "r" },
          policy: { schemaVersion: 4, reviewLanguage: "fr" },
        },
      ],
    });
    const result = await assignProviderSelectionsToRepositories(
      {
        workspaceId: "w",
        actor,
        selections: [selection("one"), selection("two")],
        expectedWorkspaceVersion: 1,
        repositories: [
          {
            repositoryId: "r",
            capability: "direct_config",
            expectedVersion: 1,
          },
        ],
        executionPatch: { providerMaxParallel: 2 },
      },
      dependencies,
    );
    expect(result[0]?.status).toBe("applied");
    const write = save.mock.calls[0]![0];
    expect(write.expectedWorkspaceVersion).toBe(1);
    expect(write.writes.at(-1)?.policy).toMatchObject({
      reviewLanguage: "fr",
      execution: { providerMaxParallel: 2 },
    });
    expect(write.writes.at(-1)?.policy.execution).not.toHaveProperty(
      "inlineMinAgreement",
    );
  });

  it("restores the entire inherited roster and keeps unrelated repository settings", async () => {
    const { store, dependencies } = await fixture();
    await setWorkspaceDefaultProviders(
      {
        workspaceId: "w",
        actor,
        selections: [selection("one"), selection("two")],
        expectedVersion: 1,
      },
      dependencies,
    );
    await store.saveNextVersions({
      workspaceId: "w",
      writes: [
        {
          target: { scope: "repository", workspaceId: "w", repositoryId: "r" },
          policy: {
            schemaVersion: 4,
            providers: [selection("three")],
            reviewLanguage: "fr",
          },
        },
      ],
    });
    const saved = await clearRepositoryProviderSelections(
      {
        workspaceId: "w",
        actor,
        expectedWorkspaceVersion: 2,
        repository: {
          repositoryId: "r",
          capability: "direct_config",
          expectedVersion: 1,
        },
      },
      dependencies,
    );
    expect(saved.configuration?.selections.map((row) => row.profileId)).toEqual(
      ["one", "two"],
    );
    expect(saved.configuration?.policy).toMatchObject({ reviewLanguage: "fr" });
    expect(saved.configuration?.policy).not.toHaveProperty("providers");
  });

  it("never retries a stale whole-list write or changes either roster/settings", async () => {
    const { store, save, dependencies } = await fixture();
    await expect(
      setWorkspaceDefaultProviders(
        {
          workspaceId: "w",
          actor,
          selections: [selection("two"), selection("three")],
          executionPatch: { providerMaxParallel: 2 },
          expectedVersion: null,
        },
        dependencies,
      ),
    ).rejects.toThrow(ReviewConfigurationWriteConflictError);
    expect(save).toHaveBeenCalledTimes(1);
    const current = await store.findLatest({
      scope: "workspace",
      workspaceId: "w",
    });
    expect(current?.selections.map((row) => row.profileId)).toEqual(["one"]);
    expect(current?.config.execution.providerMaxParallel).toBe(1);
  });

  it("clears only the observed default and refuses a last-row removal racing a newer roster", async () => {
    const { store, save, dependencies } = await fixture();
    const newer = await setWorkspaceDefaultProviders(
      {
        workspaceId: "w",
        actor,
        selections: [selection("one"), selection("two")],
        expectedVersion: 1,
      },
      dependencies,
    );
    await expect(
      clearWorkspaceDefaultProviders(
        { workspaceId: "w", actor, expectedVersion: 1 },
        dependencies,
      ),
    ).rejects.toThrow(ReviewConfigurationWriteConflictError);
    expect(
      (await store.findLatest({ scope: "workspace", workspaceId: "w" }))
        ?.selections,
    ).toHaveLength(2);
    expect(save).toHaveBeenCalledTimes(2);
    const cleared = await clearWorkspaceDefaultProviders(
      { workspaceId: "w", actor, expectedVersion: newer.version },
      dependencies,
    );
    expect(cleared.configuration).toBeNull();
  });

  it("rejects empty/oversize/duplicate rosters and nullable workspace execution", async () => {
    const { save, dependencies } = await fixture();
    for (const selections of [
      [],
      Array.from({ length: 17 }, () => selection("one")),
      [selection("one"), selection("one")],
    ]) {
      await expect(
        setWorkspaceDefaultProviders(
          { workspaceId: "w", actor, selections, expectedVersion: 1 },
          dependencies,
        ),
      ).rejects.toThrow();
    }
    await expect(
      setWorkspaceDefaultProviders(
        {
          workspaceId: "w",
          actor,
          selections: [selection("one")],
          expectedVersion: 1,
          executionPatch: { providerMaxParallel: null } as never,
        },
        dependencies,
      ),
    ).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
    expect(
      parseWorkspaceReviewPolicy({
        ...defaultWorkspaceReviewPolicy(),
        providers: Array.from({ length: 16 }, (_, index) =>
          selection(`p-${index}`),
        ),
      }).providers,
    ).toHaveLength(16);
  });

  it("remaps every draft after the first successful bulk assignment", async () => {
    const { store, save, dependencies } = await fixture();
    const drafts: ProviderSelectionDraft[] = ["one", "two"].map((id) => ({
      draft: {
        draftId: `draft-${id}`,
        credential: { kind: "hosted_pool" },
        model: profiles.find((row) => row.id === id)!.model,
        label: null,
      },
      profile: { ...profiles.find((row) => row.id === id)!, id: `draft-${id}` },
    }));
    save.mockImplementation(async (input) => {
      const writes = input.writes.map((write) => {
        const { expectedEffectivePolicyDigest: _digest, ...rest } = write;
        void _digest;
        return {
          ...rest,
          policy: {
            ...write.policy,
            providers: write.policy.providers?.map((row) => ({
              ...row,
              profileId: row.profileId.replace("draft-", ""),
            })),
          },
        };
      });
      return store.saveNextVersions({
        workspaceId: input.workspaceId,
        writes,
      }) as Promise<readonly SavedReviewPolicy[]>;
    });
    const result = await assignProviderSelectionsToRepositories(
      {
        workspaceId: "w",
        actor,
        expectedWorkspaceVersion: 1,
        selections: [selection("draft-one"), selection("draft-two")],
        drafts,
        repositories: ["a", "b"].map((repositoryId) => ({
          repositoryId,
          capability: "direct_config",
          expectedVersion: null,
        })),
      },
      dependencies,
    );
    expect(result.map((row) => row.status)).toEqual(["applied", "applied"]);
    expect(save.mock.calls[0]![0].profileDrafts).toHaveLength(2);
    expect(save.mock.calls[1]![0].profileDrafts).toHaveLength(0);
    expect(
      save.mock.calls[1]![0].writes.at(-1)?.policy.providers?.map(
        (row) => row.profileId,
      ),
    ).toEqual(["one", "two"]);
  });
});
