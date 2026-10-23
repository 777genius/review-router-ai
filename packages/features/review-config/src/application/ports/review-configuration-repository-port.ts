import type {
  RepositoryReviewPolicyOverride,
  ReviewConfiguration,
  WorkspaceReviewPolicy,
} from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";

export type PersistedReviewConfiguration = {
  readonly version: number;
  readonly config: ReviewConfiguration;
  readonly policy: WorkspaceReviewPolicy | RepositoryReviewPolicyOverride;
  readonly source: "workspace" | "repository";
  readonly workspaceVersion: number | null;
  readonly repositoryVersion: number | null;
  readonly effectivePolicyDigest: string;
  readonly revisionToken?: string;
};

export type ReviewPolicySaveInput =
  | {
      readonly target: Extract<
        ReviewConfigurationTarget,
        { scope: "workspace" }
      >;
      readonly policy: WorkspaceReviewPolicy;
    }
  | {
      readonly target: Extract<
        ReviewConfigurationTarget,
        { scope: "repository" }
      >;
      readonly policy: RepositoryReviewPolicyOverride;
    };

export type ReviewConfigurationOperationInput = Readonly<{
  expectedVersion: number | null;
  operationId: string;
}> &
  ReviewPolicySaveInput;

/** Callers must authorize the target against live membership on EVERY call.
 * A receipt records a historical write; it never authorizes selection/execution.
 */
export interface ReviewConfigurationOperationRepositoryPort {
  saveNextVersionWithOperation(
    input: ReviewConfigurationOperationInput,
  ): Promise<PersistedReviewConfiguration>;

  findOperation(input: {
    readonly target: ReviewConfigurationTarget;
    readonly operationId: string;
    /** Original CAS intent, independent of the retained result version. */
    readonly expectedVersion: number | null;
  }): Promise<PersistedReviewConfiguration | null>;
}

/** Latest version of an active target, read before its document is parsed. */
export type ReviewPolicyHead = Readonly<{
  version: number;
  schemaVersion: number;
  policyJson: string | null;
}>;

/**
 * Read-only boundary of the effective-configuration resolver, kept separate
 * from the mutable repository port so readers do not need write capability.
 */
export interface ReviewPolicyHeadReaderPort {
  readPolicyHeads(target: ReviewConfigurationTarget): Promise<
    Readonly<{
      workspace: ReviewPolicyHead | null;
      repository: ReviewPolicyHead | null;
    }>
  >;

  /** One workspace read and one bounded read for all repository heads. */
  readRepositoryPolicyHeads(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }): Promise<
    Readonly<{
      workspace: ReviewPolicyHead | null;
      repositories: ReadonlyMap<string, ReviewPolicyHead>;
    }>
  >;
}

export class ReviewConfigurationWriteConflictError extends Error {
  readonly code = "review_configuration_write_conflict";

  constructor() {
    super("review_configuration_write_conflict");
    this.name = "ReviewConfigurationWriteConflictError";
  }
}

export function isReviewConfigurationWriteConflictError(
  error: unknown,
): error is ReviewConfigurationWriteConflictError {
  return (
    error instanceof ReviewConfigurationWriteConflictError ||
    (typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "review_configuration_write_conflict")
  );
}

export interface ReviewConfigurationRepositoryPort {
  findLatest(
    target: ReviewConfigurationTarget,
  ): Promise<PersistedReviewConfiguration | null>;

  saveNextVersion(input: {
    readonly target: ReviewConfigurationTarget;
    readonly policy: WorkspaceReviewPolicy | RepositoryReviewPolicyOverride;
    /**
     * Omitted disables CAS, null expects no version, and a number expects that
     * exact latest version. Implementations throw a write conflict on mismatch.
     */
    readonly expectedVersion?: number | null;
  }): Promise<PersistedReviewConfiguration>;

  /** Deactivate without deleting history. Optional CAS uses the active raw head,
   * including retired formats; null expects no active version. */
  deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
  ): Promise<boolean>;
}
