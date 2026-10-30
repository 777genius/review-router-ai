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
  fitExecutionLimits,
  parseRepositoryReviewPolicy,
  parseWorkspaceReviewPolicy,
  reviewProviderSelectionSchema,
  resolveEffectiveReviewPolicy,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  withProviderSelections,
  type EffectiveReviewPolicy,
  type RepositoryReviewPolicy,
  type RepositoryReviewSettings,
  type ReviewProviderSelection,
  type WorkspaceReviewPolicy,
  type WorkspaceReviewSettings,
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

/**
 * Every signed-in selection write validates its candidate with the caller's
 * checks and then requires the write to materialize exactly that result.
 */
type SelectionDependencies = Readonly<{
  configurations: ReviewConfigurationRepositoryPort;
  policyHeads: ReviewPolicyHeadReaderPort;
  validator: EffectiveReviewConfigurationValidatorPort;
}>;

/** One provider selection without its profile, as a request supplies it. */
export type ProviderSelectionSettings = Omit<
  ReviewProviderSelection,
  "profileId"
>;

/**
 * A provider a selection write creates (or finds by its identity) together
 * with the selection naming it by `draft.draftId`. `profile` is the in-memory
 * profile the draft resolves to, so the candidate configuration is validated
 * before the write; the write itself resolves the stored references again.
 */
export type ProviderSelectionDraft = Readonly<{
  draft: ProviderProfileDraft;
  profile: WorkspaceProviderProfile;
}>;

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
 * document with built-in settings when none exists or the stored one is in a
 * retired format (it cannot be read, so nothing of it is kept). Repositories
 * without a selection of their own follow the new default.
 */
export async function setWorkspaceDefaultProvider(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    /** Null clears the default. */
    selection: ReviewProviderSelection | null;
    /** A new provider the selection names by its draft ID. */
    draft?: ProviderSelectionDraft;
  }>,
  dependencies: SelectionDependencies,
) {
  const selection = input.selection
    ? reviewProviderSelectionSchema.parse(input.selection)
    : null;
  const draft = draftFor(selection, input.draft);
  const target = {
    scope: "workspace" as const,
    workspaceId: input.workspaceId,
  };
  return withSelectionRetry(async () => {
    const heads = await dependencies.policyHeads.readPolicyHeads(target);
    const current =
      (heads.workspace
        ? parseStoredReviewPolicy("workspace", heads.workspace)
        : null) ?? defaultWorkspaceReviewPolicy();
    const next = selection
      ? fitExecutionLimits(withProviderSelections(current, [selection]), 1)
      : withProviderSelections(current, null);
    const [saved] = await dependencies.configurations.saveNextVersions({
      workspaceId: input.workspaceId,
      writes: [
        {
          target,
          policy: next,
          expectedVersion: heads.workspace?.version ?? null,
          ...(await validated(
            target,
            {
              workspacePolicy: next,
              ...(draft ? { profiles: [draft.profile] } : {}),
            },
            dependencies,
          )),
        },
      ],
      selectionAuthority: providerSelectionAuthority({ actor: input.actor }),
      ...(draft ? { profileDrafts: [draft.draft] } : {}),
      audit: {
        actor: input.actor.auditActor,
        action: selection
          ? "provider_selection.default_set"
          : "provider_selection.default_cleared",
        metadata: selection && !draft ? { profileId: selection.profileId } : {},
      },
    });
    return saved!;
  });
}

/**
 * Saves the workspace settings of the Models form. The stored default
 * provider stays as it is, so a form opened before a default change never
 * reverts it; a workspace without a document gets one, and a retired document
 * is replaced (its selection cannot be read, so none is kept).
 */
