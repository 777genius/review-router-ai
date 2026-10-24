/**
 * The fixed data set of the provider setup visual qualification (plan S7).
 * Seed, GitHub HTTP fixture, scenarios and the seed test read this one
 * declaration, so a state is added by adding data, not code. Every row the
 * seed writes uses an ID or a GitHub number from here; nothing else is ever
 * reset.
 */
import { createHash } from "node:crypto";
import type { RepositorySetupStepId } from "../../packages/features/provider-setup/src/index.js";

export const VISUAL_DATABASE_NAME = "reviewrouter_provider_setup_visual";

export type VisualUserKey = "owner" | "admin" | "member";
export type WorkspaceRole = "owner" | "admin" | "member";
/** GitHub repository permission as `collaborators/{user}/permission` returns it. */
export type GitHubPermission =
  | "admin"
  | "maintain"
  | "write"
  | "triage"
  | "read"
  | "none";

export type VisualUser = Readonly<{
  id: string;
  /** Numeric GitHub user ID; the session and the permission check compare it. */
  githubUserId: string;
  login: string;
}>;

export const VISUAL_USERS: Readonly<Record<VisualUserKey, VisualUser>> = {
  owner: {
    id: "rr-visual-user-owner",
    githubUserId: "930000000101",
    login: "rr-visual-owner",
  },
  admin: {
    id: "rr-visual-user-admin",
    githubUserId: "930000000102",
    login: "rr-visual-admin",
  },
  member: {
    id: "rr-visual-user-member",
    githubUserId: "930000000103",
    login: "rr-visual-member",
  },
};

export type VisualWorkspaceKey = "main" | "locked" | "empty" | "adminPersonal";

export type VisualWorkspace = Readonly<{
  id: string;
  slug: string;
  name: string;
  /** Owner of a personal workspace; a user-owned account needs one. */
  personalOwner?: VisualUserKey;
  members: Readonly<Partial<Record<VisualUserKey, WorkspaceRole>>>;
  installation: Readonly<{
    id: string;
    githubInstallationId: string;
    accountLogin: string;
    accountType: "Organization" | "User";
  }>;
  /** Access rights: only owners and admins manage providers (set by the owner). */
  providerManagementAdminOnly: boolean;
  /** The workspace default, set by the owner. */
  defaultProfile?: VisualProfileKey;
}>;

export const VISUAL_WORKSPACES: Readonly<
  Record<VisualWorkspaceKey, VisualWorkspace>
> = {
  main: {
    id: "rr-visual-ws-main",
    slug: "rr-visual-main",
    name: "Visual Main",
    members: { owner: "owner", admin: "admin", member: "member" },
    installation: {
      id: "rr-visual-install-main",
      githubInstallationId: "940000000101",
      accountLogin: "rr-visual-org",
      accountType: "Organization",
    },
    providerManagementAdminOnly: false,
    defaultProfile: "claudeDefault",
  },
  locked: {
    id: "rr-visual-ws-locked",
    slug: "rr-visual-locked",
    name: "Visual Locked",
    members: { owner: "owner", admin: "admin", member: "member" },
    installation: {
      id: "rr-visual-install-locked",
      githubInstallationId: "940000000102",
      accountLogin: "rr-visual-locked-org",
      accountType: "Organization",
    },
    providerManagementAdminOnly: true,
  },
  empty: {
    id: "rr-visual-ws-empty",
    slug: "rr-visual-empty",
    name: "Visual Empty",
    members: { owner: "owner", member: "member" },
    installation: {
      id: "rr-visual-install-empty",
      githubInstallationId: "940000000103",
      accountLogin: "rr-visual-empty-org",
      accountType: "Organization",
    },
    providerManagementAdminOnly: false,
  },
  adminPersonal: {
    id: "rr-visual-ws-admin-personal",
    slug: "rr-visual-admin-personal",
    name: "@rr-visual-admin",
    personalOwner: "admin",
    members: { admin: "owner" },
    installation: {
      id: "rr-visual-install-admin-personal",
      githubInstallationId: "940000000104",
      accountLogin: "rr-visual-admin",
      accountType: "User",
    },
    providerManagementAdminOnly: false,
  },
};

