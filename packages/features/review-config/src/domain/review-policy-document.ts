import { contextToolsSelectionSchema } from "@reviewrouter/features-review-context-tools/selection";
import {
  gatewayReferenceSchema,
  providerKindForAuthMode,
} from "@reviewrouter/features-review-providers";
import { z } from "zod";
import {
  blockingPolicySchema,
  canonicalJson,
  limitsSchema,
  parseReviewConfiguration,
  REVIEW_POLICY_SCHEMA_VERSION,
  reviewInvestigationRolloutConfigurationSchema,
  reviewLanguageSchema,
  reviewReasoningEffortSchema,
  type ReviewConfiguration,
  type ReviewProviderConfiguration,
} from "./review-configuration";
import type { ReviewConfigurationTarget } from "./review-configuration-target";
import type {
  ProviderProfileUsage,
  WorkspaceProviderProfile,
} from "./workspace-provider-profile";

/**
 * Version of stored workspace and repository policy documents. The runtime
 * configuration materialized from them keeps REVIEW_POLICY_SCHEMA_VERSION.
 */
export const STORED_REVIEW_POLICY_SCHEMA_VERSION = 4 as const;

/**
 * One provider of a policy: a workspace provider profile (credential source
 * and model) plus the review settings of this use of it.
 */
export const reviewProviderSelectionSchema = z
  .object({
    profileId: gatewayReferenceSchema,
    // Absent only where the provider exposes no reasoning control (Gateway);
    // the runtime configuration applies the catalog default elsewhere.
    reasoningEffort: reviewReasoningEffortSchema.optional(),
    agenticContext: z.boolean(),
    fastMode: z.boolean(),
    requiredHealthy: z.boolean(),
    // Engine selection; the runtime configuration accepts it only on Gateway.
    agentProfileRef: gatewayReferenceSchema.optional(),
  })
  .strict();

const reviewProviderSelectionsSchema = z
  .array(reviewProviderSelectionSchema)
  .min(1)
  .max(16)
  .superRefine((selections, context) => {
    const seen = new Set<string>();
    selections.forEach((selection, index) => {
      const key = JSON.stringify([
        selection.profileId,
        selection.agentProfileRef ?? null,
      ]);
      if (seen.has(key))
        context.addIssue({
          code: "custom",
          path: [index],
          message: "duplicate review provider",
        });
      seen.add(key);
    });
  });

// The provider limit is the selection count and is never stored.
const storedExecutionSchema = z
  .object({
    providerMaxParallel: z.number().int().min(1).max(16),
    inlineMinAgreement: z.number().int().min(1).max(16),
  })
  .strict();

/** Workspace document. Absent providers mean there is no workspace default. */
export const workspaceReviewPolicySchema = z
  .object({
    schemaVersion: z.literal(STORED_REVIEW_POLICY_SCHEMA_VERSION),
    providers: reviewProviderSelectionsSchema.optional(),
    execution: storedExecutionSchema,
    blockingPolicy: blockingPolicySchema,
    limits: limitsSchema,
    reviewLanguage: reviewLanguageSchema,
    // Absence keeps the runtime default (enabled).
    updatePrDescription: z.boolean().optional(),
    investigationRollout: reviewInvestigationRolloutConfigurationSchema,
    contextTools: contextToolsSelectionSchema.optional(),
    // One workspace-wide setting; absence keeps automatic memory changes.
    memory: z.object({ requireConfirmation: z.boolean() }).strict().optional(),
  })
  .strict();

/** Repository document. Every absent field, providers included, inherits. */
export const repositoryReviewPolicySchema = z
  .object({
    schemaVersion: z.literal(STORED_REVIEW_POLICY_SCHEMA_VERSION),
    providers: reviewProviderSelectionsSchema.optional(),
    execution: storedExecutionSchema.partial().optional(),
    blockingPolicy: blockingPolicySchema.partial().optional(),
    limits: limitsSchema.partial().optional(),
    reviewLanguage: reviewLanguageSchema.optional(),
    updatePrDescription: z.boolean().optional(),
    investigationRollout: reviewInvestigationRolloutConfigurationSchema
      .partial()
      .optional(),
    contextTools: contextToolsSelectionSchema.optional(),
  })
  .strict();

export type ReviewProviderSelection = z.infer<
  typeof reviewProviderSelectionSchema
>;
export type WorkspaceReviewPolicy = z.infer<typeof workspaceReviewPolicySchema>;
export type RepositoryReviewPolicy = z.infer<
  typeof repositoryReviewPolicySchema
