import { z } from "zod";
import type { ProviderRepositoryFacts } from "../../domain/provider-management-policy";
import { ProviderManagementDeniedError } from "../../domain/provider-management-policy";
import {
  defaultWorkspaceReviewPolicy,
  fitExecutionLimits,
  parseRepositoryReviewPolicy,
  parseWorkspaceReviewPolicy,
  reviewProviderSelectionSchema,
  withProviderSelections,
  type ReviewProviderSelection,
} from "../../domain/review-policy-document";
import type { ProviderProfileActor } from "../ports/workspace-provider-profile-repository-port";
import {
  isReviewConfigurationWriteConflictError,
  type ReviewConfigurationRepositoryPort,
  type ReviewPolicyHeadReaderPort,
  type SavedReviewPolicy,
} from "../ports/review-configuration-repository-port";
import {
  previewEffectiveReviewConfiguration,
  providerSelectionAuthority,
  type EffectiveReviewConfigurationValidatorPort,
  type ProviderSelectionDraft,
} from "./manage-provider-selections";
import {
  effectiveReviewPolicyDigest,
  parseStoredReviewPolicy,
} from "./resolve-effective-review-configuration";

/** Only these execution controls belong to the reviewer editor. Null is never a workspace value. */
export const reviewerExecutionPatchSchema = z
  .object({
    providerMaxParallel: z.number().int().min(1).max(16).optional(),
    inlineMinAgreement: z.number().int().min(1).max(16).optional(),
  })
  .strict();
export type ReviewerExecutionPatch = z.infer<
  typeof reviewerExecutionPatchSchema
>;
/** Repository null removes just that override and restores inheritance. */
export const repositoryReviewerExecutionPatchSchema = z
  .object({
    providerMaxParallel: z.number().int().min(1).max(16).nullable().optional(),
    inlineMinAgreement: z.number().int().min(1).max(16).nullable().optional(),
  })
  .strict();
export type RepositoryReviewerExecutionPatch = z.infer<
  typeof repositoryReviewerExecutionPatchSchema
>;

type Dependencies = Readonly<{
  configurations: ReviewConfigurationRepositoryPort;
  policyHeads: ReviewPolicyHeadReaderPort;
  validator: EffectiveReviewConfigurationValidatorPort;
}>;
type Roster = Readonly<{
  selections: readonly ReviewProviderSelection[];
  drafts?: readonly ProviderSelectionDraft[];
}>;

/** A displayed whole-list draft is written once against its observed version, never retried. */
export async function setWorkspaceDefaultProviders(
  input: Roster &
    Readonly<{
      workspaceId: string;
      actor: ProviderProfileActor;
      expectedVersion: number | null;
      executionPatch?: ReviewerExecutionPatch;
    }>,
  dependencies: Dependencies,
): Promise<SavedReviewPolicy> {
  return writeWorkspaceRoster(input, dependencies);
}

/** Explicitly clearing the default is also guarded by the displayed/current head. */
export function clearWorkspaceDefaultProviders(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    expectedVersion: number | null;
  }>,
  dependencies: Dependencies,
): Promise<SavedReviewPolicy> {
  return writeWorkspaceRoster({ ...input, selections: null }, dependencies);
}