/** The Account Gateway profile the fixture's connected accounts use. */
export const VISUAL_GATEWAY_PROFILE = {
  profileId: "rr-visual-profile-codex",
  protocol: "openai-responses",
  modelIds: ["gpt-5.5"],
  authKinds: ["api_key"],
} as const;

export type VisualConnectionKey = "mainOrg" | "adminPersonal" | "lockedOrg";

/** Account Gateway accounts and their single active binding. */
export type VisualConnection = Readonly<{
  id: string;
  bindingId: string;
  /** The workspace the binding grants the account to. */
  workspace: VisualWorkspaceKey;
  owner:
    | Readonly<{ kind: "workspace" }>
    | Readonly<{ kind: "user"; user: VisualUserKey }>;
  gatewayAccountRef: string;
  profileRef: string;
  displayName: string;
}>;

export const VISUAL_CONNECTIONS: Readonly<
  Record<VisualConnectionKey, VisualConnection>
> = {
  mainOrg: {
    id: "rr-visual-account-main-org",
    bindingId: "rr-visual-binding-main-org",
    workspace: "main",
    owner: { kind: "workspace" },
    gatewayAccountRef: "rr-visual-gateway-main-org",
    profileRef: VISUAL_GATEWAY_PROFILE.profileId,
    displayName: "Visual Org Codex",
  },
  adminPersonal: {
    id: "rr-visual-account-admin-personal",
    bindingId: "rr-visual-binding-admin-personal",
    workspace: "main",
    owner: { kind: "user", user: "admin" },
    gatewayAccountRef: "rr-visual-gateway-admin-personal",
    profileRef: VISUAL_GATEWAY_PROFILE.profileId,
    displayName: "Admin personal Codex",
  },
  lockedOrg: {
    id: "rr-visual-account-locked-org",
    bindingId: "rr-visual-binding-locked-org",
    workspace: "locked",
    owner: { kind: "workspace" },
    gatewayAccountRef: "rr-visual-gateway-locked-org",
    profileRef: VISUAL_GATEWAY_PROFILE.profileId,
    displayName: "Locked Org Codex",
  },
};

/** Server-managed provider keys (never a real key) and where they are applied. */
export const VISUAL_MANAGED_KEYS = [
  {
    id: "rr-visual-key-main-mimo",
    workspace: "main",
    providerType: "mimo",
    appliedTo: ["mainWorkflowUpdate"],
  },
] as const satisfies readonly Readonly<{
  id: string;
  workspace: VisualWorkspaceKey;
  providerType: "mimo" | "openrouter";
  appliedTo: readonly VisualRepositoryKey[];
}>[];

export type VisualProfileKey =
  | "claudeDefault"
  | "gatewayOrg"
  | "gatewayPersonal"
  | "mimoManaged"
  | "hostedPool"
  | "memberMimo"
  | "rotating"
  | "lockedGateway";

export type VisualCredential =
  | Readonly<{ kind: "gateway_binding"; connection: VisualConnectionKey }>
  | Readonly<{ kind: "managed_api_key"; authMode: "mimo_token_plan_api_key" }>
  | Readonly<{ kind: "hosted_pool" }>
  | Readonly<{ kind: "repository_rotating"; repository: VisualRepositoryKey }>
  | Readonly<{
      kind: "user_ci_secret";
      authMode: "claude_code_oauth" | "mimo_token_plan_api_key";
    }>;

/**
 * A workspace provider. Without `attachTo` its creator registers it from the
 * Providers list; with it, the creator creates it inside the attach flow of
 * that repository (the only way a member or a rotating profile is created).
 */
