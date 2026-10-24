import type { ReviewConfiguration } from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import {
  assertProviderManagementAllowed,
  ProviderManagementDeniedError,
  type ProviderRepositoryCapability,
  type ProviderRepositoryFacts,
  type ProviderManagementDenialReason,
} from "../../domain/provider-management-policy";
import {
  defaultWorkspaceReviewPolicy,
  parseRepositoryReviewPolicy,
  reviewProviderSelectionSchema,
  resolveEffectiveReviewPolicy,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  withProviderSelections,
  type EffectiveReviewPolicy,
  type RepositoryReviewPolicy,
  type ReviewProviderSelection,
  type WorkspaceReviewPolicy,
} from "../../domain/review-policy-document";
import type { WorkspaceProviderProfile } from "../../domain/workspace-provider-profile";
import {
  isReviewConfigurationWriteConflictError,
  type ProviderProfileDraft,
  type ProviderSelectionAuthority,
  type ReviewConfigurationRepositoryPort,
  type ReviewPolicyHeadReaderPort,
  type ReviewPolicyWrite,
  type SavedReviewPolicy,
} from "../ports/review-configuration-repository-port";
import type { ProviderProfileActor } from "../ports/workspace-provider-profile-repository-port";
import {
  effectiveReviewPolicyDigest,
  parseStoredReviewPolicy,
} from "./resolve-effective-review-configuration";

/**
 * Environment and network checks of a candidate effective configuration,
 * run before the write: context tools, the Gateway catalog, engine profiles,
 * rotating availability and similar caller-owned rules. The write then
 * refuses any other result than the validated one.
 */
export interface EffectiveReviewConfigurationValidatorPort {
  validate(
    candidate: Readonly<{
      target: ReviewConfigurationTarget;
      config: ReviewConfiguration;
    }>,
  ): Promise<void>;
}

type SelectionDependencies = Readonly<{
  configurations: ReviewConfigurationRepositoryPort;
  policyHeads: ReviewPolicyHeadReaderPort;
  validator?: EffectiveReviewConfigurationValidatorPort;
}>;

/** One provider selection without its profile, as a request supplies it. */
export type ProviderSelectionSettings = Omit<
  ReviewProviderSelection,
  "profileId"
>;

const MAX_SELECTION_ATTEMPTS = 3;

/**
 * The selection authority of a signed-in actor: every change of a stored
 * selection is decided by the provider management policy with the facts the
 * write reads under its locks. `repositoryCapability` is the actor's verified
 * capability on the repository target (ignored for the workspace).
 */
export function providerSelectionAuthority(input: {
  readonly actor: ProviderProfileActor;
  readonly repositoryCapability?: ProviderRepositoryCapability | null;
}): ProviderSelectionAuthority {
  return {
    userId: input.actor.userId,
    auditActor: input.actor.auditActor,
    ...(input.actor.localAdminOverride === undefined
      ? {}
      : { localAdminOverride: input.actor.localAdminOverride }),
    authorize: ({ actor, workspace, target, profiles }) => {
      if (target.scope === "workspace") {
        if (profiles.length === 0)
          assertProviderManagementAllowed({
            actor,
            workspace,
            action: { kind: "clear_default" },
          });
        for (const profile of profiles) {
          if (profile.draft)
            assertProviderManagementAllowed({
              actor,
              workspace,
              action: { kind: "create_profile", profile },
            });
          assertProviderManagementAllowed({
            actor,
            workspace,
            action: { kind: "set_default", profile },
          });
        }
        return;
      }
      const repository: ProviderRepositoryFacts = {
        repositoryId: target.repositoryId,
        capability: input.repositoryCapability ?? null,
      };
      if (profiles.length === 0)
        assertProviderManagementAllowed({
          actor,
          workspace,
          action: { kind: "clear_selection", repository },
        });
      for (const profile of profiles)
        assertProviderManagementAllowed({
          actor,
          workspace,
          action: profile.draft
            ? {
                kind: "create_and_attach",
                profile,
                repository,
                managedKeyApplied: profile.managedKeyApplied,
              }
            : {
                kind: "attach_profile",
                profile,
                repository,
                managedKeyApplied: profile.managedKeyApplied,
              },
        });
    },
  };
}

/**
 * The effective configuration a target would have with replaced stored
 * documents or profiles, for validation before a write. A workspace without
 * a document resolves with the built-in settings the write would create.
 * Returns null when no provider would be selected; throws when the result is
 * invalid or a kept stored document is unreadable.
 */
