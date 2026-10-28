import { savedProviderIdentity } from "./provider-identity";
import type { PrismaClient } from "@prisma/client";
import { mapWithConcurrency } from "@reviewrouter/shared";
import {
  managedApiKeyProviderTypes,
  parseStoredReviewPolicy,
  PrismaReviewPolicyHeadReader,
  readProviderManagementFacts,
  type ProviderRepositoryCapability,
} from "@reviewrouter/features-review-config";
import {
  isClaudeCodeProviderEnabled,
  isCodexRotatingOAuthAllowedForRepository,
} from "@reviewrouter/platform-config";
import {
  buildProviderSetupView,
  PROVIDER_SETUP_MAX_REPOSITORIES,
  type ProviderSetupTarget,
  type ProviderSetupView,
} from "../features/provider-setup/provider-setup-model";
import {
  canDashboardActorConfigureRepository,
  canDashboardActorMutateRepository,
  type DashboardMutationActor,
} from "./dashboard-mutations";
import {
  dashboardProviderActor,
  dashboardProviderProfiles,
} from "./dashboard-provider-selections";
import { productionPersonalAccounts } from "./personal-account-composition";
import { loadAccountsBootstrap } from "./account-gateway-accounts";
import { gatewaySetupProvidersForProfiles } from "../features/provider-setup/setup-provider";

/** GitHub permission checks one dialog view runs at once. */
const GITHUB_PERMISSION_CHECK_CONCURRENCY = 5;

export class ProviderSetupViewError extends Error {
  constructor(
    readonly code:
      | "provider_setup_target_invalid"
      | "workspace_not_found"
      | "repository_not_found"
      | "provider_setup_forbidden",
  ) {
    super(code);
    this.name = "ProviderSetupViewError";
  }
}

/**
 * Reads what the provider dialog shows for one target and decides every
 * option with the provider management policy for the signed-in user. A
 * workspace member reads any target; anyone else only repositories they can
 * manage on GitHub.
 */