>;
export type ReviewPolicyDocument =
  | WorkspaceReviewPolicy
  | RepositoryReviewPolicy;
/** Review execution settings; provider selection and Memory have separate forms. */
export type WorkspaceReviewSettings = Omit<
  WorkspaceReviewPolicy,
  "schemaVersion" | "providers" | "memory"
>;
/** The overrides of a repository document besides its provider selection. */
export type RepositoryReviewSettings = Omit<
  RepositoryReviewPolicy,
  "schemaVersion" | "providers"
>;

export function parseWorkspaceReviewPolicy(
  input: unknown,
): WorkspaceReviewPolicy {
  return workspaceReviewPolicySchema.parse(input);
}

export function parseRepositoryReviewPolicy(
  input: unknown,
): RepositoryReviewPolicy {
  return repositoryReviewPolicySchema.parse(input);
}

export function parseReviewPolicyDocument(
  scope: ReviewConfigurationTarget["scope"],
  input: unknown,
): ReviewPolicyDocument {
  return scope === "workspace"
    ? parseWorkspaceReviewPolicy(input)
    : parseRepositoryReviewPolicy(input);
}

/**
 * Built-in non-provider workspace settings. The first provider attach or
 * default change creates the workspace document from them, so a workspace
 * never has to save settings before a repository can select a provider.
 */
