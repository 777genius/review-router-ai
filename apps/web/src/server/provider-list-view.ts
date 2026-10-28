import { savedProviderIdentity } from "./provider-identity";
import type { PrismaClient } from "@prisma/client";
import {
  listWorkspaceProviderProfiles,
  listWorkspaceProviderProfileUsage,
  readProviderManagementFacts,
} from "@reviewrouter/features-review-config";
import {
  buildProviderListView,
  type ProviderListView,
} from "../features/provider-setup/provider-list-model";
import type { DashboardMutationActor } from "./dashboard-mutations";
import {
  dashboardProviderActor,
  dashboardProviderProfiles,
} from "./dashboard-provider-selections";

const unavailableConnectionStates: ReadonlySet<string> = new Set([
  "disabled",
  "quarantined",
  "suspended",
]);

/**
 * Reads the workspace Providers list for the signed-in user and decides each
 * row's actions with the provider management policy. Only workspace members
 * read it (null otherwise); the dialog of a repository serves everyone else.
 */
export async function loadProviderListView(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly actor: DashboardMutationActor;
}): Promise<ProviderListView | null> {
  const { prisma, workspaceId } = input;
  const dependencies = { profiles: dashboardProviderProfiles(prisma) };
  const [profiles, usage] = await Promise.all([
    listWorkspaceProviderProfiles(workspaceId, dependencies),
    listWorkspaceProviderProfileUsage(workspaceId, dependencies),
  ]);
  const bindingIds = profiles.flatMap((profile) =>
    profile.credential.kind === "gateway_binding"
      ? [profile.credential.bindingId]
      : [],
  );
  const facts = await readProviderManagementFacts(
    {
      workspaceId,
      actor: dashboardProviderActor(input.actor),
      bindingIds,
    },
    dependencies,
  );
  if (!facts || facts.actor.role === null) return null;

  const repositoryIds = [
    ...new Set([
      ...usage.flatMap((item) => item.repositoryIds),
      ...profiles.flatMap((profile) =>
        profile.credential.kind === "repository_rotating"
          ? [profile.credential.repositoryId]
          : [],
      ),
    ]),
  ];
  const creatorIds = [
    ...new Set(
      profiles.flatMap((profile) =>
        profile.createdByUserId ? [profile.createdByUserId] : [],
      ),
    ),
  ];
  const [repositories, creators, members, bindings] = await Promise.all([
    repositoryIds.length
      ? prisma.repositoryConnection.findMany({
          where: { workspaceId, id: { in: repositoryIds } },
          select: { id: true, fullName: true },
        })
      : Promise.resolve([]),
    creatorIds.length
      ? prisma.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, githubLogin: true },
        })
      : Promise.resolve([]),
    creatorIds.length
      ? prisma.workspaceMember.findMany({
          where: { workspaceId, userId: { in: creatorIds } },
          select: { userId: true },
        })
      : Promise.resolve([]),
    bindingIds.length
      ? prisma.workspaceAccountBinding.findMany({
          where: { workspaceId, id: { in: [...new Set(bindingIds)] } },
          select: {
            id: true,
            state: true,
            connection: {
              select: {
                displayName: true,
                ownerWorkspaceId: true,
                state: true,
              },
            },
          },
        })
      : Promise.resolve([]),
  ]);
  const memberIds = new Set(members.map((member) => member.userId));

  return buildProviderListView({
    workspaceId,
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
    defaultProfileId:
      usage.find((item) => item.workspaceDefault)?.profileId ?? null,
    usage,
    repositoryNames: new Map(
      repositories.map((repository) => [repository.id, repository.fullName]),
    ),
    creators: new Map(
      creators.map((user) => [
        user.id,
        { login: user.githubLogin, member: memberIds.has(user.id) },
      ]),
    ),
    accounts: new Map(
      bindings.map((binding) => [
        binding.id,
        {
          // Only the workspace's own accounts are named in its list.
          name:
            binding.connection.ownerWorkspaceId === workspaceId
              ? binding.connection.displayName
              : null,
          // Only a known stop is shown; a not yet mirrored state is not one.
          available:
            binding.state === "active" &&
            !unavailableConnectionStates.has(binding.connection.state),
        },
      ]),
    ),
  });
}
