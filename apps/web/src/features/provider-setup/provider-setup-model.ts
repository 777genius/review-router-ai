import type { ProviderIdentity } from "./provider-identity";
import type { SetupProviderId } from "./setup-provider";
import {
  decideProviderManagement,
  type ProviderManagementActor,
  type ProviderManagementDecision,
  type ProviderManagementDenialReason,
  type ProviderManagementWorkspace,
  type ProviderRepositoryCapability,
} from "@reviewrouter/features-review-config/provider-management-policy";
import type {
  ProviderCredentialKind,
  ManagedApiKeyAuthMode,
  UserCiSecretAuthMode,
} from "@reviewrouter/features-review-config/workspace-provider-profile";
import type { ReviewProviderSelection } from "@reviewrouter/features-review-config/review-policy-document";
import {
  apiKeyProviders,
  apiKeyProviderForAuthMode,
  getApiKeyProvider,
  type ProviderAuthMode,
} from "@reviewrouter/features-review-providers";

/**
 * View model of the provider dialog. Built on the server from verified facts
 * with the single provider management policy; the client only renders it.
 * Every write decides again under its own locks.
 */

/** Repositories one dialog may target at once (the assignment bound). */
export const PROVIDER_SETUP_MAX_REPOSITORIES = 100;

/** "1 repository", "3 repositories". */
export function repositoryCountLabel(count: number): string {
  return `${count} ${count === 1 ? "repository" : "repositories"}`;
}

/** Who the dialog configures. Repository targets are fixed by the caller. */
export type ProviderSetupTarget =
  | Readonly<{ kind: "workspace" }>
  | Readonly<{ kind: "repositories"; repositoryIds: readonly string[] }>;

/** Reasons the dialog adds to the policy's own denial reasons. */
export type ProviderSetupDenialReason =
  | ProviderManagementDenialReason
  | "managed_key_not_installed"
  | "managed_key_admin_required";

export type ProviderSetupDecision =
  | Readonly<{ allowed: true }>
  | Readonly<{ allowed: false; reason: ProviderSetupDenialReason }>;

/** Review settings of one selection; the dialog always requires it healthy. */
export type ProviderSelectionSettings = Omit<
  ReviewProviderSelection,
  "profileId" | "requiredHealthy"
>;

/** A provider the workspace already has. */
export type ProviderProfileOption = Readonly<{
  id: string;
  label: string;
  model: string;
  providerId?: ProviderIdentity | undefined;
  authMode: ProviderAuthMode;
  credentialKind: ProviderCredentialKind;
  gatewayBindingId: string | null;
  gatewayProfileRef?: string | null;
  isDefault: boolean;
  decision: ProviderSetupDecision;
  /** Selected repositories that refuse it; the others accept it. */
  refusedRepositoryCount: number;
}>;

/** The credential sources a new provider can use. */
export type ProviderSourceKey =
  | "gateway_binding"
  | "managed_api_key:mimo_token_plan_api_key"
  | "managed_api_key:openrouter_api_key"
  | "user_ci_secret:claude_code_oauth"
  | "user_ci_secret:mimo_token_plan_api_key"
  | "user_ci_secret:openrouter_api_key"
  | "user_ci_secret:kimi_code_api_key"
  | "repository_rotating";

export type ProviderSourceOption = Readonly<{
  key: ProviderSourceKey;
  credentialKind: ProviderCredentialKind;
  authMode: ProviderAuthMode;
  decision: ProviderSetupDecision;
  /** Gateway only: the decision for an account its owner shares. */
  personalAccountDecision?: ProviderSetupDecision;
  /** Managed keys only: the server-held key and where it is installed. */
  managedKey?: Readonly<{
    uploaded: boolean;
    installedRepositoryIds: readonly string[];
    /** Uploading or installing the key (owner/admin). */
    install: ProviderSetupDecision;
  }>;
}>;

export type ProviderSetupRepositoryView = Readonly<{
  id: string;
  fullName: string;
  /** Where the repository's provider comes from now. */
  source: "repository" | "workspace" | "none";
  /** Its own selection, when it has one. */
  selection: ReviewProviderSelection | null;
  /** Going back to the workspace default. */
  useDefault: ProviderSetupDecision;
}>;

