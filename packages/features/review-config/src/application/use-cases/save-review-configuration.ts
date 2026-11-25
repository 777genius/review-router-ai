import {
  parseReviewPolicyDocument,
  type ReviewPolicyDocument,
} from "../../domain/review-policy-document";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ProviderProfileDraft,
  ProviderSelectionAuthority,
  ReviewConfigurationRepositoryPort,
} from "../ports/review-configuration-repository-port";

/**
 * Saves one stored document. Signed-in writers pass their selection
 * authority, which decides any change of the stored provider selection;
 * system and operator writers omit it.
 */
export async function saveReviewConfiguration(
  input: {
    readonly target: ReviewConfigurationTarget;
    readonly policy: ReviewPolicyDocument;
    readonly expectedVersion?: number | null;
    readonly expectedEffectivePolicyDigest?: string;
    readonly selectionAuthority?: ProviderSelectionAuthority;
    /** Providers created with the selection that names them. */
    readonly profileDrafts?: readonly ProviderProfileDraft[];
  },
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration> {
  return dependencies.configurations.saveNextVersion({
    target: input.target,
    policy: parseReviewPolicyDocument(input.target.scope, input.policy),
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: input.expectedVersion }
      : {}),
    ...(input.expectedEffectivePolicyDigest !== undefined
      ? { expectedEffectivePolicyDigest: input.expectedEffectivePolicyDigest }
      : {}),
    ...(input.selectionAuthority
      ? { selectionAuthority: input.selectionAuthority }
      : {}),
    ...(input.profileDrafts ? { profileDrafts: input.profileDrafts } : {}),
  });
}

export async function findReviewConfiguration(
  target: ReviewConfigurationTarget,
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration | null> {
  return dependencies.configurations.findLatest(target);
}

export async function clearReviewConfiguration(
  target: ReviewConfigurationTarget & {
    readonly expectedVersion?: number | null;
    readonly selectionAuthority?: ProviderSelectionAuthority;
  },
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<boolean> {
  return dependencies.configurations.deleteTarget(
    target.scope === "repository"
      ? {
          scope: "repository",
          workspaceId: target.workspaceId,
          repositoryId: target.repositoryId,
        }
      : { scope: "workspace", workspaceId: target.workspaceId },
    target.expectedVersion,
    target.selectionAuthority,
  );
}
