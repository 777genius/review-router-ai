import { type ReviewConfiguration } from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewConfigurationRepositoryPort,
} from "../ports/review-configuration-repository-port";
import { mapConfigToRuntimeEnv } from "./map-config-to-runtime-env";

export type ResolvedReviewConfigurationSource =
  | "repository"
  | "workspace"
  | "default";

export type ResolvedReviewConfiguration = {
  readonly version: number;
  readonly source: Exclude<ResolvedReviewConfigurationSource, "default">;
  readonly workspaceVersion: number | null;
  readonly repositoryVersion: number | null;
  readonly effectivePolicyDigest: string;
  readonly revisionToken: string;
  readonly config: ReviewConfiguration;
};

export type ResolvedReviewRuntimeEnv = ResolvedReviewConfiguration & {
  readonly runtimeEnv: Record<string, string>;
};

export async function resolveReviewConfiguration(
  target: ReviewConfigurationTarget,
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<ResolvedReviewConfiguration | null> {
  const persisted = await dependencies.configurations.findLatest(target);
  return persisted ? toResolvedConfiguration(persisted) : null;
}

function toResolvedConfiguration(
  persisted: PersistedReviewConfiguration,
): ResolvedReviewConfiguration {
  return {
    version: persisted.version,
    source: persisted.source,
    workspaceVersion: persisted.workspaceVersion,
    repositoryVersion: persisted.repositoryVersion,
    effectivePolicyDigest: persisted.effectivePolicyDigest,
    revisionToken:
      persisted.revisionToken ??
      `policy:${persisted.workspaceVersion ?? 0}:${persisted.repositoryVersion ?? 0}:${persisted.effectivePolicyDigest}`,
    config: persisted.config,
  };
}

export async function resolveReviewRuntimeEnv(
  target: ReviewConfigurationTarget,
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<ResolvedReviewRuntimeEnv> {
  const resolved = await resolveReviewConfiguration(target, dependencies);
  if (!resolved) throw new Error("review_workspace_policy_required");

  return {
    ...resolved,
    runtimeEnv: mapConfigToRuntimeEnv(resolved.config),
  };
}