export async function loadProviderSetupView(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly actor: DashboardMutationActor;
  readonly target: ProviderSetupTarget;
}): Promise<ProviderSetupView> {
  const { prisma, workspaceId, actor, target } = input;
  const repositoryIds =
    target.kind === "repositories" ? [...new Set(target.repositoryIds)] : [];
  if (
    target.kind === "repositories" &&
    (repositoryIds.length === 0 ||
      repositoryIds.length > PROVIDER_SETUP_MAX_REPOSITORIES)
  )
    throw new ProviderSetupViewError("provider_setup_target_invalid");

  const profilesStore = dashboardProviderProfiles(prisma);
  const [profiles, repositories, heads, keys, links] = await Promise.all([
    profilesStore.list(workspaceId),
    repositoryIds.length
      ? prisma.repositoryConnection.findMany({
          where: { workspaceId, id: { in: repositoryIds } },
          select: {
            id: true,
            fullName: true,
            owner: true,
            name: true,
            provider: true,
            githubRepositoryId: true,
            installation: { select: { githubInstallationId: true } },
          },
        })
      : Promise.resolve([]),
    new PrismaReviewPolicyHeadReader(prisma).readRepositoryPolicyHeads({
      workspaceId,
      repositoryIds,
    }),
    prisma.providerApiKeyConnection.findMany({
      where: { workspaceId },
      select: { id: true, providerType: true },
    }),
    repositoryIds.length
      ? prisma.providerApiKeyRepositoryLink.findMany({
          where: {
            workspaceId,
            repositoryId: { in: repositoryIds },
            appliedKeyVersion: { not: null },
          },
          select: { providerApiKeyConnectionId: true, repositoryId: true },
        })
      : Promise.resolve([]),
  ]);
  if (repositories.length !== repositoryIds.length)
    throw new ProviderSetupViewError("repository_not_found");
  const facts = await readProviderManagementFacts(
    {
      workspaceId,
      actor: dashboardProviderActor(actor),
      bindingIds: profiles.flatMap((profile) =>
        profile.credential.kind === "gateway_binding"
          ? [profile.credential.bindingId]
          : [],
      ),
    },
    { profiles: profilesStore },
  );
  if (!facts) throw new ProviderSetupViewError("workspace_not_found");
  const admin = facts.actor.role === "owner" || facts.actor.role === "admin";
  if (target.kind === "workspace" && facts.actor.role === null)
    throw new ProviderSetupViewError("provider_setup_forbidden");

  // A bulk view checks up to 100 repositories on GitHub, a few at a time.
  const capabilities = new Map<string, ProviderRepositoryCapability | null>(
    await mapWithConcurrency(
      repositories,
      GITHUB_PERMISSION_CHECK_CONCURRENCY,
      async (repository) =>
        [
          repository.id,
          admin ? "direct_config" : await githubCapability(actor, repository),
        ] as const,
    ),
  );
  if (
    facts.actor.role === null &&
    [...capabilities.values()].some((capability) => capability === null)
  )
    throw new ProviderSetupViewError("provider_setup_forbidden");

  const workspacePolicy = heads.workspace
    ? parseStoredReviewPolicy("workspace", heads.workspace)
    : null;
  const managedKey = (authMode: keyof typeof managedApiKeyProviderTypes) => {
    const key = keys.find(
      (candidate) =>
        candidate.providerType === managedApiKeyProviderTypes[authMode],
    );
    return {
      uploaded: key !== undefined,
      installedRepositoryIds: new Set(
        links
          .filter((link) => link.providerApiKeyConnectionId === key?.id)
          .map((link) => link.repositoryId),
      ),
    };
  };
  const orderedRepositories = repositoryIds.map(
    (id) => repositories.find((repository) => repository.id === id)!,
  );
  // The model-account projection may have no profiles before the first account
  // exists. Enrollment availability comes from the existing authenticated
  // management catalog, not from that empty account inventory.
  const personal = await productionPersonalAccounts().catch(() => null);
  const enrollment = personal
    ? await personal.canonical
        .listGatewayAccounts(personal.scope, null)
        .catch(() => ({ status: "unavailable" as const }))
    : (await loadAccountsBootstrap(workspaceId).catch(() => null))?.page;
  const gatewaySetupProviders =
    enrollment?.status === "ok"
      ? gatewaySetupProvidersForProfiles(enrollment.value.profiles)
      : [];

  return buildProviderSetupView({
    workspaceId,
    gatewaySetupProviders,
    target: target.kind,
    actor: facts.actor,
    workspace: facts.workspace,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      label: profile.label,
      model: profile.model,
      providerId: savedProviderIdentity({
        authMode: profile.credential.authMode,
        gatewayProfileRef:
          profile.credential.kind === "gateway_binding"
            ? profile.credential.gatewayProfileRef
            : undefined,
      }),
      authMode: profile.credential.authMode,
      credentialKind: profile.credential.kind,
      createdByUserId: profile.createdByUserId,
      gatewayBindingId:
        profile.credential.kind === "gateway_binding"
          ? profile.credential.bindingId
          : null,
      gatewayProfileRef:
        profile.credential.kind === "gateway_binding"
          ? profile.credential.gatewayProfileRef
          : null,
      personalBinding:
        profile.credential.kind === "gateway_binding" &&
        facts.personalBindingIds.has(profile.credential.bindingId),
      rotatingRepositoryId:
        profile.credential.kind === "repository_rotating"
          ? profile.credential.repositoryId
          : null,
    })),
    defaultSelection: workspacePolicy?.providers?.[0] ?? null,
    repositories: orderedRepositories.map((repository) => {
      const head = heads.repositories.get(repository.id);
      const policy = head ? parseStoredReviewPolicy("repository", head) : null;
      return {
        id: repository.id,
        fullName: repository.fullName,
        capability: capabilities.get(repository.id) ?? null,
        ownSelection: policy?.providers?.[0] ?? null,
        rotatingAvailable:
          repository.provider === "github" &&
          isCodexRotatingOAuthAllowedForRepository(repository.fullName),
      };
    }),
    managedKeys: {
      mimo_token_plan_api_key: managedKey("mimo_token_plan_api_key"),
      openrouter_api_key: managedKey("openrouter_api_key"),
    },
    claudeCodeEnabled: isClaudeCodeProviderEnabled(),
  });
}

/** A non-admin's capability, from the same GitHub check as the writes. */
async function githubCapability(
  actor: DashboardMutationActor,
  repository: {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly provider: string;
    readonly githubRepositoryId: bigint | null;
    readonly installation: { readonly githubInstallationId: bigint } | null;
  },
): Promise<ProviderRepositoryCapability | null> {
  if (
    repository.provider !== "github" ||
    !repository.githubRepositoryId ||
    !repository.installation
  )
    return null;
  const github = {
    id: repository.id,
    owner: repository.owner,
    name: repository.name,
    githubRepositoryId: repository.githubRepositoryId,
    installation: repository.installation,
  };
  if (await canDashboardActorConfigureRepository({ actor, repository: github }))
    return "direct_config";
  return (await canDashboardActorMutateRepository({
    actor,
    repository: github,
  }))
    ? "repo_manager"
    : null;
}
