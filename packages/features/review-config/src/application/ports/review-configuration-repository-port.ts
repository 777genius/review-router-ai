import type { ReviewConfiguration } from "../../domain/review-configuration";
import type {
  ReviewPolicyDocument,
  ReviewProviderSelection,
} from "../../domain/review-policy-document";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  ProviderManagementActor,
  ProviderManagementWorkspace,
  ProviderProfileFacts,
} from "../../domain/provider-management-policy";
import type {
  ProviderCredentialRequest,
  WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";

export type PersistedReviewConfiguration = {
  readonly version: number;
  /** Runtime configuration materialized from the documents and profiles. */
  readonly config: ReviewConfiguration;
  /** The stored document of the source scope. */
  readonly policy: ReviewPolicyDocument;
  readonly source: "workspace" | "repository";
  readonly workspaceVersion: number | null;
  readonly repositoryVersion: number | null;
  readonly effectivePolicyDigest: string;
  readonly revisionToken?: string;
  /** Effective provider selections, in the order of `config.providers`. */
  readonly selections: readonly ReviewProviderSelection[];
};

/** A profile a changed selection uses, with the facts its decision needs. */
export type SelectedProviderProfileFacts = ProviderProfileFacts &
  Readonly<{
    /** Managed keys only: the key is applied to the target repository. */
    managedKeyApplied: boolean;
    /**
     * Requested as a draft in this write, so it is created (or found by its
     * identity) together with the selection and decided with it.
     */
    draft: boolean;
  }>;

/**
 * A provider a write creates together with the selection that uses it. The
 * stored documents reference it by `draftId`; the write replaces the draft
 * reference with the found or created profile in the same transaction.
 */
export type ProviderProfileDraft = Readonly<{
  draftId: string;
  credential: ProviderCredentialRequest;
  model: string;
  label: string | null;
}>;

/**
 * Facts of a write that changes the stored selection of its scope, read under
 * the workspace lock. An empty profile list removes the selection.
 */
export type ProviderSelectionAuthorityFacts = Readonly<{
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
  target: ReviewConfigurationTarget;
  profiles: readonly SelectedProviderProfileFacts[];
}>;

/**
 * The signed-in user of a selection write. `authorize` runs only when the
 * stored selection changes or explicit workspace memory settings are written;
 * throwing refuses the write.
 */
export type ProviderSelectionAuthority = Readonly<{
  userId: string;
  auditActor: string;
  /** The dashboard's local-admin override; acts as a workspace admin. */
  localAdminOverride?: boolean;
  authorize: (facts: ProviderSelectionAuthorityFacts) => void;
}>;

/** Latest version of an active target, read before its document is parsed. */
export type ReviewPolicyHead = Readonly<{
  version: number;
  schemaVersion: number;
  policyJson: string | null;
}>;

/** Profiles referenced by the heads of one read, active or archived. */
export type ReviewPolicyProfiles = ReadonlyMap<
  string,
  WorkspaceProviderProfile
>;

/**
 * Read-only boundary of the effective-configuration resolver, kept separate
 * from the mutable repository port so readers do not need write capability.
 * Heads and the profiles they reference come from the same read.
 */
export interface ReviewPolicyHeadReaderPort {
  readPolicyHeads(target: ReviewConfigurationTarget): Promise<
    Readonly<{
      workspace: ReviewPolicyHead | null;
      repository: ReviewPolicyHead | null;
      profiles: ReviewPolicyProfiles;
    }>
  >;

  /** One workspace read and one bounded read for all repository heads. */
  readRepositoryPolicyHeads(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }): Promise<WorkspacePolicyHeads>;

  /** Every active head of the workspace, for usage and impact reads. */
  readWorkspacePolicyHeads(workspaceId: string): Promise<WorkspacePolicyHeads>;

  /** Profiles of the workspace by ID, archived ones included. */
  readProviderProfiles(input: {
    readonly workspaceId: string;
    readonly profileIds: readonly string[];
  }): Promise<ReviewPolicyProfiles>;
}

export type WorkspacePolicyHeads = Readonly<{
  workspace: ReviewPolicyHead | null;
  repositories: ReadonlyMap<string, ReviewPolicyHead>;
  profiles: ReviewPolicyProfiles;
}>;

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

/** One document of an atomic multi-document policy write. */
export type ReviewPolicyWrite = Readonly<{
  target: ReviewConfigurationTarget;
  policy: ReviewPolicyDocument;
  /** As in saveNextVersion: omitted disables CAS, null expects no version. */
  expectedVersion?: number | null;
  /** The validated effective digest; null expects the target to select none. */
  expectedEffectivePolicyDigest?: string | null;
  /**
   * A document written only because the subject needs it (the workspace
   * document a first attach creates); the batch's audit skips it.
   */
  implicit?: boolean;
}>;

/** Recorded once per written document, except implicit ones. */
export type ReviewPolicyWriteAudit = Readonly<{
  actor: string;
  action: string;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type SavedReviewPolicy = Readonly<{
  target: ReviewConfigurationTarget;
  version: number;
  /** The target's configuration after the write; null when it selects none. */
  configuration: PersistedReviewConfiguration | null;
}>;

export interface ReviewConfigurationRepositoryPort {
  findLatest(
    target: ReviewConfigurationTarget,
  ): Promise<PersistedReviewConfiguration | null>;

  saveNextVersion(input: {
    readonly target: ReviewConfigurationTarget;
    readonly policy: ReviewPolicyDocument;
    /**
     * Omitted disables CAS, null expects no version, and a number expects that
     * exact latest version. Implementations throw a write conflict on mismatch.
     */
    readonly expectedVersion?: number | null;
    /**
     * The digest of the effective configuration the caller validated before
     * the transaction; a different result is a write conflict.
     */
    readonly expectedEffectivePolicyDigest?: string;
    /** Absent for system writers, which are exempt from the provider policy. */
    readonly selectionAuthority?: ProviderSelectionAuthority;
    readonly profileDrafts?: readonly ProviderProfileDraft[];
  }): Promise<PersistedReviewConfiguration>;

  /**
   * Writes the workspace document and/or repository documents of one
   * workspace atomically, declaring every scope guard up front. A repository
   * write needs a workspace document, stored or written in the same batch;
   * otherwise it is a write conflict and the caller rereads.
   */
  saveNextVersions(input: {
    readonly workspaceId: string;
    readonly writes: readonly ReviewPolicyWrite[];
    /** Observed inherited workspace head, checked under the same scope locks. */
    readonly expectedWorkspaceVersion?: number | null;
    readonly selectionAuthority?: ProviderSelectionAuthority;
    readonly profileDrafts?: readonly ProviderProfileDraft[];
    /**
     * Creator of draft profiles of a system write; defaults to the selection
     * authority's user, else a system creator (null).
     */
    readonly profileCreatorUserId?: string | null;
    readonly audit?: ReviewPolicyWriteAudit;
  }): Promise<readonly SavedReviewPolicy[]>;

  /** Deactivate without deleting history. Optional CAS uses the active raw head,
   * including retired formats; null expects no active version. */
  deleteTarget(
    target: ReviewConfigurationTarget,
    expectedVersion?: number | null,
    selectionAuthority?: ProviderSelectionAuthority,
  ): Promise<boolean>;
}