async function writeWorkspaceRoster(
  input: Omit<Roster, "selections"> &
    Readonly<{
      selections: readonly ReviewProviderSelection[] | null;
      workspaceId: string;
      actor: ProviderProfileActor;
      expectedVersion: number | null;
      executionPatch?: ReviewerExecutionPatch;
    }>,
  dependencies: Dependencies,
): Promise<SavedReviewPolicy> {
  const { selections, drafts } =
    input.selections === null
      ? { selections: null, drafts: [] }
      : parseRoster({ ...input, selections: input.selections });

  const target = {
    scope: "workspace" as const,
    workspaceId: input.workspaceId,
  };
  const heads = await dependencies.policyHeads.readPolicyHeads(target);
  const current =
    (heads.workspace
      ? parseStoredReviewPolicy("workspace", heads.workspace)
      : null) ?? defaultWorkspaceReviewPolicy();
  const patch = reviewerExecutionPatchSchema.parse(input.executionPatch ?? {});
  const next = parseWorkspaceReviewPolicy(
    fitExecutionLimits(
      {
        ...withProviderSelections(current, selections),
        execution: { ...current.execution, ...patch },
      },
      selections?.length ?? 0,
    ),
  );
  const candidate = await previewEffectiveReviewConfiguration(
    {
      target,
      workspacePolicy: next,
      profiles: drafts.map((draft) => draft.profile),
    },
    dependencies,
  );
  if (candidate)
    await dependencies.validator.validate({ target, config: candidate.config });
  const [saved] = await dependencies.configurations.saveNextVersions({
    workspaceId: input.workspaceId,
    writes: [
      {
        target,
        policy: next,
        expectedVersion: input.expectedVersion,
        expectedEffectivePolicyDigest: candidate
          ? effectiveReviewPolicyDigest(candidate.config)
          : null,
      },
    ],
    selectionAuthority: providerSelectionAuthority({ actor: input.actor }),
    profileDrafts: drafts.map((draft) => draft.draft),
    audit: {
      actor: input.actor.auditActor,
      action: selections
        ? "provider_selection.default_set"
        : "provider_selection.default_cleared",
    },
  });
  return saved!;
}

export type ProviderRosterAssignment =
  | Readonly<{
      repositoryId: string;
      status: "applied";
      version: number;
      profileIds: readonly string[];
    }>
  | Readonly<{ repositoryId: string; status: "conflict" }>
  | Readonly<{
      repositoryId: string;
      status: "denied";
      reason: ProviderManagementDeniedError["reason"];
    }>
  | Readonly<{ repositoryId: string; status: "failed"; code: string }>;

/** Resolve every draft on the first successful assignment, and reuse all resulting IDs thereafter. */
export async function assignProviderSelectionsToRepositories(
  input: Roster &
    Readonly<{
      workspaceId: string;
      actor: ProviderProfileActor;
      expectedWorkspaceVersion: number | null;
      repositories: readonly (ProviderRepositoryFacts &
        Readonly<{ expectedVersion: number | null }>)[];
      executionPatch?: RepositoryReviewerExecutionPatch;
    }>,
  dependencies: Dependencies,
): Promise<readonly ProviderRosterAssignment[]> {
  let { selections, drafts } = parseRoster(input);
  const results: ProviderRosterAssignment[] = [];
  let expectedWorkspaceVersion = input.expectedWorkspaceVersion;
  for (const repository of input.repositories) {
    try {
      const saved = await saveRepositoryRoster(
        { ...input, expectedWorkspaceVersion, repository, selections, drafts },
        dependencies,
      );
      const resolved = saved.configuration?.selections;
      if (!resolved || resolved.length !== selections.length)
        throw new Error("provider_selection_draft_mismatch");
      selections = resolved.map((selection) => ({ ...selection }));
      drafts = [];
      expectedWorkspaceVersion =
        saved.configuration?.workspaceVersion ?? expectedWorkspaceVersion;
      results.push({
        repositoryId: repository.repositoryId,
        status: "applied",
        version: saved.version,
        profileIds: resolved.map((selection) => selection.profileId),
      });
    } catch (error) {
      results.push(
        isReviewConfigurationWriteConflictError(error)
          ? { repositoryId: repository.repositoryId, status: "conflict" }
          : error instanceof ProviderManagementDeniedError
            ? {
                repositoryId: repository.repositoryId,
                status: "denied",
                reason: error.reason,
              }
            : {
                repositoryId: repository.repositoryId,
                status: "failed",
                code:
                  error instanceof Error
                    ? error.message
                    : "provider_selection_failed",
              },
      );
    }
  }
  return results;
}

/** Remove the complete repository roster; retain unrelated settings and explicit execution requirements. */
export function clearRepositoryProviderSelections(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    repository: ProviderRepositoryFacts &
      Readonly<{ expectedVersion: number | null }>;
    expectedWorkspaceVersion: number | null;
  }>,
  dependencies: Dependencies,
): Promise<SavedReviewPolicy> {
  return saveRepositoryRoster(
    { ...input, selections: null, drafts: [] },
    dependencies,
  );
}

