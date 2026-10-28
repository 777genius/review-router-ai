import {
  composeEffectiveReviewConfiguration,
  persistedReviewConfiguration,
  readyReviewConfiguration,
} from "../application/use-cases/resolve-effective-review-configuration";
import { canonicalJson } from "../domain/review-configuration";
import {
  parseReviewPolicyDocument,
  resolveEffectiveReviewPolicy,
  STORED_REVIEW_POLICY_SCHEMA_VERSION,
  type RepositoryReviewPolicy,
  type WorkspaceReviewPolicy,
} from "../domain/review-policy-document";
import {
  reviewConfigurationTargetKey,
  type ReviewConfigurationTarget,
} from "../domain/review-configuration-target";
import type { WorkspaceProviderProfile } from "../domain/workspace-provider-profile";
import {
  ReviewConfigurationWriteConflictError,
  type ReviewConfigurationRepositoryPort,
  type ReviewPolicyHead,
  type ReviewPolicyHeadReaderPort,
  type SavedReviewPolicy,
} from "../application/ports/review-configuration-repository-port";

/**
 * Stored documents and profiles of one workspace, resolved by the real
 * domain. System writes only: no selection authority or profile drafts.
 */
export class InMemoryReviewConfigurationRepository
  implements ReviewConfigurationRepositoryPort, ReviewPolicyHeadReaderPort
{
  readonly heads = new Map<string, ReviewPolicyHead[]>();
  readonly inactiveTargets = new Set<string>();
  readonly profiles = new Map<string, WorkspaceProviderProfile>();
  saveCount = 0;
  conflictNextSave = false;

  addProfile(profile: WorkspaceProviderProfile): this {
    this.profiles.set(profile.id, profile);
    return this;
  }

  async findLatest(target: ReviewConfigurationTarget) {
    return readyReviewConfiguration(
      composeEffectiveReviewConfiguration(
        target,
        await this.readPolicyHeads(target),
      ),
    );
  }

  async readPolicyHeads(target: ReviewConfigurationTarget) {
    return {
      workspace: this.head("workspace:default"),
      repository:
        target.scope === "repository"
          ? this.head(reviewConfigurationTargetKey(target))
          : null,
      profiles: this.profiles,
    };
  }

  async readRepositoryPolicyHeads(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }) {
    return {
      workspace: this.head("workspace:default"),
      repositories: new Map(
        input.repositoryIds.flatMap((repositoryId) => {
          const head = this.head(`repo:${repositoryId}`);
          return head ? [[repositoryId, head] as const] : [];
        }),
      ),
      profiles: this.profiles,
    };
  }

  async readWorkspacePolicyHeads() {
    return {
      workspace: this.head("workspace:default"),
      repositories: new Map(
        [...this.heads.keys()].flatMap((key) => {
          const head = key.startsWith("repo:") ? this.head(key) : null;
          return head ? [[key.slice("repo:".length), head] as const] : [];
        }),
      ),
      profiles: this.profiles,
    };
  }

  async readProviderProfiles() {
    return this.profiles;
  }

  async saveNextVersion(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersion"]>[0],
  ) {
    const [saved] = await this.saveNextVersions({
      workspaceId: input.target.workspaceId,
      writes: [input],
    });
    if (!saved?.configuration)
      throw new Error("review_provider_selection_required");
    return saved.configuration;
  }

  async saveNextVersions(
    input: Parameters<ReviewConfigurationRepositoryPort["saveNextVersions"]>[0],
  ): Promise<readonly SavedReviewPolicy[]> {
    if (input.profileDrafts?.length || input.selectionAuthority)
      throw new Error("in_memory_review_configuration_system_writes_only");
    if (this.conflictNextSave) {
      this.conflictNextSave = false;
      throw new ReviewConfigurationWriteConflictError();
    }
    const writes = [...input.writes].sort(
      (left, right) =>
        Number(left.target.scope === "repository") -
        Number(right.target.scope === "repository"),
    );
    for (const write of writes) {
      const current = this.head(reviewConfigurationTargetKey(write.target));
      if (
        write.expectedVersion !== undefined &&
        (current?.version ?? null) !== write.expectedVersion
      )
        throw new ReviewConfigurationWriteConflictError();
    }
    const workspaceWrite = writes.find(
      (write) => write.target.scope === "workspace",
    );
    const workspace = (
      workspaceWrite
        ? parseReviewPolicyDocument("workspace", workspaceWrite.policy)
        : parseStored(this.head("workspace:default"), "workspace")
    ) as WorkspaceReviewPolicy | null;
    if (!workspace) throw new ReviewConfigurationWriteConflictError();
    const saved: SavedReviewPolicy[] = [];
    let workspaceVersion = this.head("workspace:default")?.version;
    for (const write of writes) {
      const policy = parseReviewPolicyDocument(
        write.target.scope,
        write.policy,
      );
      const resolved = resolveEffectiveReviewPolicy({
        target: write.target,
        workspace,
        repository:
          write.target.scope === "repository"
            ? (policy as RepositoryReviewPolicy)
            : null,
        profiles: this.profiles,
      });
      const key = reviewConfigurationTargetKey(write.target);
      const records = this.heads.get(key) ?? [];
      const version = (records.at(-1)?.version ?? 0) + 1;
      if (write.target.scope === "workspace") workspaceVersion = version;
      this.heads.set(key, [
        ...records,
        {
          version,
          schemaVersion: STORED_REVIEW_POLICY_SCHEMA_VERSION,
          policyJson: canonicalJson(policy),
        },
      ]);
      this.inactiveTargets.delete(key);
      this.saveCount += 1;
      saved.push({
        target: write.target,
        version,
        configuration: resolved
          ? persistedReviewConfiguration({
              config: resolved.config,
              selections: resolved.selections,
              policy,
              workspaceVersion: workspaceVersion!,
              repositoryVersion:
                write.target.scope === "repository" ? version : null,
            })
          : null,
      });
    }
    return saved;
  }

  async deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
  ) {
    const key = reviewConfigurationTargetKey(target);
    const current = this.head(key)?.version ?? null;
    if (expectedVersion !== undefined && current !== expectedVersion)
      throw new ReviewConfigurationWriteConflictError();
    if (current === null) return false;
    this.inactiveTargets.add(key);
    return true;
  }

  private head(key: string): ReviewPolicyHead | null {
    if (this.inactiveTargets.has(key)) return null;
    return this.heads.get(key)?.at(-1) ?? null;
  }
}

function parseStored(
  head: ReviewPolicyHead | null,
  scope: ReviewConfigurationTarget["scope"],
) {
  if (!head?.policyJson) return null;
  return parseReviewPolicyDocument(scope, JSON.parse(head.policyJson));
}
