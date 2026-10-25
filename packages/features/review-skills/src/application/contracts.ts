export type ReviewSkillsActor = Readonly<{ userId: string }>;
export type ReviewSkillScope = Readonly<{
  includePaths: readonly string[];
  excludePaths: readonly string[];
}>;
export type ReviewSkillContent = Readonly<{
  name: string;
  description: string;
  instructions: string;
}>;
export type ReviewSkillSourceRoot = ".reviewrouter/skills" | ".agents/skills";
export type ReviewSkillsPage<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
}>;
export type ReviewSkillCapabilities = Readonly<{
  canCreate: boolean;
  canAdmin: boolean;
  canEdit: boolean;
  canGrant: boolean;
  canDelete: boolean;
}>;
export type ReviewSkillSummary = Readonly<{
  skillId: string;
  revisionId: string;
  revisionNumber: number;
  name: string;
  description: string;
  sourceWorkspaceId: string;
  sourceWorkspaceName: string;
  authorUserId: string;
  authorName: string;
  linked: boolean;
  updatedAt: string;
  usedIn: readonly Readonly<{ repositoryId: string; name: string }>[];
  capabilities: ReviewSkillCapabilities;
}>;
/** A retained local link may outlive its source permission. Its cleanup view
 * deliberately carries no source, author, or current revision metadata. */
export type ReviewSkillUnavailableSummary = Readonly<{
  skillId: string;
  available: false;
  linked: true;
  name: "Unavailable skill";
  unavailableReason: "unavailable";
  usedIn: ReviewSkillSummary["usedIn"];
  canUnlink: boolean;
}>;
export type ReviewSkillLibraryEntry =
  | (ReviewSkillSummary & Readonly<{ available: true }>)
  | ReviewSkillUnavailableSummary;
export type ReviewSkillDocument = ReviewSkillSummary &
  Readonly<{
    instructions: string;
    createdAt: string;
    canEdit: boolean;
    canGrant: boolean;
    canDelete: boolean;
  }>;
export type ReviewSkillGrantView = Readonly<{
  skillId: string;
  destinationWorkspaceId: string;
  destinationWorkspaceName: string | null;
  version: number;
  active: boolean;
  accepted: boolean;
}>;
export type ReviewSkillLinkView = Readonly<{
  skillId: string;
  workspaceId: string;
  acceptedGrantVersion: number;
  active: boolean;
}>;
export type ReviewSkillLinkChoice = ReviewSkillSummary &
  Readonly<{
    grantVersion: number | null;
    canAccept: boolean;
    canLinkAsDualAdmin: boolean;
  }>;