export type VisualProfile = Readonly<{
  workspace: VisualWorkspaceKey;
  createdBy: VisualUserKey;
  credential: VisualCredential;
  model: string;
  label: string;
  attachTo?: VisualRepositoryKey;
  /** Review depth of the attach selection, when not the seeded default. */
  attachReasoningEffort?: "max";
  /** Seeded only when the run enables rotating Codex. */
  requiresRotating?: boolean;
  /** Over a personal account: seeded only while sharing them is on. */
  requiresPersonalSharing?: boolean;
}>;

/** In creation order, which is the order of the workspace list. */
export const VISUAL_PROFILES: Readonly<
  Record<VisualProfileKey, VisualProfile>
> = {
  claudeDefault: {
    workspace: "main",
    createdBy: "owner",
    credential: { kind: "user_ci_secret", authMode: "claude_code_oauth" },
    model: "claude-opus-4-7",
    label: "Claude Code (team default)",
  },
  gatewayOrg: {
    workspace: "main",
    createdBy: "admin",
    credential: { kind: "gateway_binding", connection: "mainOrg" },
    model: "gpt-5.5",
    label: "Org Codex account",
  },
  gatewayPersonal: {
    workspace: "main",
    createdBy: "admin",
    credential: { kind: "gateway_binding", connection: "adminPersonal" },
    model: "gpt-5.5",
    label: "Admin personal Codex",
    requiresPersonalSharing: true,
  },
  mimoManaged: {
    workspace: "main",
    createdBy: "owner",
    credential: {
      kind: "managed_api_key",
      authMode: "mimo_token_plan_api_key",
    },
    model: "mimo-v2.6-pro",
    label: "MiMo (server key)",
  },
  hostedPool: {
    workspace: "main",
    createdBy: "owner",
    credential: { kind: "hosted_pool" },
    model: "gpt-5.5",
    label: "Hosted ChatGPT pool",
  },
  memberMimo: {
    workspace: "main",
    createdBy: "member",
    credential: {
      kind: "user_ci_secret",
      authMode: "mimo_token_plan_api_key",
    },
    model: "mimo-v2.6-pro",
    label: "Member MiMo secret",
    attachTo: "mainMemberProfile",
  },
  // The deepest review depth only the default Codex model supports, so a
  // model edit of this provider is refused naming the repository.
  rotating: {
    workspace: "main",
    createdBy: "owner",
    credential: { kind: "repository_rotating", repository: "mainRotating" },
    model: "gpt-5.6-sol",
    label: "Rotating Codex",
    attachTo: "mainRotating",
    attachReasoningEffort: "max",
    requiresRotating: true,
  },
  lockedGateway: {
    workspace: "locked",
    createdBy: "admin",
    credential: { kind: "gateway_binding", connection: "lockedOrg" },
    model: "gpt-5.5",
    label: "Locked org Codex",
  },
};

export type VisualRepositoryKey =
  | "mainSetupPr"
  | "mainMergeSetupPr"
  | "mainNeedsSecret"
  | "mainReady"
  | "mainOwnGateway"
  | "mainMemberProfile"
  | "mainWorkflowUpdate"
  | "mainRotating"
  | "mainGitLab"
  | "lockedAttached"
  | "lockedUnselected"
  | "emptyFirst"
  | "emptyConfigured";

/** What the effective configuration resolves to for one repository. */
export type VisualExpectedConfig =
  | Readonly<{ status: "ready"; authMode: string }>
  | Readonly<{ status: "provider_selection_required" }>;

