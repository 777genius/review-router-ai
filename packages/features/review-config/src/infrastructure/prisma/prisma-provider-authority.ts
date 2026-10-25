import type { Prisma } from "@prisma/client";
import type {
  ProviderManagementActor,
  ProviderManagementWorkspace,
  ProviderProfileFacts,
  WorkspaceMemberRole,
} from "../../domain/provider-management-policy";
import {
  ProviderProfileError,
  type WorkspaceProviderProfile,
} from "../../domain/workspace-provider-profile";

export type LockedProviderAuthority = Readonly<{
  actor: ProviderManagementActor;
  workspace: ProviderManagementWorkspace;
}>;

/**
 * Locks the workspace row, then reads the facts every provider decision needs
 * under locks that hold until commit. NO KEY UPDATE on the workspace
 * serializes with admission (FOR UPDATE), other profile and selection writes
 * and the Access rights toggle, but not with foreign-key checks of inserts.
 * The member row is held FOR SHARE so a role change waits for this write. The
 * local-admin override is the dashboard's own admin rule and acts as admin.
 */
export async function lockProviderAuthority(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  actor: Readonly<{ userId: string; localAdminOverride?: boolean }>,
): Promise<LockedProviderAuthority> {
  const locked = await tx.$queryRaw<
    readonly {
      personalOwnerUserId: string | null;
      providerManagementAdminOnly: boolean;
    }[]
  >`
    SELECT "personalOwnerUserId", "providerManagementAdminOnly" FROM "Workspace"
    WHERE "id" = ${workspaceId} AND "deletionState" = 'active'
    FOR NO KEY UPDATE`;
  const workspace = locked[0];
  if (locked.length !== 1 || !workspace)
    throw new ProviderProfileError("provider_profile_workspace_unavailable");
  const members = await tx.$queryRaw<readonly { role: WorkspaceMemberRole }[]>`
    SELECT "role" FROM "WorkspaceMember"
    WHERE "workspaceId" = ${workspaceId} AND "userId" = ${actor.userId}
    FOR SHARE`;
  return {
    actor: providerManagementActor(actor, members[0]?.role ?? null),
    workspace: {
      personalOwnerUserId: workspace.personalOwnerUserId,
      providerManagementAdminOnly: workspace.providerManagementAdminOnly,
    },
  };
}

/**
 * The same facts for display, without locks: the dashboard explains disabled
 * controls with them and every write decides again under its own locks.
 */
export async function readProviderAuthority(
  prisma: Prisma.TransactionClient,
  workspaceId: string,
  actor: Readonly<{ userId: string; localAdminOverride?: boolean }>,
): Promise<LockedProviderAuthority | null> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, deletionState: "active" },
    select: { personalOwnerUserId: true, providerManagementAdminOnly: true },
  });
  if (!workspace) return null;
  const member = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
    select: { role: true },
  });
  return {
    actor: providerManagementActor(actor, member?.role ?? null),
    workspace,
  };
}

/** The local-admin override acts as an admin; an owner stays an owner. */
function providerManagementActor(
  actor: Readonly<{ userId: string; localAdminOverride?: boolean }>,
  role: WorkspaceMemberRole | null,
): ProviderManagementActor {
  return {
    userId: actor.userId,
    role:
      actor.localAdminOverride === true && role !== "owner" ? "admin" : role,
  };
}

export function providerProfileFacts(
  profile: WorkspaceProviderProfile,
  personalBindings: ReadonlySet<string>,
): ProviderProfileFacts {
  const { credential } = profile;
  return {
    credentialKind: credential.kind,
    createdByUserId: profile.createdByUserId,
    personalBinding:
      credential.kind === "gateway_binding" &&
      personalBindings.has(credential.bindingId),
    repositoryId:
      credential.kind === "repository_rotating"
        ? credential.repositoryId
        : null,
  };
}
