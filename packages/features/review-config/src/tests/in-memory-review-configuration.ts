import { createHash } from "node:crypto";
import {
  canonicalJson,
  parseReviewConfigurationStrict,
  parseRepositoryReviewPolicyOverride,
  resolveReviewPolicy,
} from "../domain/review-configuration";
import { reviewConfigurationTargetKey } from "../domain/review-configuration-target";
import {
  ReviewConfigurationWriteConflictError,
  type PersistedReviewConfiguration,
  type ReviewConfigurationRepositoryPort,
  type ReviewConfigurationBatchReaderPort,
} from "../application/ports/review-configuration-repository-port";

export class InMemoryReviewConfigurationRepository
  implements
    ReviewConfigurationRepositoryPort,
    ReviewConfigurationBatchReaderPort
{
  readonly versions = new Map<string, PersistedReviewConfiguration[]>();
  saveCount = 0;
  conflictNextSave = false;

  async findLatest(
    target: Parameters<ReviewConfigurationRepositoryPort["findLatest"]>[0],
  ) {
    const own =
      this.versions.get(reviewConfigurationTargetKey(target))?.at(-1) ?? null;
    if (target.scope === "workspace") return own;
    const workspace = this.versions.get("workspace:default")?.at(-1);
    if (!workspace) return null;
    const policy = own?.policy ?? { schemaVersion: 3 as const };
    const config = resolveReviewPolicy(workspace.config, policy);
    return {
      ...(own ?? workspace),
      config,
      source: own ? ("repository" as const) : ("workspace" as const),
      workspaceVersion: workspace.version,
      repositoryVersion: own?.version ?? null,
      effectivePolicyDigest: createHash("sha256")
        .update(canonicalJson(config))
        .digest("hex"),
    };
  }

  async findLatestForRepositories(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }) {
    return [...new Set(input.repositoryIds)].flatMap((repositoryId) => {
      const config = this.versions
        .get(
          reviewConfigurationTargetKey({
            scope: "repository",
            workspaceId: input.workspaceId,
            repositoryId,
          }),
        )
        ?.at(-1);
      return config ? [{ repositoryId, config }] : [];
    });
  }

  async saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ) {
    if (this.conflictNextSave) {
      this.conflictNextSave = false;
      throw new ReviewConfigurationWriteConflictError();
    }
    const key = reviewConfigurationTargetKey(input.target);
    const records = this.versions.get(key) ?? [];
    if (
      input.expectedVersion !== undefined &&
      (records.at(-1)?.version ?? null) !== input.expectedVersion
    ) {
      throw new ReviewConfigurationWriteConflictError();
    }
    const policy =
      input.target.scope === "workspace"
        ? parseReviewConfigurationStrict(input.policy)
        : parseRepositoryReviewPolicyOverride(input.policy);
    const workspace = this.versions.get("workspace:default")?.at(-1);
    const config =
      input.target.scope === "workspace"
        ? parseReviewConfigurationStrict(policy)
        : resolveReviewPolicy(workspace!.config, policy);
    const persisted = {
      version: (records.at(-1)?.version ?? 0) + 1,
      policy,
      config,
      source: input.target.scope,
      workspaceVersion:
        input.target.scope === "workspace"
          ? records.length + 1
          : workspace!.version,
      repositoryVersion:
        input.target.scope === "repository" ? records.length + 1 : null,
      effectivePolicyDigest: createHash("sha256")
        .update(canonicalJson(config))
        .digest("hex"),
    } satisfies PersistedReviewConfiguration;
    this.versions.set(key, [...records, persisted]);
    this.saveCount += 1;
    return persisted;
  }

  async deleteTarget(
    target: Parameters<ReviewConfigurationRepositoryPort["deleteTarget"]>[0],
  ) {
    return this.versions.delete(reviewConfigurationTargetKey(target));
  }
}
