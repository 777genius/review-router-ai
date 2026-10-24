import { type ReviewConfiguration } from "../../domain/review-configuration";
import type { ReviewProviderSelection } from "../../domain/review-policy-document";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewConfigurationRepositoryPort,
  ReviewPolicyHeadReaderPort,
} from "../ports/review-configuration-repository-port";
import { mapConfigToRuntimeEnv } from "./map-config-to-runtime-env";
import { resolveEffectiveReviewConfiguration } from "./resolve-effective-review-configuration";

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
  readonly policy: PersistedReviewConfiguration["policy"];
  readonly selections: readonly ReviewProviderSelection[];
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
    policy: persisted.policy,
    selections: persisted.selections,
  };
}

export async function resolveReviewRuntimeEnv(
  target: ReviewConfigurationTarget,
  dependencies: { readonly policyHeads: ReviewPolicyHeadReaderPort },
): Promise<ResolvedReviewRuntimeEnv> {
  const resolved = await resolveEffectiveReviewConfiguration(
    target,
    dependencies,
  );
  if (resolved.status === "resave_required")
    throw new Error("review_policy_resave_required");
  if (resolved.status === "provider_selection_required")
    throw new Error("review_provider_selection_required");

  return {
    ...toResolvedConfiguration(resolved),
    runtimeEnv: mapConfigToRuntimeEnv(resolved.config),
  };
}