export function defaultWorkspaceReviewPolicy(): WorkspaceReviewPolicy {
  return parseWorkspaceReviewPolicy({
    schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
    execution: { providerMaxParallel: 1, inlineMinAgreement: 1 },
    blockingPolicy: { failOnSeverity: "critical" },
    limits: { inlineMaxComments: 50, targetTokensPerBatch: 50000 },
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
}

/** The same document with the given selections; null removes them. */
export function withProviderSelections<Document extends ReviewPolicyDocument>(
  document: Document,
  selections: readonly ReviewProviderSelection[] | null,
): Document {
  const { providers: _previous, ...rest } = document;
  void _previous;
  return (
    selections ? { ...rest, providers: [...selections] } : rest
  ) as Document;
}

/**
 * Profile IDs referenced by a stored head, read leniently so a resolver can
 * load them before parsing. Any other format references none.
 */
export function storedReviewPolicyProfileIds(head: {
  readonly schemaVersion: number;
  readonly policyJson: string | null;
}): readonly string[] {
  if (
    head.schemaVersion !== STORED_REVIEW_POLICY_SCHEMA_VERSION ||
    !head.policyJson
  )
    return [];
  try {
    const parsed = storedProfileReferencesSchema.safeParse(
      JSON.parse(head.policyJson),
    );
    return parsed.success
      ? (parsed.data.providers ?? []).map((provider) => provider.profileId)
      : [];
  } catch {
    return [];
  }
}

const storedProfileReferencesSchema = z.object({
  providers: z
    .array(z.object({ profileId: gatewayReferenceSchema }))
    .max(16)
    .optional(),
});

export type ReviewPolicyMaterializationErrorCode =
  | "review_provider_profile_unavailable"
  | "rotating_profile_repository_only"
  /** A selection's review settings do not fit its profile's model. */
  | "review_provider_settings_incompatible"
  /** Stored execution limits name more providers than are selected. */
  | "review_execution_limits_incompatible";

export class ReviewPolicyMaterializationError extends Error {
  constructor(readonly code: ReviewPolicyMaterializationErrorCode) {
    super(code);
    this.name = "ReviewPolicyMaterializationError";
  }
}

export type EffectiveReviewPolicy = Readonly<{
  config: ReviewConfiguration;
  selections: readonly ReviewProviderSelection[];
}>;

/**
 * Materializes the runtime configuration of one target from the stored
 * documents and the workspace provider registry. Returns null when neither the
 * repository nor the workspace selects a provider. Throws when a reference or
 * the resulting configuration is invalid; readers treat that as a policy that
 * must be saved again, writers refuse it.
 */
export function resolveEffectiveReviewPolicy(input: {
  readonly target: ReviewConfigurationTarget;
  readonly workspace: WorkspaceReviewPolicy;
  readonly repository: RepositoryReviewPolicy | null;
  readonly profiles: ReadonlyMap<string, WorkspaceProviderProfile>;
}): EffectiveReviewPolicy | null {
  const workspace = parseWorkspaceReviewPolicy(input.workspace);
  const repository = input.repository
    ? parseRepositoryReviewPolicy(input.repository)
    : null;
  const selectionSource = repository?.providers ? "repository" : "workspace";
  const selections = repository?.providers ?? workspace.providers;
  if (!selections) return null;
  // A rotating credential lives in one repository and is never a default.
  const rotatingRepositoryId =
    selectionSource === "repository" && input.target.scope === "repository"
      ? input.target.repositoryId
      : null;
  const providers = selections.map((selection) =>
    runtimeProvider(
      selection,
      input.profiles.get(selection.profileId),
      rotatingRepositoryId,
    ),
  );
  const { execution, ...settings } = effectiveReviewSettings(
    workspace,
    repository,
  );
  const config = materialize({
    ...settings,
    schemaVersion: REVIEW_POLICY_SCHEMA_VERSION,
    providers,
    execution: {
      providerLimit: providers.length,
      ...(selectionSource === "repository"
        ? inheritedExecutionLimits(execution, repository, providers.length)
        : execution),
    },
  });
  return { config, selections };
}

/**
 * A repository that selects its own providers inherits the workspace limits
 * as upper bounds: it runs, and agrees, with at most as many providers as it
 * selects. Limits a document stores itself next to the selection they govern
 * are never fitted, so an inconsistent document stays invalid.
 */
function inheritedExecutionLimits(
  execution: WorkspaceReviewSettings["execution"],
  repository: RepositoryReviewPolicy | null,
  providerCount: number,
): WorkspaceReviewSettings["execution"] {
  const fit = (field: keyof WorkspaceReviewSettings["execution"]) =>
    repository?.execution?.[field] !== undefined
      ? execution[field]
      : Math.min(execution[field], providerCount);
  return {
    providerMaxParallel: fit("providerMaxParallel"),
    inlineMinAgreement: fit("inlineMinAgreement"),
  };
}

/**
 * The document with its own stored execution limits lowered to the number of
 * providers its target selects after a selection change, so replacing the
 * providers never leaves limits no selection can meet. Limits are never
 * raised; only selection writes use it, other writes of an inconsistent
 * document are refused.
 */
export function fitExecutionLimits<Document extends ReviewPolicyDocument>(
  document: Document,
  providerCount: number,
): Document {
  const execution = document.execution;
  if (!execution || providerCount < 1) return document;
  const fitted = Object.fromEntries(
    Object.entries(execution).map(([field, value]) => [
      field,
      typeof value === "number" ? Math.min(value, providerCount) : value,
    ]),
  );
  return { ...document, execution: fitted } as Document;
}

/**
 * The settings a target reviews with besides its providers: the workspace
 * document with the repository's explicit overrides on top.
 */
export function effectiveReviewSettings(
  workspace: WorkspaceReviewPolicy,
  repository: RepositoryReviewPolicy | null,
): WorkspaceReviewSettings {
  const updatePrDescription =
    repository?.updatePrDescription ?? workspace.updatePrDescription;
  const contextTools = repository?.contextTools ?? workspace.contextTools;
  return {
    ...(updatePrDescription === undefined ? {} : { updatePrDescription }),
    execution: {
      ...workspace.execution,
      ...definedOnly(repository?.execution),
    },
    blockingPolicy: {
      ...workspace.blockingPolicy,
      ...definedOnly(repository?.blockingPolicy),
    },
    limits: { ...workspace.limits, ...definedOnly(repository?.limits) },
    reviewLanguage:
      repository?.reviewLanguage !== undefined
        ? repository.reviewLanguage
        : workspace.reviewLanguage,
    ...(contextTools === undefined ? {} : { contextTools }),
    investigationRollout: {
      ...workspace.investigationRollout,
      ...definedOnly(repository?.investigationRollout),
    },
  };
}

/**
 * Parses the materialized runtime configuration. Stored documents are valid
 * on their own, so a failure comes from combining them: a model edit can
 * leave a selection's reasoning or fast settings unsupported, or stored
 * execution limits can name more providers than are selected.
 */
function materialize(input: unknown): ReviewConfiguration {
  try {
    return parseReviewConfiguration(input);
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    throw new ReviewPolicyMaterializationError(
      error.issues.every((issue) => issue.path[0] === "providers")
        ? "review_provider_settings_incompatible"
        : "review_execution_limits_incompatible",
    );
  }
}

/**
 * The stored settings a runtime configuration was materialized from: the
 * inverse of the settings part of materialization, for converting schema 3
 * workspace configurations.
 */
export function workspaceReviewSettingsFromConfiguration(
  config: ReviewConfiguration,
): WorkspaceReviewSettings {
  return {
    execution: {
      providerMaxParallel: config.execution.providerMaxParallel,
      inlineMinAgreement: config.execution.inlineMinAgreement,
    },
    blockingPolicy: config.blockingPolicy,
    limits: config.limits,
    reviewLanguage: config.reviewLanguage,
    ...(config.updatePrDescription === undefined
      ? {}
      : { updatePrDescription: config.updatePrDescription }),
    investigationRollout: config.investigationRollout,
    ...(config.contextTools === undefined
      ? {}
      : { contextTools: config.contextTools }),
  };
}

/** The selection that keeps a runtime provider row's settings for a profile. */
export function reviewProviderSelectionFor(
  provider: ReviewProviderConfiguration,
  profileId: string,
): ReviewProviderSelection {
  return reviewProviderSelectionSchema.parse({
    profileId,
    ...(provider.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: provider.reasoningEffort }),
    agenticContext: provider.agenticContext,
    fastMode: provider.fastMode,
    requiredHealthy: provider.requiredHealthy,
    ...("agentProfileRef" in provider && provider.agentProfileRef !== undefined
      ? { agentProfileRef: provider.agentProfileRef }
      : {}),
  });
}

/** Stable comparison of two selection lists; absent equals absent only. */
export function sameProviderSelections(
  left: readonly ReviewProviderSelection[] | undefined,
  right: readonly ReviewProviderSelection[] | undefined,
): boolean {
  return canonicalJson(left ?? null) === canonicalJson(right ?? null);
}

/**
 * Which stored documents select each profile: the workspace default and the
 * repositories selecting it themselves. Repositories that inherit the default
 * are covered by `workspaceDefault`.
 */
export function providerProfileUsageOf(input: {
  readonly workspace: WorkspaceReviewPolicy | null;
  readonly repositories: ReadonlyMap<string, RepositoryReviewPolicy>;
}): ReadonlyMap<string, ProviderProfileUsage> {
  const usage = new Map<
    string,
    { workspaceDefault: boolean; repositoryIds: Set<string> }
  >();
  const entry = (profileId: string) => {
    const current = usage.get(profileId) ?? {
      workspaceDefault: false,
      repositoryIds: new Set<string>(),
    };
    usage.set(profileId, current);
    return current;
  };
  for (const selection of input.workspace?.providers ?? [])
    entry(selection.profileId).workspaceDefault = true;
  for (const [repositoryId, policy] of input.repositories)
    for (const selection of policy.providers ?? [])
      entry(selection.profileId).repositoryIds.add(repositoryId);
  return new Map(
    [...usage].map(([profileId, item]) => [
      profileId,
      {
        profileId,
        workspaceDefault: item.workspaceDefault,
        repositoryIds: [...item.repositoryIds].sort(),
      },
    ]),
  );
}

function runtimeProvider(
  selection: ReviewProviderSelection,
  profile: WorkspaceProviderProfile | undefined,
  rotatingRepositoryId: string | null,
): unknown {
  if (!profile || profile.archivedAt !== null)
    throw new ReviewPolicyMaterializationError(
      "review_provider_profile_unavailable",
    );
  const { credential } = profile;
  if (
    credential.kind === "repository_rotating" &&
    credential.repositoryId !== rotatingRepositoryId
  )
    throw new ReviewPolicyMaterializationError(
      "rotating_profile_repository_only",
    );
  return {
    kind: providerKindForAuthMode(credential.authMode),
    authMode: credential.authMode,
    model: profile.model,
    ...(selection.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: selection.reasoningEffort }),
    agenticContext: selection.agenticContext,
    fastMode: selection.fastMode,
    requiredHealthy: selection.requiredHealthy,
    ...(credential.kind === "gateway_binding"
      ? {
          gatewayBindingId: credential.bindingId,
          gatewayProfileRef: credential.gatewayProfileRef,
        }
      : {}),
    ...(selection.agentProfileRef === undefined
      ? {}
      : { agentProfileRef: selection.agentProfileRef }),
  };
}

function definedOnly<T extends object>(
  value: T | undefined,
): { [Key in keyof T]?: Exclude<T[Key], undefined> } {
  return Object.fromEntries(
    Object.entries(value ?? {}).filter(([, child]) => child !== undefined),
  ) as { [Key in keyof T]?: Exclude<T[Key], undefined> };
}
