import type { ReviewConfiguration } from "../../domain/review-configuration";
import type { ReviewConfigurationTarget } from "../../domain/review-configuration-target";
import type {
  ProviderManagementActor,
  ProviderManagementWorkspace,
  ProviderProfileFacts,
} from "../../domain/provider-management-policy";
import type {
  ProviderCredentialRequest,
  ProviderProfileUsage,
  WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";

/** The signed-in user performing a profile or selection write. */
export type ProviderProfileActor = Readonly<{
  userId: string;
  /** Actor reference recorded in the audit log. */
  auditActor: string;
  /**
   * The deployment's local-admin override, decided by the same rule as the
   * dashboard's workspace admin gate; it acts as a workspace admin.
   */
  localAdminOverride?: boolean;
}>;

/**
 * Facts the repository reads under the workspace lock of one write. The use
 * case decides with them before any credential is read or written; throwing
 * refuses.
 */
export type ProviderProfileAuthorityFacts = Readonly<{
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
  profile: ProviderProfileFacts;
}>;

export type ProviderProfileAuthorizer = (
  facts: ProviderProfileAuthorityFacts,
) => void;

/** Facts every profile decision needs before the profile itself is read. */
export type ProviderProfileGateFacts = Readonly<{
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
}>;

/** Decision facts of a display read, with the user-owned gateway bindings. */
export type ProviderManagementFacts = ProviderProfileGateFacts &
  Readonly<{ personalBindingIds: ReadonlySet<string> }>;

type ProfileWrite = Readonly<{
  workspaceId: string;
  profileId: string;
  actor: ProviderProfileActor;
  /** Profile-independent part of the decision, before the profile is read. */
  gate: (facts: ProviderProfileGateFacts) => void;
  authorize: ProviderProfileAuthorizer;
}>;

/** A scope whose effective configuration a model edit changes. */
export type ProviderProfileModelChangeScope = Readonly<{
  target: ReviewConfigurationTarget;
  config: ReviewConfiguration;
}>;

export interface WorkspaceProviderProfileRepositoryPort {
  /**
   * Returns the active profile with the same identity or creates it from the
   * Providers list, in one transaction that also records the creation audit
   * event. Race-safe on the workspace identity key; `authorize` runs before
   * any credential read or personal-actor lock.
   */
  findOrCreate(
    input: Readonly<{
      workspaceId: string;
      actor: ProviderProfileActor;
      credential: ProviderCredentialRequest;
      model: string;
      /** Null keeps the label of an existing profile or a default for a new one. */
      label: string | null;
      authorize: ProviderProfileAuthorizer;
    }>,
  ): Promise<Readonly<{ profile: WorkspaceProviderProfile; created: boolean }>>;

  /** Changes only the label of an active profile and audits the change. */
  rename(
    input: ProfileWrite & Readonly<{ label: string }>,
  ): Promise<WorkspaceProviderProfile>;

  /**
   * Changes the model of an active profile in place for every scope using it.
   * Each affected scope is rematerialized and checked as the editing actor;
   * a scope whose stored settings do not fit the new model refuses the edit
   * with `provider_profile_model_incompatible` listing the scopes.
   */
  changeModel(
    input: ProfileWrite &
      Readonly<{
        model: string;
        /**
         * Pure configuration checks of one affected scope, run inside the
         * write; required so no edit skips the caller's save-time rules.
         */
        validateScope: (scope: ProviderProfileModelChangeScope) => void;
      }>,
  ): Promise<
    Readonly<{
      profile: WorkspaceProviderProfile;
      previousModel: string;
      affected: ProviderProfileUsage;
    }>
  >;

  /**
   * Archives an active profile. A profile still selected by the workspace
   * default or a repository is refused with `provider_profile_in_use`.
   */
  archive(input: ProfileWrite): Promise<WorkspaceProviderProfile>;

  /**
   * Sets the Access rights setting (only owners and admins manage providers)
   * under the same workspace lock as every provider write, so no profile or
   * selection write decides with the old value. `authorize` runs under that
   * lock; the column and its audit event are written in one transaction.
   */
  changeAccessRights(
    input: Readonly<{
      workspaceId: string;
      actor: ProviderProfileActor;
      adminOnly: boolean;
      authorize: (facts: ProviderProfileGateFacts) => void;
      /** Extra audit metadata of the caller, such as its access source. */
      auditMetadata?: Readonly<Record<string, unknown>>;
    }>,
  ): Promise<Readonly<{ adminOnly: boolean; previous: boolean }>>;

  /** Active profiles of the workspace in creation order. */
  list(workspaceId: string): Promise<readonly WorkspaceProviderProfile[]>;

  /**
   * The facts the provider policy decides with, read without locks so the
   * dashboard can explain disabled controls. Every write reads them again
   * under its locks. Null when the workspace is unavailable.
   */
  readManagementFacts(
    input: Readonly<{
      workspaceId: string;
      actor: ProviderProfileActor;
      /** Gateway bindings whose owner the caller needs to know. */
      bindingIds: readonly string[];
    }>,
  ): Promise<ProviderManagementFacts | null>;

  /** Stored selections of every active profile of the workspace. */
  listUsage(workspaceId: string): Promise<readonly ProviderProfileUsage[]>;
}
