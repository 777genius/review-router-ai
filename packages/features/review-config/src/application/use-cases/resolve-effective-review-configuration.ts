import { createHash } from "node:crypto";
import {
  canonicalJson,
  parseRepositoryReviewPolicyOverride,
  parseReviewConfigurationStrict,
  resolveReviewPolicy,
  REVIEW_POLICY_SCHEMA_VERSION,
  type RepositoryReviewPolicyOverride,
  type ReviewConfiguration,
  type WorkspaceReviewPolicy,
} from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewPolicyHead,
  ReviewPolicyHeadReaderPort,
} from "../ports/review-configuration-repository-port";

export type ReadyReviewConfiguration = PersistedReviewConfiguration &
  Readonly<{ workspaceVersion: number; revisionToken: string }>;

/**
 * `missing` means no active workspace policy. `resave_required` means an
 * active head that cannot be read in the current format. Both keep the raw
 * head versions so a legacy policy retains CAS protection.
 */
export type EffectiveReviewConfiguration =
  | (Readonly<{ status: "ready" }> & ReadyReviewConfiguration)
  | UnresolvedReviewConfiguration<"missing">
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
  return composeEffectiveReviewConfiguration(
    await dependencies.policyHeads.readPolicyHeads(target),
  );
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
  }>
> {
  const repositoryIds = [...new Set(input.repositoryIds)];
  const heads = await dependencies.policyHeads.readRepositoryPolicyHeads({
    workspaceId: input.workspaceId,
    repositoryIds,
  });
  const workspace = composeEffectiveReviewConfiguration({
    workspace: heads.workspace,
    repository: null,
  });
  return {
    workspace,
    repositories: new Map(
      repositoryIds.map((repositoryId) => {
        const repository = heads.repositories.get(repositoryId);
        return [
          repositoryId,
          repository
            ? composeEffectiveReviewConfiguration({
                workspace: heads.workspace,
                repository,
              })
            : workspace,
        ] as const;
      }),
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
  };
}

export function composeEffectiveReviewConfiguration(heads: {
  readonly workspace: ReviewPolicyHead | null;
  readonly repository: ReviewPolicyHead | null;
}): EffectiveReviewConfiguration {
  const { workspace, repository } = heads;
  const versions = {
    workspaceVersion: workspace?.version ?? null,
    repositoryVersion: repository?.version ?? null,
  };
  if (!workspace) return { status: "missing", ...versions };
  const workspacePolicy =
    workspace.schemaVersion === REVIEW_POLICY_SCHEMA_VERSION
      ? parseStoredReviewPolicy("workspace", workspace.policyJson)
      : null;
  const repositoryPolicy =
    repository?.schemaVersion === REVIEW_POLICY_SCHEMA_VERSION
      ? parseStoredReviewPolicy("repository", repository.policyJson)
      : null;
  if (!workspacePolicy || (repository && !repositoryPolicy))
    return { status: "resave_required", ...versions };
  let config: ReviewConfiguration;
  try {
    config = resolveReviewPolicy(workspacePolicy, repositoryPolicy);
  } catch {
    return { status: "resave_required", ...versions };
  }
  return {
    status: "ready",
    ...persistedReviewConfiguration(
      config,
      repositoryPolicy ?? workspacePolicy,
      workspace.version,
      repository?.version ?? null,
    ),
  };
}

export function persistedReviewConfiguration(
  config: ReviewConfiguration,
  policy: WorkspaceReviewPolicy | RepositoryReviewPolicyOverride,
  workspaceVersion: number,
  repositoryVersion: number | null,
): ReadyReviewConfiguration {
  const digest = `sha256:${createHash("sha256").update(canonicalJson(config)).digest("hex")}`;
  return {
    version: repositoryVersion ?? workspaceVersion,
    config,
    policy,
    source: repositoryVersion === null ? "workspace" : "repository",
    workspaceVersion,
    repositoryVersion,
    effectivePolicyDigest: digest,
    revisionToken: `policy:${workspaceVersion}:${repositoryVersion ?? 0}:${digest}`,
  };
}

export function parseStoredReviewPolicy(
  scope: "workspace",
  policyJson: string | null,
): WorkspaceReviewPolicy | null;
export function parseStoredReviewPolicy(
  scope: "repository",
  policyJson: string | null,
): RepositoryReviewPolicyOverride | null;
export function parseStoredReviewPolicy(
  scope: "workspace" | "repository",
  policyJson: string | null,
): WorkspaceReviewPolicy | RepositoryReviewPolicyOverride | null {
  if (!policyJson) return null;
  try {
    const parsed = JSON.parse(policyJson);
    return scope === "workspace"
      ? parseReviewConfigurationStrict(parsed)
      : parseRepositoryReviewPolicyOverride(parsed);
  } catch {
    return null;
  }
}