export async function saveWorkspaceReviewSettings(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    settings: WorkspaceReviewSettings;
    /** The version the form was opened with; null when there was none. */
    expectedVersion: number | null;
    /** Trusted caller access facts, without policy values or credentials. */
    auditMetadata?: Readonly<Record<string, unknown>>;
  }>,
  dependencies: SelectionDependencies,
): Promise<SavedReviewPolicy> {
  const target = {
    scope: "workspace" as const,
    workspaceId: input.workspaceId,
  };
  const heads = await dependencies.policyHeads.readPolicyHeads(target);
  const current = heads.workspace
    ? parseStoredReviewPolicy("workspace", heads.workspace)
    : null;
  const next = withProviderSelections(
    parseWorkspaceReviewPolicy({
      ...input.settings,
      schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    }),
    current?.providers ?? null,
  );
  const [saved] = await dependencies.configurations.saveNextVersions({
    workspaceId: input.workspaceId,
    writes: [
      {
        target,
        policy: next,
        expectedVersion: input.expectedVersion,
        ...(await validated(target, { workspacePolicy: next }, dependencies)),
      },
    ],
    selectionAuthority: providerSelectionAuthority({ actor: input.actor }),
    audit: {
      actor: input.actor.auditActor,
      action: "review_config.saved",
      ...(input.auditMetadata ? { metadata: input.auditMetadata } : {}),
      metadataForSavedConfiguration: savedReviewSettingsAuditMetadata,
    },
  });
  return saved!;
}

/**
 * Saves the repository overrides of its settings form; an empty set removes
 * them all. The repository's own provider selection stays as it is, and a
 * retired document is replaced, so the repository then follows the default.
 * A workspace without a document gets one with built-in settings and no
 * default in the same transaction.
 */
export async function saveRepositoryReviewSettings(
  input: Readonly<{
    workspaceId: string;
    actor: ProviderProfileActor;
    repository: ProviderRepositoryFacts;
    settings: RepositoryReviewSettings;
    /** The version the form was opened with; null when there was none. */
    expectedVersion: number | null;
    /** Trusted caller access and repository identity facts. */
    auditMetadata?: Readonly<Record<string, unknown>>;
  }>,
  dependencies: SelectionDependencies,
): Promise<SavedReviewPolicy> {
  const target = {
    scope: "repository" as const,
    workspaceId: input.workspaceId,
    repositoryId: input.repository.repositoryId,
  };
  const heads = await dependencies.policyHeads.readPolicyHeads(target);
  const workspace = heads.workspace
    ? requireCurrent(parseStoredReviewPolicy("workspace", heads.workspace))
    : null;
  const current = heads.repository
    ? parseStoredReviewPolicy("repository", heads.repository)
    : null;
  const next = withProviderSelections(
    parseRepositoryReviewPolicy({
      ...input.settings,
      schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    }),
    current?.providers ?? null,
  );
  const saved = await dependencies.configurations.saveNextVersions({
    workspaceId: input.workspaceId,
    writes: [
      ...(workspace
        ? []
        : [
            {
              target: {
                scope: "workspace" as const,
                workspaceId: input.workspaceId,
              },
              policy: defaultWorkspaceReviewPolicy(),
              expectedVersion: null,
              implicit: true,
            },
          ]),
      {
        target,
        policy: next,
        expectedVersion: input.expectedVersion,
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
      },
    ],
    selectionAuthority: providerSelectionAuthority({
      actor: input.actor,
      repositoryCapability: input.repository.capability,
    }),
    audit: {
      actor: input.actor.auditActor,
      action:
        Object.keys(input.settings).length === 0
          ? "review_config.cleared"
          : "review_config.saved",
      ...(input.auditMetadata ? { metadata: input.auditMetadata } : {}),
      metadataForSavedConfiguration: savedReviewSettingsAuditMetadata,
    },
  });
  return saved.at(-1)!;
}

/** Audit only the provider and policy facts the committed settings review with. */
function savedReviewSettingsAuditMetadata(
  configuration: SavedReviewPolicy["configuration"],
): Readonly<Record<string, string>> {
  const config = configuration?.config;
  const provider = config?.providers[0];
  return {
    ...(provider
      ? {
          providerKind: provider.kind,
          authMode: provider.authMode,
          model: provider.model,
        }
      : {}),
    ...(config ? { failOnSeverity: config.blockingPolicy.failOnSeverity } : {}),
  };
}