export async function previewEffectiveReviewConfiguration(
  input: Readonly<{
    target: ReviewConfigurationTarget;
    workspacePolicy?: WorkspaceReviewPolicy;
    /** Replaces the stored repository document; null removes it. */
    repositoryPolicy?: RepositoryReviewPolicy | null;
    /** Profiles not stored yet, or stored ones with pending changes. */
    profiles?: readonly WorkspaceProviderProfile[];
  }>,
  dependencies: Readonly<{ policyHeads: ReviewPolicyHeadReaderPort }>,
): Promise<EffectiveReviewPolicy | null> {
  const { target } = input;
  const heads = await dependencies.policyHeads.readPolicyHeads(target);
  const workspace =
    input.workspacePolicy ??
    (heads.workspace
      ? requireCurrent(parseStoredReviewPolicy("workspace", heads.workspace))
      : defaultWorkspaceReviewPolicy());
  const repository =
    target.scope !== "repository"
      ? null
      : input.repositoryPolicy !== undefined
        ? input.repositoryPolicy
        : heads.repository
          ? requireCurrent(
              parseStoredReviewPolicy("repository", heads.repository),
            )
          : null;
  const supplied = new Map(
    (input.profiles ?? []).map((profile) => [profile.id, profile] as const),
  );
  const missing = [
    ...(workspace.providers ?? []),
    ...(repository?.providers ?? []),
  ]
    .map((selection) => selection.profileId)
    .filter((id) => !supplied.has(id) && !heads.profiles.has(id));
  const loaded = missing.length
    ? await dependencies.policyHeads.readProviderProfiles({
        workspaceId: target.workspaceId,
        profileIds: missing,
      })
    : new Map<string, WorkspaceProviderProfile>();
  return resolveEffectiveReviewPolicy({
    target,
    workspace,
    repository,
    profiles: new Map([...heads.profiles, ...loaded, ...supplied]),
  });
}

/**
 * Sets or clears the workspace default (owner/admin). Creates the workspace
 * document with built-in settings when none exists. Repositories without a
 * selection of their own follow the new default.
 */
export async function setWorkspaceDefaultProvider(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    /** Null clears the default. */
    selection: ReviewProviderSelection | null;
  }>,
  dependencies: SelectionDependencies,
) {
  const selection = input.selection
    ? reviewProviderSelectionSchema.parse(input.selection)
    : null;
  const target = {
    scope: "workspace" as const,
    workspaceId: input.workspaceId,
  };
  return withSelectionRetry(async () => {
    const heads = await dependencies.policyHeads.readPolicyHeads(target);
    const current = heads.workspace
      ? requireCurrent(parseStoredReviewPolicy("workspace", heads.workspace))
      : defaultWorkspaceReviewPolicy();
    const next = withProviderSelections(
      current,
      selection ? [selection] : null,
    );
    const [saved] = await dependencies.configurations.saveNextVersions({
      workspaceId: input.workspaceId,
      writes: [
        {
          target,
          policy: next,
          expectedVersion: heads.workspace?.version ?? null,
          ...(await validated(target, { workspacePolicy: next }, dependencies)),
        },
      ],
      selectionAuthority: providerSelectionAuthority({ actor: input.actor }),
      audit: {
        actor: input.actor.auditActor,
        action: selection
          ? "provider_selection.default_set"
          : "provider_selection.default_cleared",
        metadata: selection ? { profileId: selection.profileId } : {},
      },
    });
    return saved!;
  });
}

/**
 * Saves a repository document submitted by a form. A workspace without a
 * document gets one with built-in settings and no default in the same
 * transaction, so selecting a provider never needs workspace settings first.
 */
export async function saveRepositoryReviewPolicy(
  input: Readonly<{
    target: Extract<ReviewConfigurationTarget, { scope: "repository" }>;
    policy: RepositoryReviewPolicy;
    expectedVersion: number | null;
    expectedEffectivePolicyDigest?: string | null;
    selectionAuthority?: ProviderSelectionAuthority;
    profileDrafts?: readonly ProviderProfileDraft[];
  }>,
  dependencies: Pick<SelectionDependencies, "configurations" | "policyHeads">,
): Promise<SavedReviewPolicy> {
  const heads = await dependencies.policyHeads.readPolicyHeads(input.target);
  const saved = await dependencies.configurations.saveNextVersions({
    workspaceId: input.target.workspaceId,
    writes: [
      ...(heads.workspace
        ? []
        : [
            {
              target: {
                scope: "workspace" as const,
                workspaceId: input.target.workspaceId,
              },
              policy: defaultWorkspaceReviewPolicy(),
              expectedVersion: null,
            },
          ]),
      {
        target: input.target,
        policy: input.policy,
        expectedVersion: input.expectedVersion,
        ...(input.expectedEffectivePolicyDigest === undefined
          ? {}
          : {
              expectedEffectivePolicyDigest:
                input.expectedEffectivePolicyDigest,
            }),
      },
    ],
    ...(input.selectionAuthority
      ? { selectionAuthority: input.selectionAuthority }
      : {}),
    ...(input.profileDrafts ? { profileDrafts: input.profileDrafts } : {}),
  });
  return saved.at(-1)!;
}

export type ProviderSelectionAssignment =
  | Readonly<{ repositoryId: string; status: "applied"; version: number }>
  | Readonly<{
      repositoryId: string;
      status: "denied";
      reason: ProviderManagementDenialReason;
    }>
  | Readonly<{ repositoryId: string; status: "conflict" }>
  | Readonly<{ repositoryId: string; status: "failed"; code: string }>;

/**
 * Attaches one existing workspace profile to each repository, in one
 * transaction per repository. Never changes the workspace default; the
 * first attach of a workspace without a document creates it with built-in
 * settings and no default in the same transaction.
 */