export type VisualRepository = Readonly<{
  id: string;
  workspace: VisualWorkspaceKey;
  name: string;
  /** GitHub repositories carry a number; the GitLab one does not. */
  githubRepositoryId: string | null;
  /** Setup workflow: none, an open setup PR, or the installed workflow. */
  setup: "none" | "setup_pr_open" | "configured";
  /** The repository's own provider selection; absent follows the default. */
  selection?: Readonly<{ profile: VisualProfileKey; by: VisualUserKey }>;
  /** Provider secrets of the effective providers were confirmed. */
  secretConfirmed?: boolean;
  /**
   * The installed workflow was rendered for the workspace default instead of
   * the repository's own selection, so a workflow update is required.
   */
  installedForWorkspaceDefault?: boolean;
  /** GitHub permission of the member; owner and admin hold `admin`. */
  memberPermission: GitHubPermission;
  requiresRotating?: boolean;
  expected: Readonly<{
    config: VisualExpectedConfig;
    /** The stepper step the dashboard should show. */
    step: RepositorySetupStepId;
  }>;
}>;

export const VISUAL_REPOSITORIES: Readonly<
  Record<VisualRepositoryKey, VisualRepository>
> = {
  mainSetupPr: {
    id: "rr-visual-repo-main-setup-pr",
    workspace: "main",
    name: "setup-pr",
    githubRepositoryId: "950000000101",
    setup: "none",
    memberPermission: "read",
    expected: {
      config: { status: "ready", authMode: "claude_code_oauth" },
      step: "setup_pr",
    },
  },
  mainMergeSetupPr: {
    id: "rr-visual-repo-main-merge-setup-pr",
    workspace: "main",
    name: "merge-setup-pr",
    githubRepositoryId: "950000000102",
    setup: "setup_pr_open",
    memberPermission: "write",
    expected: {
      config: { status: "ready", authMode: "claude_code_oauth" },
      step: "merge_setup_pr",
    },
  },
  mainNeedsSecret: {
    id: "rr-visual-repo-main-needs-secret",
    workspace: "main",
    name: "needs-secret",
    githubRepositoryId: "950000000103",
    setup: "configured",
    memberPermission: "maintain",
    expected: {
      config: { status: "ready", authMode: "claude_code_oauth" },
      step: "provider",
    },
  },
  mainReady: {
    id: "rr-visual-repo-main-ready",
    workspace: "main",
    name: "ready",
    githubRepositoryId: "950000000104",
    setup: "configured",
    secretConfirmed: true,
    memberPermission: "maintain",
    expected: {
      config: { status: "ready", authMode: "claude_code_oauth" },
      step: "ready",
    },
  },
  mainOwnGateway: {
    id: "rr-visual-repo-main-own-gateway",
    workspace: "main",
    name: "own-gateway",
    githubRepositoryId: "950000000105",
    setup: "configured",
    selection: { profile: "gatewayOrg", by: "owner" },
    memberPermission: "read",
    // Without a live Account Gateway the account is never ready.
    expected: {
      config: { status: "ready", authMode: "codex_account_gateway" },
      step: "provider",
    },
  },
  mainMemberProfile: {
    id: "rr-visual-repo-main-member-profile",
    workspace: "main",
    name: "member-profile",
    githubRepositoryId: "950000000106",
    setup: "configured",
    selection: { profile: "memberMimo", by: "member" },
    secretConfirmed: true,
    memberPermission: "maintain",
    expected: {
      config: { status: "ready", authMode: "mimo_token_plan_api_key" },
      step: "ready",
    },
  },
  mainWorkflowUpdate: {
    id: "rr-visual-repo-main-workflow-update",
    workspace: "main",
    name: "workflow-update",
    githubRepositoryId: "950000000107",
    setup: "configured",
    selection: { profile: "mimoManaged", by: "owner" },
    installedForWorkspaceDefault: true,
    memberPermission: "maintain",
    expected: {
      config: { status: "ready", authMode: "mimo_token_plan_api_key" },
      step: "setup_pr",
    },
  },
  mainRotating: {
    id: "rr-visual-repo-main-rotating",
    workspace: "main",
    name: "rotating",
    githubRepositoryId: "950000000108",
    setup: "configured",
    selection: { profile: "rotating", by: "owner" },
    memberPermission: "read",
    requiresRotating: true,
    expected: {
      config: {
        status: "ready",
        authMode: "codex_subscription_oauth_rotating",
      },
      step: "provider",
    },
  },
  mainGitLab: {
    id: "rr-visual-repo-main-gitlab",
    workspace: "main",
    name: "gitlab-project",
    githubRepositoryId: null,
    setup: "none",
    memberPermission: "none",
    // GitLab has no setup flow in scope; the dashboard shows the first step.
    expected: {
      config: { status: "ready", authMode: "claude_code_oauth" },
      step: "setup_pr",
    },
  },
  lockedAttached: {
    id: "rr-visual-repo-locked-attached",
    workspace: "locked",
    name: "attached",
    githubRepositoryId: "950000000201",
    setup: "configured",
    selection: { profile: "lockedGateway", by: "admin" },
    memberPermission: "maintain",
    expected: {
      config: { status: "ready", authMode: "codex_account_gateway" },
      step: "provider",
    },
  },
  lockedUnselected: {
    id: "rr-visual-repo-locked-unselected",
    workspace: "locked",
    name: "unselected",
    githubRepositoryId: "950000000202",
    setup: "none",
    memberPermission: "maintain",
    expected: {
      config: { status: "provider_selection_required" },
      step: "setup_pr",
    },
  },
  emptyFirst: {
    id: "rr-visual-repo-empty-first",
    workspace: "empty",
    name: "first-repo",
    githubRepositoryId: "950000000301",
    setup: "none",
    memberPermission: "maintain",
    expected: {
      config: { status: "provider_selection_required" },
      step: "setup_pr",
    },
  },
  emptyConfigured: {
    id: "rr-visual-repo-empty-configured",
    workspace: "empty",
    name: "configured-repo",
    githubRepositoryId: "950000000302",
    setup: "configured",
    memberPermission: "read",
    expected: {
      config: { status: "provider_selection_required" },
      step: "provider",
    },
  },
};

