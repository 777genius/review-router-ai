import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { canAdminWorkspace } from "@reviewrouter/features-auth";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import {
  managedApiKeyProviderTypes,
  parseProviderProfileDraft,
  PrismaReviewConfigurationRepository,
  PrismaReviewPolicyHeadReader,
  PrismaWorkspaceProviderProfileRepository,
  providerProfileIdentityKey,
  ProviderProfileError,
  reviewProviderSelectionSchema,
  type ProviderCredentialRequest,
  type ProviderCredentialSource,
  type ProviderProfileActor,
  type ProviderProfileWriteOptions,
  type ProviderRepositoryCapability,
  type ProviderSelectionDraft,
  type ProviderSelectionSettings,
  type ReviewProviderSelection,
} from "@reviewrouter/features-review-config";
import type { DashboardMutationActor } from "./dashboard-mutations";
import {
  dashboardSelectionValidator,
  type DashboardValidatedRepository,
} from "./dashboard-review-configuration-validation";

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

/** The dashboard's review policy store for one signed-in user. */
export function dashboardReviewConfigurations(
  prisma: PrismaClient,
  actorUserId: string,
): PrismaReviewConfigurationRepository {
  const options = dashboardProviderProfileWriteOptions();
  return new PrismaReviewConfigurationRepository(
    prisma,
    options.operatorWorkspaceId,
    options.personalAccountsEnabled,
    actorUserId,
  );
}

/**
 * Dependencies of a signed-in dashboard write of review policy: the writer
 * validates personal bindings for the actor, and every candidate passes the
 * dashboard's save-time checks before the write. `recheck` runs after a
 * network-bound check and must confirm the actor may still write the target
 * (null is the workspace).
 */
export function dashboardSelectionDependencies(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly actor: DashboardMutationActor;
  readonly repositories: ReadonlyMap<string, DashboardValidatedRepository>;
  readonly recheck: (repositoryId: string | null) => Promise<void>;
}) {
  return {
    configurations: dashboardReviewConfigurations(
      input.prisma,
      input.actor.userId,
    ),
    policyHeads: new PrismaReviewPolicyHeadReader(input.prisma),
    validator: dashboardSelectionValidator({
      workspaceId: input.workspaceId,
      repositories: input.repositories,
      afterGatewayCatalogCheck: (target) =>
        input.recheck(
          target.scope === "repository" ? target.repositoryId : null,
        ),
    }),
  };
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

/** A dialog request for one provider of a selection. */
export type DashboardProviderRequest =
  | Readonly<{ kind: "profile"; profileId: string }>
  | Readonly<{
      kind: "new";
      credential: ProviderCredentialRequest;
      model: string;
    }>;

/**
 * The selection a dialog request makes: an existing workspace profile, or a
 * draft the write creates together with the selection, decided as one. A
 * new provider whose credential source and model already exist selects that
 * profile instead, so repeating a request never adds a second one.
 */
export async function dashboardProviderSelection(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly provider: DashboardProviderRequest;
  readonly settings: ProviderSelectionSettings;
  readonly draftId?: string;
}): Promise<
  Readonly<{
    selection: ReviewProviderSelection;
    draft?: ProviderSelectionDraft;
    /** The credential kind of the chosen provider, when it is known here. */
    credentialKind?: ProviderCredentialSource["kind"];
  }>
> {
  const { prisma, workspaceId, provider } = input;
  const settings = { ...input.settings };
  if (provider.kind === "profile") {
    const chosen = (
      await dashboardProviderProfiles(prisma).list(workspaceId)
    ).find((profile) => profile.id === provider.profileId);
    // A missing profile is refused by the write with the policy's reason.
    if (chosen) assertDialogSelectableCredential(chosen.credential.kind);
    return {
      selection: reviewProviderSelectionSchema.parse({
        ...settings,
        profileId: provider.profileId,
      }),
      ...(chosen ? { credentialKind: chosen.credential.kind } : {}),
    };
  }
  const { credential, model } = parseProviderProfileDraft({
    credential: provider.credential,
    model: provider.model,
  });
  assertDialogSelectableCredential(credential.kind);
  const [profiles, keys] = await Promise.all([
    dashboardProviderProfiles(prisma).list(workspaceId),
    credential.kind === "managed_api_key"
      ? prisma.providerApiKeyConnection.findMany({
          where: {
            workspaceId,
            providerType: managedApiKeyProviderTypes[credential.authMode],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  const source = expectedCredentialSource(credential, keys[0]?.id);
  // The write refuses an unavailable credential with its own error code.
  if (!source) throw new ProviderProfileError("provider_profile_invalid");
  const identity = providerProfileIdentityKey(source, model);
  const existing = profiles.find(
    (profile) =>
      providerProfileIdentityKey(profile.credential, profile.model) ===
      identity,
  );
  if (existing)
    return {
      selection: reviewProviderSelectionSchema.parse({
        ...settings,
        profileId: existing.id,
      }),
      credentialKind: credential.kind,
    };
  const draftId = input.draftId ?? `draft-${randomUUID()}`;
  return {
    credentialKind: credential.kind,
    selection: reviewProviderSelectionSchema.parse({
      ...settings,
      profileId: draftId,
    }),
    draft: {
      draft: { draftId, credential, model, label: null },
      profile: {
        id: draftId,
        workspaceId,
        createdByUserId: null,
        credential: source,
        model,
        label: draftId,
        archivedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
      },
    },
  };
}

/**
 * The hosted Codex pool is chosen per repository through its session source
 * flow, which checks the deployment flag, the entitlement and the repository
 * visibility; the provider dialog and the Providers list never select it.
 */
export function assertDialogSelectableCredential(
  kind: ProviderCredentialSource["kind"],
): void {
  if (kind === "hosted_pool")
    throw new Error("hosted_pool_session_source_required");
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