export type ReviewSkillBindingView = Readonly<{
  skillId: string;
  repositoryId: string;
  generation: string;
  version: number;
  scope: ReviewSkillScope;
}>;
export type ReviewSkillAssignmentChoice = Readonly<{
  skillId: string;
  available: boolean;
  name: string;
  description: string | null;
  sourceWorkspaceId: string | null;
  sourceWorkspaceName: string | null;
  authorName: string | null;
  assignedCount: number;
  repositoryCount: number;
  unavailableReason: string | null;
  bindings: readonly ReviewSkillBindingView[];
}>;
export type ReviewSkillRepositoryTarget = Readonly<{
  repositoryId: string;
  name: string;
  active: boolean;
  assigned: boolean;
  bindingVersion: number | null;
}>;
export type ReviewSkillRepositorySettings = Readonly<{
  repositoryId: string;
  roots: readonly ReviewSkillSourceRoot[];
  sourceVersion: number;
  bindings: readonly ReviewSkillBindingView[];
  unavailable: readonly Readonly<{ skillId: string; name: string }>[];
}>;
export type ReviewSkillAssignmentResult = Readonly<{
  added: number;
  removed: number;
  unchanged: number;
}>;
export type ReviewSkillsRepositoryAccessPort = Readonly<{
  /** Return only exact IDs positively checked through live SCM write/maintain/admin permission.
   * A DB-admin shortcut may return []; the atomic command rechecks the DB role itself. */
  authorizeRepositoryManagement: (
    input: Readonly<{
      actor: ReviewSkillsActor;
      workspaceId: string;
      repositoryIds: readonly string[];
    }>,
  ) => Promise<readonly string[]>;
}>;
type MemberInput = Readonly<{ actor: ReviewSkillsActor; workspaceId: string }>;
type PageInput = Readonly<{ search?: string; cursor?: string | null }>;
type SkillInput = MemberInput & Readonly<{ skillId: string }>;
type RepositoryInput = MemberInput & Readonly<{ repositoryId: string }>;
export interface ReviewSkillsService {
  loadWorkspaceCapabilities(
    input: MemberInput,
  ): Promise<ReviewSkillCapabilities>;
  listWorkspaceSkills(
    input: MemberInput & PageInput,
  ): Promise<ReviewSkillsPage<ReviewSkillLibraryEntry>>;
  loadSkill(input: SkillInput): Promise<ReviewSkillDocument>;
  createSkill(
    input: MemberInput &
      Readonly<{ createOperationId: string; content: ReviewSkillContent }>,
  ): Promise<ReviewSkillDocument>;
  saveSkill(
    input: SkillInput &
      Readonly<{ expectedRevisionId: string; content: ReviewSkillContent }>,
  ): Promise<ReviewSkillDocument>;
  deleteSkill(input: SkillInput): Promise<void>;
  listLinkableSkills(
    input: Readonly<{
      actor: ReviewSkillsActor;
      destinationWorkspaceId: string;
    }> &
      PageInput,
  ): Promise<ReviewSkillsPage<ReviewSkillLinkChoice>>;
  grantSkill(
    input: Readonly<{
      actor: ReviewSkillsActor;
      sourceWorkspaceId: string;
      skillId: string;
      destinationWorkspaceId: string;
    }>,
  ): Promise<ReviewSkillGrantView>;
  revokeSkillGrant(
    input: Readonly<{
      actor: ReviewSkillsActor;
      sourceWorkspaceId: string;
      skillId: string;
      destinationWorkspaceId: string;
      expectedGrantVersion: number;
    }>,
  ): Promise<ReviewSkillGrantView>;
  acceptSkillGrant(
    input: Readonly<{
      actor: ReviewSkillsActor;
      destinationWorkspaceId: string;
      skillId: string;
      expectedGrantVersion: number;
    }>,
  ): Promise<ReviewSkillLinkView>;
  linkSkillAsDualAdmin(
    input: Readonly<{
      actor: ReviewSkillsActor;
      sourceWorkspaceId: string;
      destinationWorkspaceId: string;
      skillId: string;
    }>,
  ): Promise<ReviewSkillLinkView>;
  unlinkSkill(
    input: Readonly<{
      actor: ReviewSkillsActor;
      destinationWorkspaceId: string;
      skillId: string;
    }>,
  ): Promise<void>;
  loadSkillAccess(input: SkillInput): Promise<readonly ReviewSkillGrantView[]>;
  listSkillRepositoryTargets(
    input: SkillInput & PageInput,
  ): Promise<ReviewSkillsPage<ReviewSkillRepositoryTarget>>;
  loadRepositorySkillSettings(
    input: RepositoryInput,
  ): Promise<ReviewSkillRepositorySettings>;
  listAssignmentChoices(
    input: MemberInput &
      PageInput &
      Readonly<{ repositoryIds: readonly string[]; assignedOnly?: boolean }>,
  ): Promise<ReviewSkillsPage<ReviewSkillAssignmentChoice>>;
  applyAssignments(
    input: MemberInput &
      Readonly<{
        repositoryIds: readonly string[];
        skillIds: readonly string[];
        mode: "add" | "remove";
        scope?: ReviewSkillScope;
      }>,
  ): Promise<ReviewSkillAssignmentResult>;
  updateBindingScope(
    input: RepositoryInput &
      Readonly<{
        skillId: string;
        expectedGeneration: string;
        expectedVersion: number;
        scope: ReviewSkillScope;
      }>,
  ): Promise<ReviewSkillBindingView>;
  setRepositorySources(
    input: RepositoryInput &
      Readonly<{
        expectedVersion: number;
        roots: readonly ReviewSkillSourceRoot[];
      }>,
  ): Promise<ReviewSkillRepositorySettings>;
}
export type ReviewSkillsAdmissionInput = Readonly<{
  workspaceId: string;
  repositoryConnectionId: string;
  baseSha: string;
}>;
export type ReviewSkillsAdmissionSelection = Readonly<{
  sourceWorkspaceIds: readonly string[];
  webSkills: readonly Readonly<{
    skillId: string;
    revisionId: string;
    sourceWorkspaceId: string;
    name: string;
    description: string;
    instructions: string;
    includePaths: readonly string[];
    excludePaths: readonly string[];
  }>[];
  gitSources: readonly Readonly<{ root: ReviewSkillSourceRoot }>[];
}>;