export type ProviderSetupView = Readonly<{
  workspaceId: string;
  target: ProviderSetupTarget["kind"];
  repositories: readonly ProviderSetupRepositoryView[];
  defaultSelection: ReviewProviderSelection | null;
  profiles: readonly ProviderProfileOption[];
  sources: readonly ProviderSourceOption[];
  viewerIsAdmin: boolean;
  /** Enrollment capabilities, independent of whether an account exists yet. */
  gatewaySetupProviders?: readonly SetupProviderId[];
}>;

/** Verified facts of one dialog read. */
export type ProviderSetupFacts = Readonly<{
  workspaceId: string;
  target: ProviderSetupTarget["kind"];
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
  profiles: readonly Readonly<{
    id: string;
    label: string;
    model: string;
    providerId?: ProviderIdentity | undefined;
    authMode: ProviderAuthMode;
    credentialKind: ProviderCredentialKind;
    createdByUserId: string | null;
    gatewayBindingId: string | null;
    gatewayProfileRef?: string | null;
    personalBinding: boolean;
    rotatingRepositoryId: string | null;
  }>[];
  defaultSelection: ReviewProviderSelection | null;
  repositories: readonly Readonly<{
    id: string;
    fullName: string;
    capability: ProviderRepositoryCapability | null;
    ownSelection: ReviewProviderSelection | null;
    rotatingAvailable: boolean;
  }>[];
  managedKeys: Readonly<
    Record<
      ManagedApiKeyAuthMode,
      Readonly<{
        uploaded: boolean;
        installedRepositoryIds: ReadonlySet<string>;
      }>
    >
  >;
  claudeCodeEnabled: boolean;
  gatewaySetupProviders?: readonly SetupProviderId[];
}>;

const allowed: ProviderSetupDecision = { allowed: true };

const ciSecretSources = [
  "user_ci_secret:claude_code_oauth",
  ...apiKeyProviders.map(
    (provider) => `user_ci_secret:${provider.directAuthMode}` as const,
  ),
] as const;

