import {
  parseReviewConfigurationStrict,
  type ReviewConfiguration,
} from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  PersistedReviewConfiguration,
  ReviewConfigurationBatchReaderPort,
  ReviewConfigurationRepositoryPort,
} from "../ports/review-configuration-repository-port";

export type RepositoryReviewConfigurationResult = Readonly<{
  repositoryId: string;
  config: PersistedReviewConfiguration | null;
}>;

export async function saveReviewConfiguration(
  input: {
    readonly target: ReviewConfigurationTarget;
    readonly config: ReviewConfiguration;
    readonly expectedVersion?: number | null;
  },
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<PersistedReviewConfiguration> {
  const config = parseReviewConfigurationStrict(input.config);

  return dependencies.configurations.saveNextVersion({
    target: input.target,
    config,
    ...(input.expectedVersion !== undefined
      ? { expectedVersion: input.expectedVersion }
      : {}),
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

/**
 * Returns one entry for every requested repository ID, preserving input order
 * and duplicates. Repositories without an override receive null, matching the
 * single-target findReviewConfiguration semantics.
 */
export async function findRepositoryReviewConfigurations(
  input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  },
  dependencies: {
    readonly configurations: ReviewConfigurationBatchReaderPort;
  },
): Promise<readonly RepositoryReviewConfigurationResult[]> {
  if (input.repositoryIds.length === 0) {
    return [];
  }

  const uniqueRepositoryIds = [...new Set(input.repositoryIds)];
  const persisted = await dependencies.configurations.findLatestForRepositories(
    {
      workspaceId: input.workspaceId,
      repositoryIds: uniqueRepositoryIds,
    },
  );
  const configByRepositoryId = new Map(
    persisted.map(
      ({ repositoryId, config }) => [repositoryId, config] as const,
    ),
  );

  return input.repositoryIds.map((repositoryId) => ({
    repositoryId,
    config: configByRepositoryId.get(repositoryId) ?? null,
  }));
}

export async function clearReviewConfiguration(
  target: ReviewConfigurationTarget,
  dependencies: {
    readonly configurations: ReviewConfigurationRepositoryPort;
  },
): Promise<boolean> {
  return dependencies.configurations.deleteTarget(target);
}