export async function assignProviderProfileToRepositories(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    profileId: string;
    settings: ProviderSelectionSettings;
    /** Verified capability of the actor on each repository. */
    repositories: readonly ProviderRepositoryFacts[];
  }>,
  dependencies: SelectionDependencies,
): Promise<readonly ProviderSelectionAssignment[]> {
  const selection = reviewProviderSelectionSchema.parse({
    ...input.settings,
    profileId: input.profileId,
  });
  const results: ProviderSelectionAssignment[] = [];
  for (const repository of input.repositories)
    results.push(
      await assignmentResult(repository.repositoryId, () =>
        saveRepositorySelection(
          {
            workspaceId: input.workspaceId,
            actor: input.actor,
            repository,
            selections: [selection],
          },
          dependencies,
        ),
      ),
    );
  return results;
}

/**
 * Removes the repository's own selection so it follows the workspace
 * default again. Its other repository settings stay.
 */
export async function clearRepositoryProviderSelection(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    repository: ProviderRepositoryFacts;
  }>,
  dependencies: SelectionDependencies,
) {
  return saveRepositorySelection({ ...input, selections: null }, dependencies);
}

async function saveRepositorySelection(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    repository: ProviderRepositoryFacts;
    selections: readonly ReviewProviderSelection[] | null;
  }>,
  dependencies: SelectionDependencies,
) {
  const target = {
    scope: "repository" as const,
    workspaceId: input.workspaceId,
    repositoryId: input.repository.repositoryId,
  };
  return withSelectionRetry(async () => {
    const heads = await dependencies.policyHeads.readPolicyHeads(target);
    const workspace = heads.workspace
      ? requireCurrent(parseStoredReviewPolicy("workspace", heads.workspace))
      : null;
    const current = heads.repository
      ? requireCurrent(parseStoredReviewPolicy("repository", heads.repository))
      : parseRepositoryReviewPolicy({
          schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
        });
    const next = withProviderSelections(current, input.selections);
    const writes: ReviewPolicyWrite[] = [];
    // The first attach creates the workspace document, never a default.
    if (!workspace)
      writes.push({
        target: { scope: "workspace", workspaceId: input.workspaceId },
        policy: defaultWorkspaceReviewPolicy(),
        expectedVersion: null,
      });
    writes.push({
      target,
      policy: next,
      expectedVersion: heads.repository?.version ?? null,
      ...(await validated(
        target,
        {
          ...(workspace
            ? {}
            : { workspacePolicy: defaultWorkspaceReviewPolicy() }),
          repositoryPolicy: next,
        },
        dependencies,
      )),
    });
    const saved = await dependencies.configurations.saveNextVersions({
      workspaceId: input.workspaceId,
      writes,
      selectionAuthority: providerSelectionAuthority({
        actor: input.actor,
        repositoryCapability: input.repository.capability,
      }),
      audit: {
        actor: input.actor.auditActor,
        action: input.selections
          ? "provider_selection.assigned"
          : "provider_selection.cleared",
        metadata: input.selections
          ? { profileId: input.selections[0]!.profileId }
          : {},
      },
    });
    return saved.at(-1)!;
  });
}

/** The validated digest a write must reproduce, when a validator runs. */
async function validated(
  target: ReviewConfigurationTarget,
  replacement: Pick<
    Parameters<typeof previewEffectiveReviewConfiguration>[0],
    "workspacePolicy" | "repositoryPolicy"
  >,
  dependencies: SelectionDependencies,
): Promise<{ readonly expectedEffectivePolicyDigest?: string | null }> {
  if (!dependencies.validator) return {};
  const candidate = await previewEffectiveReviewConfiguration(
    { target, ...replacement },
    dependencies,
  );
  if (!candidate) return { expectedEffectivePolicyDigest: null };
  await dependencies.validator.validate({ target, config: candidate.config });
  return {
    expectedEffectivePolicyDigest: effectiveReviewPolicyDigest(
      candidate.config,
    ),
  };
}

async function withSelectionRetry<Result>(
  run: () => Promise<Result>,
): Promise<Result> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      // A concurrent write moved a head after it was read: read again.
      if (
        !isReviewConfigurationWriteConflictError(error) ||
        attempt === MAX_SELECTION_ATTEMPTS
      )
        throw error;
    }
  }
}

async function assignmentResult(
  repositoryId: string,
  run: () => Promise<{ readonly version: number }>,
): Promise<ProviderSelectionAssignment> {
  try {
    return { repositoryId, status: "applied", version: (await run()).version };
  } catch (error) {
    if (error instanceof ProviderManagementDeniedError)
      return { repositoryId, status: "denied", reason: error.reason };
    if (isReviewConfigurationWriteConflictError(error))
      return { repositoryId, status: "conflict" };
    const code =
      error instanceof Error && /^[a-z][a-z0-9_]{3,63}$/.test(error.message)
        ? error.message
        : "provider_selection_failed";
    return { repositoryId, status: "failed", code };
  }
}

function requireCurrent<Document>(document: Document | null): Document {
  if (!document) throw new Error("review_policy_resave_required");
  return document;
}