export function buildProviderSetupView(
  facts: ProviderSetupFacts,
): ProviderSetupView {
  const decide = (
    action: Parameters<typeof decideProviderManagement>[0]["action"],
  ): ProviderSetupDecision =>
    toDecision(
      decideProviderManagement({
        actor: facts.actor,
        workspace: facts.workspace,
        action,
      }),
    );
  const admin = facts.actor.role === "owner" || facts.actor.role === "admin";
  const repositoryFacts = (repository: ProviderSetupFacts["repositories"][0]) =>
    ({
      repositoryId: repository.id,
      capability: repository.capability,
    }) as const;
  const singleRepository =
    facts.target === "repositories" && facts.repositories.length === 1
      ? facts.repositories[0]!
      : null;

  /**
   * One decision over every selected repository: allowed while at least one
   * accepts it, so a bulk assignment reports the refusals per repository.
   */
  const acrossRepositories = (
    decideFor: (
      repository: ProviderSetupFacts["repositories"][0],
    ) => ProviderSetupDecision,
  ): { decision: ProviderSetupDecision; refused: number } => {
    const decisions = facts.repositories.map(decideFor);
    const refused = decisions.filter((decision) => !decision.allowed).length;
    const firstRefusal = decisions.find((decision) => !decision.allowed);
    return {
      decision:
        refused < decisions.length || !firstRefusal ? allowed : firstRefusal,
      refused,
    };
  };

  const profiles = facts.profiles.flatMap(
    (profile): ProviderProfileOption[] => {
      // A rotating credential lives in one repository and is never a default;
      // hosted pool selections go through the hosted session source flow.
      if (profile.credentialKind === "hosted_pool") return [];
      if (
        profile.credentialKind === "repository_rotating" &&
        profile.rotatingRepositoryId !== singleRepository?.id
      )
        return [];
      const profileFacts = {
        credentialKind: profile.credentialKind,
        createdByUserId: profile.createdByUserId,
        personalBinding: profile.personalBinding,
        repositoryId: profile.rotatingRepositoryId,
      };
      const option = {
        id: profile.id,
        label: profile.label,
        model: profile.model,
        ...(profile.providerId ? { providerId: profile.providerId } : {}),
        authMode: profile.authMode,
        credentialKind: profile.credentialKind,
        gatewayBindingId: profile.gatewayBindingId,
        gatewayProfileRef: profile.gatewayProfileRef ?? null,
        isDefault: facts.defaultSelection?.profileId === profile.id,
      };
      if (facts.target === "workspace")
        return [
          {
            ...option,
            decision: decide({ kind: "set_default", profile: profileFacts }),
            refusedRepositoryCount: 0,
          },
        ];
      const { decision, refused } = acrossRepositories((repository) =>
        managedKeyDenial(
          profile.credentialKind,
          decide({
            kind: "attach_profile",
            profile: profileFacts,
            repository: repositoryFacts(repository),
            managedKeyApplied: managedKeyInstalled(
              facts,
              profile.authMode,
              repository.id,
            ),
          }),
        ),
      );
      return [{ ...option, decision, refusedRepositoryCount: refused }];
    },
  );

  const createDecision = (
    profile: Readonly<{
      credentialKind: ProviderCredentialKind;
      authMode: ProviderAuthMode;
      personalBinding: boolean;
      repositoryId: string | null;
    }>,
  ): ProviderSetupDecision => {
    const profileFacts = {
      credentialKind: profile.credentialKind,
      personalBinding: profile.personalBinding,
      repositoryId: profile.repositoryId,
    };
    if (facts.target === "workspace") {
      const create = decide({ kind: "create_profile", profile: profileFacts });
      if (!create.allowed) return create;
      return decide({
        kind: "set_default",
        profile: { ...profileFacts, createdByUserId: facts.actor.userId },
      });
    }
    return acrossRepositories((repository) =>
      managedKeyDenial(
        profile.credentialKind,
        decide({
          kind: "create_and_attach",
          profile: profileFacts,
          repository: repositoryFacts(repository),
          managedKeyApplied: managedKeyInstalled(
            facts,
            profile.authMode,
            repository.id,
          ),
        }),
      ),
    ).decision;
  };

  const sources: ProviderSourceOption[] = [
    {
      key: "gateway_binding",
      credentialKind: "gateway_binding",
      authMode: "codex_account_gateway",
      decision: createDecision({
        credentialKind: "gateway_binding",
        authMode: "codex_account_gateway",
        personalBinding: false,
        repositoryId: null,
      }),
      personalAccountDecision: createDecision({
        credentialKind: "gateway_binding",
        authMode: "codex_account_gateway",
        personalBinding: true,
        repositoryId: null,
      }),
    },
    ...(["mimo_token_plan_api_key", "openrouter_api_key"] as const).map(
      (authMode): ProviderSourceOption => {
        const key = facts.managedKeys[authMode];
        const install = admin
          ? decide({ kind: "manage_managed_key" })
          : ({
              allowed: false,
              reason: "managed_key_admin_required",
            } as const);
        const decision = createDecision({
          credentialKind: "managed_api_key",
          authMode,
          personalBinding: false,
          repositoryId: null,
        });
        return {
          key: `managed_api_key:${authMode}`,
          credentialKind: "managed_api_key",
          authMode,
          // The workspace list needs a stored key; a repository can have one
          // installed in the same step by an owner or admin.
          decision:
            !key.uploaded &&
            decision.allowed &&
            (facts.target === "workspace" || !install.allowed)
              ? { allowed: false, reason: "managed_key_not_installed" }
              : decision,
          managedKey: {
            uploaded: key.uploaded,
            installedRepositoryIds: facts.repositories
              .filter((repository) =>
                key.installedRepositoryIds.has(repository.id),
              )
              .map((repository) => repository.id),
            install,
          },
        };
      },
    ),
    ...ciSecretSources
      .filter(
        (key) =>
          key !== "user_ci_secret:claude_code_oauth" || facts.claudeCodeEnabled,
      )
      .map((key): ProviderSourceOption => {
        const authMode = key.slice(
          "user_ci_secret:".length,
        ) as UserCiSecretAuthMode;
        return {
          key,
          credentialKind: "user_ci_secret",
          authMode,
          decision: createDecision({
            credentialKind: "user_ci_secret",
            authMode,
            personalBinding: false,
            repositoryId: null,
          }),
        };
      }),
    ...(singleRepository?.rotatingAvailable
      ? [
          {
            key: "repository_rotating",
            credentialKind: "repository_rotating",
            authMode: "codex_subscription_oauth_rotating",
            decision: createDecision({
              credentialKind: "repository_rotating",
              authMode: "codex_subscription_oauth_rotating",
              personalBinding: false,
              repositoryId: singleRepository.id,
            }),
          } satisfies ProviderSourceOption,
        ]
      : []),
  ];

  return {
    workspaceId: facts.workspaceId,
    target: facts.target,
    repositories: facts.repositories.map((repository) => ({
      id: repository.id,
      fullName: repository.fullName,
      source: repository.ownSelection
        ? "repository"
        : facts.defaultSelection
          ? "workspace"
          : "none",
      selection: repository.ownSelection,
      useDefault: decide({
        kind: "clear_selection",
        repository: repositoryFacts(repository),
      }),
    })),
    defaultSelection: facts.defaultSelection,
    profiles,
    sources,
    viewerIsAdmin: admin,
    ...(facts.gatewaySetupProviders
      ? { gatewaySetupProviders: facts.gatewaySetupProviders }
      : {}),
  };
}