/** The GitLab group of the main workspace's GitLab project. */
export const VISUAL_GITLAB = {
  installationId: "rr-visual-gitlab-main",
  workspace: "main",
  namespacePath: "rr-visual-group",
  externalProjectId: "960000000101",
} as const satisfies Readonly<{
  installationId: string;
  workspace: VisualWorkspaceKey;
  namespacePath: string;
  externalProjectId: string;
}>;

/** Settings of every seeded selection. */
export const VISUAL_SELECTION_SETTINGS = {
  reasoningEffort: "high",
  agenticContext: true,
  fastMode: false,
  requiredHealthy: true,
} as const;

export const VISUAL_SETUP_BRANCH_HEAD_SHA = "a".repeat(40);

/**
 * GitHub facts a run changes while the app serves it, read by the GitHub
 * fixture on every request: the repository Actions secrets that exist, as
 * `owner/name/SECRET_NAME`. The runner rewrites it after every reseed.
 */
export type GitHubFixtureState = Readonly<{
  repositorySecrets: readonly string[];
}>;

export function visualRepositorySecretKey(
  fullName: string,
  secretName: string,
): string {
  return `${fullName}/${secretName}`.toLowerCase();
}

export type VisualRunFlags = Readonly<{
  /** Deployment flag of rotating Codex; hosted deployments keep it off. */
  rotating: boolean;
  /**
   * Deployment flag of personal account sharing. Off, the run also serves
   * the Account Gateway's profile catalog, so Gateway selections validate.
   */
  personalSharing: boolean;
}>;

/**
 * Deployment settings both the seed and the app must agree on. Fixture-only
 * values; the encryption key protects a fake GitHub user token and is derived
 * so that no key-shaped literal lives in the repository.
 */
export function visualSharedEnvironment(
  flags: VisualRunFlags,
): Readonly<Record<string, string>> {
  return {
    GITHUB_APP_SLUG: "rr-visual-app",
    REVIEW_ROUTER_TOKEN_ENCRYPTION_KEY: createHash("sha256")
      .update("reviewrouter-provider-setup-visual-fixture")
      .digest("base64url"),
    REVIEW_ROUTER_PERSONAL_ACCOUNT_SHARING_ENABLED: flags.personalSharing
      ? "1"
      : "0",
    REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH: flags.rotating ? "1" : "0",
  };
}

