import { createHash } from "node:crypto";
import {
  canonicalJson,
  type ReviewConfiguration,
} from "../../domain/review-configuration";
import {
  parseRepositoryReviewPolicy,
  parseWorkspaceReviewPolicy,
  resolveEffectiveReviewPolicy,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  type RepositoryReviewPolicy,
  type ReviewPolicyDocument,
  type ReviewProviderSelection,
  type WorkspaceReviewPolicy,
} from "../../domain/review-policy-document";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewPolicyHead,
  ReviewPolicyHeadReaderPort,
  ReviewPolicyProfiles,
} from "../ports/review-configuration-repository-port";

export type ReadyReviewConfiguration = PersistedReviewConfiguration &
  Readonly<{ workspaceVersion: number; revisionToken: string }>;

/**
 * `provider_selection_required` means neither the repository nor the
 * workspace selects a provider, including when no workspace document exists.
 * `resave_required` means an active head that cannot be read in the current
 * format or references an unusable profile. Both keep the raw head versions
 * so a legacy policy retains CAS protection.
 */
export type EffectiveReviewConfiguration =
  | (Readonly<{ status: "ready" }> & ReadyReviewConfiguration)
  | UnresolvedReviewConfiguration<"provider_selection_required">
  | UnresolvedReviewConfiguration<"resave_required">;

type UnresolvedReviewConfiguration<Status extends string> = Readonly<{
  status: Status;
  workspaceVersion: number | null;
  repositoryVersion: number | null;
}>;

export async function resolveEffectiveReviewConfiguration(
  target: ReviewConfigurationTarget,
  dependencies: { readonly policyHeads: ReviewPolicyHeadReaderPort },
): Promise<EffectiveReviewConfiguration> {
  const heads = await dependencies.policyHeads.readPolicyHeads(target);
  return composeEffectiveReviewConfiguration(target, heads);
}

/** Resolves the workspace and every requested repository from one head read. */
export async function resolveEffectiveReviewConfigurations(
  input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  },
  dependencies: { readonly policyHeads: ReviewPolicyHeadReaderPort },
): Promise<
  Readonly<{
    workspace: EffectiveReviewConfiguration;
    repositories: ReadonlyMap<string, EffectiveReviewConfiguration>;
    /**
     * The stored workspace document, also when it selects no default; null
     * when there is none or it cannot be read in the current format.
     */
    workspacePolicy: WorkspaceReviewPolicy | null;
    /** Each repository's stored document, null as for the workspace. */
    repositoryPolicies: ReadonlyMap<string, RepositoryReviewPolicy | null>;
  }>
> {
  const repositoryIds = [...new Set(input.repositoryIds)];
  const heads = await dependencies.policyHeads.readRepositoryPolicyHeads({
    workspaceId: input.workspaceId,
    repositoryIds,
  });
  const workspace = composeEffectiveReviewConfiguration(
    { scope: "workspace", workspaceId: input.workspaceId },
    { workspace: heads.workspace, repository: null, profiles: heads.profiles },
  );
  return {
    workspace,
    workspacePolicy: heads.workspace
      ? parseStoredReviewPolicy("workspace", heads.workspace)
      : null,
    repositoryPolicies: new Map(
      repositoryIds.map((repositoryId) => {
        const head = heads.repositories.get(repositoryId);
        return [
          repositoryId,
          head ? parseStoredReviewPolicy("repository", head) : null,
        ] as const;
      }),
    ),
    repositories: new Map(
      repositoryIds.map(
        (repositoryId) =>
          [
            repositoryId,
            composeEffectiveReviewConfiguration(
              {
                scope: "repository",
                workspaceId: input.workspaceId,
                repositoryId,
              },
              {
                workspace: heads.workspace,
                repository: heads.repositories.get(repositoryId) ?? null,
                profiles: heads.profiles,
              },
            ),
          ] as const,
      ),
    ),
  };
}