function managedKeyInstalled(
  facts: ProviderSetupFacts,
  authMode: ProviderAuthMode,
  repositoryId: string,
): boolean {
  return (
    (authMode === "mimo_token_plan_api_key" ||
      authMode === "openrouter_api_key") &&
    facts.managedKeys[authMode].installedRepositoryIds.has(repositoryId)
  );
}

/**
 * A member may use a saved key only where it is installed; elsewhere the
 * policy's owner/admin refusal means "install the key first", so say that.
 */
export function managedKeyDenial(
  credentialKind: ProviderCredentialKind,
  decision: ProviderSetupDecision,
): ProviderSetupDecision {
  return credentialKind === "managed_api_key" &&
    !decision.allowed &&
    decision.reason === "workspace_admin_required"
    ? { allowed: false, reason: "managed_key_admin_required" }
    : decision;
}

function toDecision(
  decision: ProviderManagementDecision,
): ProviderSetupDecision {
  return decision.allowed
    ? allowed
    : { allowed: false, reason: decision.reason };
}

/** Plain-language reason shown beside a disabled control. */
export function providerSetupDenialText(
  reason: ProviderSetupDenialReason,
): string {
  switch (reason) {
    case "workspace_member_required":
      return "Only members of this workspace can add providers.";
    case "workspace_admin_required":
      return "Only workspace owners and admins can do this.";
    case "access_rights_admin_only":
      return "Only workspace owners and admins can manage providers.";
    case "personal_binding_owner_required":
      return "This account is shared by its owner, so only an owner or admin can use it here.";
    case "profile_creator_required":
      return "Only the person who added this provider, or an owner or admin, can change it.";
    case "repository_direct_config_required":
      return "You need maintain or admin access to this repository on GitHub.";
    case "repository_manager_required":
      return "You need write access to this repository on GitHub.";
    case "rotating_profile_repository_only":
      return "This Codex subscription belongs to another repository.";
    case "rotating_profile_not_default":
      return "A Codex subscription with automatic refresh works for one repository and cannot be the workspace default.";
    case "managed_key_not_installed":
      return "The key is not saved yet. An owner or admin installs it in a repository first.";
    case "managed_key_admin_required":
      return "The key is not installed in this repository yet, and only workspace owners and admins install keys.";
  }
}

export type CredentialStepKind = "ci_secret" | "managed_key" | "rotating";

/** Whether the provider needs a credential step in the repository, and which. */
export function credentialStepOf(
  provider: Readonly<{ credentialKind: ProviderCredentialKind }>,
): CredentialStepKind | null {
  switch (provider.credentialKind) {
    case "user_ci_secret":
      return "ci_secret";
    case "managed_api_key":
      return "managed_key";
    case "repository_rotating":
      return "rotating";
    case "gateway_binding":
    case "hosted_pool":
      return null;
  }
}

export function credentialStepLabel(step: CredentialStepKind): string {
  switch (step) {
    case "ci_secret":
      return "Add secret";
    case "managed_key":
      return "Install key";
    case "rotating":
      return "Connect Codex";
  }
}

/** Plain name of where a provider's credential comes from. */
export function sourceTitle(
  credentialKind: ProviderCredentialKind,
  authMode: ProviderAuthMode,
): string {
  switch (credentialKind) {
    case "gateway_binding":
      return "Connected account";
    case "managed_api_key":
      return "GitHub Secrets · managed by ReviewRouter";
    case "user_ci_secret": {
      const provider = apiKeyProviderForAuthMode(authMode);
      return provider
        ? `${getApiKeyProvider(provider).label} · GitHub Secrets`
        : "Claude Code · GitHub Secrets";
    }
    case "repository_rotating":
      return "Codex · GitHub Secrets";
    case "hosted_pool":
      return "Hosted Codex pool";
  }
}