export function visualRepositoryFullName(repository: VisualRepository): string {
  return repository.githubRepositoryId === null
    ? `${VISUAL_GITLAB.namespacePath}/${repository.name}`
    : `${VISUAL_WORKSPACES[repository.workspace].installation.accountLogin}/${repository.name}`;
}

export function visualRepositoryEnabled(
  repository: Pick<VisualRepository, "requiresRotating">,
  flags: VisualRunFlags,
): boolean {
  return !repository.requiresRotating || flags.rotating;
}

/** The GitHub permission a fixture user holds on a repository. */
export function visualGitHubPermission(
  user: VisualUserKey,
  repository: VisualRepository,
): GitHubPermission {
  return user === "member" ? repository.memberPermission : "admin";
}

export function entriesOf<Key extends string, Value>(
  record: Readonly<Record<Key, Value>>,
): readonly (readonly [Key, Value])[] {
  return Object.entries(record) as unknown as readonly (readonly [
    Key,
    Value,
  ])[];
}

/**
 * What the GitHub HTTP fixture answers, derived from the data set: the
 * installations, every user's permission on every repository, and the open
 * setup pull requests.
 */
export type GitHubFixtureDocument = Readonly<{
  organizations: readonly string[];
  installations: readonly Readonly<{ id: string; accountLogin: string }>[];
  users: readonly Readonly<{ id: string; login: string }>[];
  repositories: readonly Readonly<{
    id: string;
    installationId: string;
    owner: string;
    name: string;
    permissions: Readonly<Record<string, GitHubPermission>>;
  }>[];
  pullRequests: readonly Readonly<{
    owner: string;
    name: string;
    number: number;
    headRef: string;
    headSha: string;
    baseRef: string;
  }>[];
}>;

export function visualGitHubFixtureDocument(
  flags: VisualRunFlags,
  setupBranch: string,
): GitHubFixtureDocument {
  const repositories = entriesOf(VISUAL_REPOSITORIES)
    .map(([, repository]) => repository)
    .filter(
      (repository) =>
        repository.githubRepositoryId !== null &&
        visualRepositoryEnabled(repository, flags),
    );
  return {
    organizations: entriesOf(VISUAL_WORKSPACES)
      .map(([, workspace]) => workspace.installation)
      .filter((installation) => installation.accountType === "Organization")
      .map((installation) => installation.accountLogin),
    installations: entriesOf(VISUAL_WORKSPACES).map(([, workspace]) => ({
      id: workspace.installation.githubInstallationId,
      accountLogin: workspace.installation.accountLogin,
    })),
    users: entriesOf(VISUAL_USERS).map(([, user]) => ({
      id: user.githubUserId,
      login: user.login,
    })),
    repositories: repositories.map((repository) => ({
      id: repository.githubRepositoryId!,
      installationId:
        VISUAL_WORKSPACES[repository.workspace].installation
          .githubInstallationId,
      owner: VISUAL_WORKSPACES[repository.workspace].installation.accountLogin,
      name: repository.name,
      permissions: Object.fromEntries(
        entriesOf(VISUAL_USERS).map(([key, user]) => [
          user.login,
          visualGitHubPermission(key, repository),
        ]),
      ),
    })),
    pullRequests: repositories
      .filter((repository) => repository.setup === "setup_pr_open")
      .map((repository) => ({
        owner:
          VISUAL_WORKSPACES[repository.workspace].installation.accountLogin,
        name: repository.name,
        number: 1,
        headRef: setupBranch,
        headSha: VISUAL_SETUP_BRANCH_HEAD_SHA,
        baseRef: "main",
      })),
  };
}
