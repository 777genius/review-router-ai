import type {
  ActionHealthReport,
  ActionRepositoryContext,
  ActionSessionClaims,
} from "../../domain/action-control-plane.js";
import type { ReviewConfiguration } from "@reviewrouter/features-review-config";

export type RuntimeReviewConfigurationRecord = {
  readonly source: "repository" | "workspace";
  readonly version: number;
  readonly workspaceVersion: number | null;
  readonly repositoryVersion: number | null;
  readonly effectivePolicyDigest: string;
  readonly config: ReviewConfiguration;
};

export function runtimeReviewConfigurationSnapshotId(
  record: RuntimeReviewConfigurationRecord | null,
): string {
  if (!record) return "policy:unconfigured";
  return `policy:${record.workspaceVersion ?? 0}:${record.repositoryVersion ?? 0}:${record.effectivePolicyDigest}`;
}

export interface ActionControlPlaneRepositoryPort {
  findSelectedRepositoryByGithubId(
    githubRepositoryId: string,
  ): Promise<ActionRepositoryContext | null>;

  findRuntimeReviewConfiguration(input: {
    readonly workspaceId: string;
    readonly repositoryId: string;
  }): Promise<RuntimeReviewConfigurationRecord | null>;

  recordHealthReport(input: {
    readonly session: ActionSessionClaims;
    readonly report: ActionHealthReport;
    readonly receivedAt: Date;
  }): Promise<void>;
}