async function saveRepositoryRoster(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    repository: ProviderRepositoryFacts &
      Readonly<{ expectedVersion: number | null }>;
    expectedWorkspaceVersion: number | null;
    selections: readonly ReviewProviderSelection[] | null;
    drafts: readonly ProviderSelectionDraft[];
    executionPatch?: RepositoryReviewerExecutionPatch;
  }>,
  dependencies: Dependencies,
): Promise<SavedReviewPolicy> {
  const target = {
    scope: "repository" as const,
    workspaceId: input.workspaceId,
    repositoryId: input.repository.repositoryId,
  };
  const heads = await dependencies.policyHeads.readPolicyHeads(target);
  const workspace = heads.workspace
    ? parseStoredReviewPolicy("workspace", heads.workspace)
    : defaultWorkspaceReviewPolicy();
  if (!workspace) throw new Error("review_workspace_policy_retired");
  const current =
    (heads.repository
      ? parseStoredReviewPolicy("repository", heads.repository)
      : null) ?? parseRepositoryReviewPolicy({ schemaVersion: 4 });
  const { providers: _providers, ...rest } = current;
  void _providers;
  const execution = { ...current.execution };
  const patch = repositoryReviewerExecutionPatchSchema.parse(
    input.executionPatch ?? {},
  );
  for (const key of ["providerMaxParallel", "inlineMinAgreement"] as const) {
    const value = patch[key];
    if (value === null) delete execution[key];
    else if (value !== undefined) execution[key] = value;
  }
  const next = parseRepositoryReviewPolicy(
    fitExecutionLimits(
      {
        ...rest,
        ...(input.selections ? { providers: [...input.selections] } : {}),
        ...(Object.keys(execution).length
          ? { execution }
          : { execution: undefined }),
      },
      input.selections?.length ?? workspace.providers?.length ?? 0,
    ),
  );
  const candidate = await previewEffectiveReviewConfiguration(
    {
      target,
      workspacePolicy: workspace,
      repositoryPolicy: next,
      profiles: input.drafts.map((draft) => draft.profile),
    },
    dependencies,
  );
  if (candidate)
    await dependencies.validator.validate({ target, config: candidate.config });
  const saved = await dependencies.configurations.saveNextVersions({
    workspaceId: input.workspaceId,
    expectedWorkspaceVersion: input.expectedWorkspaceVersion,
    writes: [
      ...(!heads.workspace
        ? [
            {
              target: {
                scope: "workspace" as const,
                workspaceId: input.workspaceId,
              },
              policy: workspace,
              expectedVersion: null,
              implicit: true,
            },
          ]
        : []),
      {
        target,
        policy: next,
        expectedVersion: input.repository.expectedVersion,
        expectedEffectivePolicyDigest: candidate
          ? effectiveReviewPolicyDigest(candidate.config)
          : null,
      },
    ],
    selectionAuthority: providerSelectionAuthority({
      actor: input.actor,
      repositoryCapability: input.repository.capability,
    }),
    profileDrafts: input.drafts.map((draft) => draft.draft),
    audit: {
      actor: input.actor.auditActor,
      action: input.selections
        ? "provider_selection.assigned"
        : "provider_selection.cleared",
    },
  });
  return saved.at(-1)!;
}

function parseRoster(input: Roster): {
  selections: ReviewProviderSelection[];
  drafts: ProviderSelectionDraft[];
} {
  const selections = parseRepositoryReviewPolicy({
    schemaVersion: 4,
    providers: input.selections,
  }).providers!;
  const drafts = [...(input.drafts ?? [])];
  const seen = new Set<string>();
  for (const draft of drafts) {
    const id = draft.draft.draftId;
    if (
      seen.has(id) ||
      draft.profile.id !== id ||
      !selections.some((selection) => selection.profileId === id)
    )
      throw new Error("provider_selection_draft_mismatch");
    seen.add(id);
  }
  return {
    selections: selections.map((selection) =>
      reviewProviderSelectionSchema.parse(selection),
    ),
    drafts,
  };
}
