import type { PrismaClient } from "@prisma/client";
import { canAdminWorkspace } from "@reviewrouter/features-auth";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import {
  isManagedApiKeyAuthMode,
  managedApiKeyProviderTypes,
  PrismaWorkspaceProviderProfileRepository,
  providerCredentialRequestFor,
  providerProfileIdentityKey,
  reviewProviderSelectionFor,
  type ProviderCredentialRequest,
  type ProviderCredentialSource,
  type ProviderProfileActor,
  type ProviderProfileDraft,
  type ProviderProfileWriteOptions,
  type ProviderRepositoryCapability,
  type ReviewProviderConfiguration,
  type ReviewProviderSelection,
  type WorkspaceProviderProfile,
} from "@reviewrouter/features-review-config";
import type { DashboardMutationActor } from "./dashboard-mutations";

/** The deployment's trusted composition of provider profile writers. */
export function dashboardProviderProfileWriteOptions(
  env: NodeJS.ProcessEnv = process.env,
): ProviderProfileWriteOptions {
  return {
    operatorWorkspaceId: env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
    personalAccountsEnabled: readPersonalAccountSharingEnabled(env),
  };
}

export function dashboardProviderProfiles(
  prisma: PrismaClient,
): PrismaWorkspaceProviderProfileRepository {
  return new PrismaWorkspaceProviderProfileRepository(
    prisma,
    dashboardProviderProfileWriteOptions(),
  );
}

/**
 * The provider actor of a dashboard user. The local-admin override is the
 * same rule the dashboard's workspace admin gate applies.
 */
export function dashboardProviderActor(
  actor: DashboardMutationActor,
  env: NodeJS.ProcessEnv = process.env,
): ProviderProfileActor {
  const localAdminGithubLogins = (
    env.REVIEW_ROUTER_LOCAL_ADMIN_GITHUB_LOGINS ?? ""
  )
    .split(",")
    .map((login) => login.trim())
    .filter(Boolean);
  return {
    userId: actor.userId,
    auditActor: actor.actor,
    localAdminOverride:
      canAdminWorkspace({
        role: null,
        githubLogin: actor.githubLogin ?? "",
        localAdminGithubLogins,
      }).reason === "local_admin_override",
  };
}

/** The verified repository capability behind a dashboard repository write. */
export function dashboardRepositoryCapability(
  actor: DashboardMutationActor,
): ProviderRepositoryCapability | null {
  const source = actor.accessSource;
  if (!source || source.source === "workspace_admin") return "direct_config";
  return source.capability === "direct_config"
    ? "direct_config"
    : "repo_manager";
}

export type ProviderSelectionsFromRows = Readonly<{
  selections: readonly ReviewProviderSelection[];
  /** Providers the write creates together with the selection. */
  drafts: readonly ProviderProfileDraft[];
  /** In-memory profiles of the drafts, for validating the candidate. */
  draftProfiles: readonly WorkspaceProviderProfile[];
}>;

/**
 * The provider rows the current forms submit, as selections of workspace
 * profiles: a row naming an existing profile's credential source and model
 * selects it, any other row becomes a draft the write creates with the
 * selection in one decision. An unchanged form therefore leaves the stored
 * selection unchanged.
 */
export async function dashboardProviderSelectionsFromRows(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  /** The repository of a repository form; null for the workspace default. */
  readonly repositoryId: string | null;
  readonly rows: readonly ReviewProviderConfiguration[];
}): Promise<ProviderSelectionsFromRows> {
  const { prisma, workspaceId, repositoryId } = input;
  const [profiles, keys, appliedLinks] = await Promise.all([
    dashboardProviderProfiles(prisma).list(workspaceId),
    prisma.providerApiKeyConnection.findMany({
      where: { workspaceId },
      select: { id: true, providerType: true },
    }),
    repositoryId
      ? prisma.providerApiKeyRepositoryLink.findMany({
          where: {
            workspaceId,
            repositoryId,
            appliedKeyVersion: { not: null },
          },
          select: { providerApiKeyConnectionId: true },
        })
      : Promise.resolve([]),
  ]);
  const keyFor = (authMode: string) =>
    isManagedApiKeyAuthMode(authMode)
      ? keys.find(
          (key) => key.providerType === managedApiKeyProviderTypes[authMode],
        )
      : undefined;
  const applied = new Set(
    appliedLinks.map((link) => link.providerApiKeyConnectionId),
  );
  const byIdentity = new Map(
    profiles.map(
      (profile) =>
        [
          providerProfileIdentityKey(profile.credential, profile.model),
          profile,
        ] as const,
    ),
  );
  const selections: ReviewProviderSelection[] = [];
  const drafts: ProviderProfileDraft[] = [];
  const draftProfiles: WorkspaceProviderProfile[] = [];
  input.rows.forEach((row, index) => {
    const credential = providerCredentialRequestFor(row, {
      repositoryId,
      // A repository uses the managed key once it is applied there; the
      // workspace default uses it whenever it exists.
      managedApiKey: (authMode) => {
        const key = keyFor(authMode);
        return key !== undefined && (!repositoryId || applied.has(key.id));
      },
    });
    const source = expectedCredentialSource(
      credential,
      keyFor(row.authMode)?.id,
    );
    const existing = source
      ? byIdentity.get(providerProfileIdentityKey(source, row.model))
      : undefined;
    if (existing) {
      selections.push(reviewProviderSelectionFor(row, existing.id));
      return;
    }
    const draftId = `draft-${index}`;
    drafts.push({ draftId, credential, model: row.model, label: null });
    if (source)
      draftProfiles.push({
        id: draftId,
        workspaceId,
        createdByUserId: null,
        credential: source,
        model: row.model,
        label: draftId,
        archivedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      });
    selections.push(reviewProviderSelectionFor(row, draftId));
  });
  return { selections, drafts, draftProfiles };
}

/** The source a request resolves to when its references are as expected. */
function expectedCredentialSource(
  credential: ProviderCredentialRequest,
  apiKeyConnectionId: string | undefined,
): ProviderCredentialSource | null {
  switch (credential.kind) {
    case "gateway_binding":
      return credential.gatewayProfileRef
        ? {
            kind: "gateway_binding",
            authMode: "codex_account_gateway",
            bindingId: credential.bindingId,
            gatewayProfileRef: credential.gatewayProfileRef,
          }
        : null;
    case "managed_api_key":
      return apiKeyConnectionId
        ? {
            kind: "managed_api_key",
            authMode: credential.authMode,
            apiKeyConnectionId,
          }
        : null;
    case "hosted_pool":
      return {
        kind: "hosted_pool",
        authMode: "codex_subscription_oauth_hosted_pool",
      };
    case "repository_rotating":
      return {
        kind: "repository_rotating",
        authMode: "codex_subscription_oauth_rotating",
        repositoryId: credential.repositoryId,
      };
    case "user_ci_secret":
      return { kind: "user_ci_secret", authMode: credential.authMode };
  }
}
