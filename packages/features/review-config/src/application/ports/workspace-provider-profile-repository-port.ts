import type {
  ProviderManagementActor,
  ProviderManagementWorkspace,
  ProviderProfileFacts,
  ProviderRepositoryFacts,
} from "../../domain/provider-management-policy";
import type {
  ProviderCredentialRequest,
  WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";

/** The signed-in user performing a profile write. */
export type ProviderProfileActor = Readonly<{
  userId: string;
  /** Actor reference recorded in the audit log. */
  auditActor: string;
}>;

/**
 * Facts the repository reads under the workspace lock of one write. The use
 * case decides with them before anything is written; throwing refuses.
 */
export type ProviderProfileAuthorityFacts = Readonly<{
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
  profile: ProviderProfileFacts;
}>;

export type ProviderProfileAuthorizer = (
  facts: ProviderProfileAuthorityFacts,
) => void;

export interface WorkspaceProviderProfileRepositoryPort {
  /**
   * Returns the active profile with the same identity or creates it, in one
   * transaction that also records the creation audit event. Race-safe on the
   * workspace identity key; `authorize` runs before any credential read.
   */
  findOrCreate(
    input: Readonly<{
      workspaceId: string;
      actor: ProviderProfileActor;
      credential: ProviderCredentialRequest;
      model: string;
      /** Null keeps the label of an existing profile or a default for a new one. */
      label: string | null;
      /** The repository of an attach flow, verified by the caller. */
      repository?: ProviderRepositoryFacts;
      authorize: ProviderProfileAuthorizer;
    }>,
  ): Promise<Readonly<{ profile: WorkspaceProviderProfile; created: boolean }>>;

  /** Changes only the label of an active profile and audits the change. */
  rename(
    input: Readonly<{
      workspaceId: string;
      profileId: string;
      actor: ProviderProfileActor;
      label: string;
      authorize: ProviderProfileAuthorizer;
    }>,
  ): Promise<WorkspaceProviderProfile>;

  /** Active profiles of the workspace in creation order. */
  list(workspaceId: string): Promise<readonly WorkspaceProviderProfile[]>;
}