export type ProviderSelectionAssignment =
  | Readonly<{
      repositoryId: string;
      status: "applied";
      version: number;
      /** The selected profile; a created one when the request was a draft. */
      profileId: string | null;
    }>
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
    /** An existing profile, or the draft ID of `draft`. */
    profileId: string;
    settings: ProviderSelectionSettings;
    /**
     * A new provider: created with the first assignment that succeeds, as one
     * decision with that attach; later repositories select the created one.
     */
    draft?: ProviderSelectionDraft;
    /** Verified capability of the actor on each repository. */
    repositories: readonly ProviderRepositoryFacts[];
  }>,
  dependencies: SelectionDependencies,
): Promise<readonly ProviderSelectionAssignment[]> {
  let selection = reviewProviderSelectionSchema.parse({
    ...input.settings,
    profileId: input.profileId,
  });
  let draft = draftFor(selection, input.draft);
  const results: ProviderSelectionAssignment[] = [];
  for (const repository of input.repositories) {
    const pending = draft;
    const result = await assignmentResult(repository.repositoryId, () =>
      saveRepositorySelection(
        {
          workspaceId: input.workspaceId,
          actor: input.actor,
          repository,
          selections: [selection],
          ...(pending ? { draft: pending } : {}),
        },
        dependencies,
      ),
    );
    if (pending && result.status === "applied" && result.profileId) {
      selection = { ...selection, profileId: result.profileId };
      draft = undefined;
    }
    results.push(result);
  }
  return results;
}

/**
 * Removes the repository's own selection so it follows the workspace
 * default again. Its other repository settings stay; a document in a retired
 * format is replaced, so the repository then has no overrides at all.
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
    draft?: ProviderSelectionDraft;
  }>,
  dependencies: SelectionDependencies,
): Promise<SavedReviewPolicy> {
  const { draft } = input;
  const target = {
    scope: "repository" as const,
    workspaceId: input.workspaceId,
    repositoryId: input.repository.repositoryId,
  };
  return withSelectionRetry(async () => {
    const heads = await dependencies.policyHeads.readPolicyHeads(target);
    const workspace = heads.workspace
      ? parseStoredReviewPolicy("workspace", heads.workspace)
      : null;
    // The workspace document belongs to its owners and admins: a repository
    // write never replaces one in a retired format (its settings would be
    // lost); the default action or the one-time migration converts it.
    if (heads.workspace && !workspace)
      throw new Error("review_workspace_policy_retired");
    // The repository's own document in a retired format is not kept: the
    // write replaces it, so choosing a provider brings the repository back.
    const current =
      (heads.repository
        ? parseStoredReviewPolicy("repository", heads.repository)
        : null) ??
      parseRepositoryReviewPolicy({
        schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
      });
    // The repository's own limits follow the providers it reviews with now.
    const providerCount =
      input.selections?.length ?? workspace?.providers?.length ?? 0;
    const next = fitExecutionLimits(
      withProviderSelections(current, input.selections),
      providerCount,
    );
    const writes: ReviewPolicyWrite[] = [];
    // The first attach of a workspace without a document creates one with
    // built-in settings, never a default.
    if (!heads.workspace)
      writes.push({
        target: { scope: "workspace", workspaceId: input.workspaceId },
        policy: defaultWorkspaceReviewPolicy(),
        expectedVersion: null,
        implicit: true,
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
          ...(draft ? { profiles: [draft.profile] } : {}),
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
      ...(draft ? { profileDrafts: [draft.draft] } : {}),
      audit: {
        actor: input.actor.auditActor,
        action: input.selections
          ? "provider_selection.assigned"
          : "provider_selection.cleared",
        metadata:
          input.selections && !draft
            ? { profileId: input.selections[0]!.profileId }
            : {},
      },
    });
    return saved.at(-1)!;
  });
}

/** The draft a selection names, refused when the two do not match. */
function draftFor(
  selection: ReviewProviderSelection | null,
  draft: ProviderSelectionDraft | undefined,
): ProviderSelectionDraft | undefined {
  if (!draft) return undefined;
  if (
    selection?.profileId !== draft.draft.draftId ||
    draft.profile.id !== draft.draft.draftId
  )
    throw new Error("provider_selection_draft_mismatch");
  return draft;
}

/** Validates the candidate; the write must reproduce its digest. */
async function validated(
  target: ReviewConfigurationTarget,
  replacement: Pick<
    Parameters<typeof previewEffectiveReviewConfiguration>[0],
    "workspacePolicy" | "repositoryPolicy" | "profiles"
  >,
  dependencies: SelectionDependencies,
): Promise<{ readonly expectedEffectivePolicyDigest: string | null }> {
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
  run: () => Promise<SavedReviewPolicy>,
): Promise<ProviderSelectionAssignment> {
  try {
    const saved = await run();
    return {
      repositoryId,
      status: "applied",
      version: saved.version,
      profileId: saved.configuration?.selections[0]?.profileId ?? null,
    };
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