/** Nullable view for readers that treat every non-ready variant alike. */
export function readyReviewConfiguration(
  resolved: EffectiveReviewConfiguration,
): ReadyReviewConfiguration | null {
  if (resolved.status !== "ready") return null;
  return {
    version: resolved.version,
    config: resolved.config,
    policy: resolved.policy,
    source: resolved.source,
    workspaceVersion: resolved.workspaceVersion,
    repositoryVersion: resolved.repositoryVersion,
    effectivePolicyDigest: resolved.effectivePolicyDigest,
    revisionToken: resolved.revisionToken,
    selections: resolved.selections,
  };
}

export function composeEffectiveReviewConfiguration(
  target: ReviewConfigurationTarget,
  heads: {
    readonly workspace: ReviewPolicyHead | null;
    readonly repository: ReviewPolicyHead | null;
    readonly profiles: ReviewPolicyProfiles;
  },
): EffectiveReviewConfiguration {
  const { workspace, repository } = heads;
  const versions = {
    workspaceVersion: workspace?.version ?? null,
    repositoryVersion: repository?.version ?? null,
  };
  // Non-provider settings come from the workspace document; without one there
  // is nothing to select from.
  if (!workspace) return { status: "provider_selection_required", ...versions };
  const workspacePolicy = parseStoredReviewPolicy("workspace", workspace);
  const repositoryPolicy = repository
    ? parseStoredReviewPolicy("repository", repository)
    : null;
  if (!workspacePolicy || (repository && !repositoryPolicy))
    return { status: "resave_required", ...versions };
  let effective: ReturnType<typeof resolveEffectiveReviewPolicy>;
  try {
    effective = resolveEffectiveReviewPolicy({
      target,
      workspace: workspacePolicy,
      repository: repositoryPolicy,
      profiles: heads.profiles,
    });
  } catch {
    return { status: "resave_required", ...versions };
  }
  if (!effective) return { status: "provider_selection_required", ...versions };
  return {
    status: "ready",
    ...persistedReviewConfiguration({
      config: effective.config,
      selections: effective.selections,
      policy: repositoryPolicy ?? workspacePolicy,
      workspaceVersion: workspace.version,
      repositoryVersion: repository?.version ?? null,
    }),
  };
}

export function persistedReviewConfiguration(input: {
  readonly config: ReviewConfiguration;
  readonly selections: readonly ReviewProviderSelection[];
  readonly policy: ReviewPolicyDocument;
  readonly workspaceVersion: number;
  readonly repositoryVersion: number | null;
}): ReadyReviewConfiguration {
  const digest = effectiveReviewPolicyDigest(input.config);
  const { workspaceVersion, repositoryVersion } = input;
  return {
    version: repositoryVersion ?? workspaceVersion,
    config: input.config,
    policy: input.policy,
    source: repositoryVersion === null ? "workspace" : "repository",
    workspaceVersion,
    repositoryVersion,
    effectivePolicyDigest: digest,
    revisionToken: `policy:${workspaceVersion}:${repositoryVersion ?? 0}:${digest}`,
    selections: input.selections,
  };
}

export function effectiveReviewPolicyDigest(
  config: ReviewConfiguration,
): string {
  return `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
}

/** A stored head in the current document format, or null. */
export function parseStoredReviewPolicy(
  scope: "workspace",
  head: Pick<ReviewPolicyHead, "schemaVersion" | "policyJson">,
): WorkspaceReviewPolicy | null;
export function parseStoredReviewPolicy(
  scope: "repository",
  head: Pick<ReviewPolicyHead, "schemaVersion" | "policyJson">,
): RepositoryReviewPolicy | null;
export function parseStoredReviewPolicy(
  scope: "workspace" | "repository",
  head: Pick<ReviewPolicyHead, "schemaVersion" | "policyJson">,
): ReviewPolicyDocument | null;
export function parseStoredReviewPolicy(
  scope: "workspace" | "repository",
  head: Pick<ReviewPolicyHead, "schemaVersion" | "policyJson">,
): ReviewPolicyDocument | null {
  if (
    head.schemaVersion !== STORED_REVIEW_POLICY_SCHEMA_VERSION ||
    !head.policyJson
  )
    return null;
  try {
    const parsed: unknown = JSON.parse(head.policyJson);
    return scope === "workspace"
      ? parseWorkspaceReviewPolicy(parsed)
      : parseRepositoryReviewPolicy(parsed);
  } catch {
    return null;
  }
}
