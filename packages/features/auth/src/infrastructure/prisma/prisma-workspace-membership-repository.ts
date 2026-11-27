import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { runScopeEpochSerializableTransaction } from "@reviewrouter/platform-db";
import type { AuthenticatedPrincipal } from "../../domain/authenticated-principal";
import type {
  WorkspaceMembership,
  WorkspaceMembershipRepositoryPort,
} from "../../application/ports/workspace-membership-repository-port";

export class PrismaWorkspaceMembershipRepository implements WorkspaceMembershipRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async ensurePersonalWorkspaceOwner(
    principal: AuthenticatedPrincipal,
  ): Promise<WorkspaceMembership> {
    const githubLogin =
      principal.provider === "github" ? (principal.githubLogin ?? null) : null;
    for (let attempt = 0; ; attempt++) {
      // Discovery is advisory only; identity is checked again after the guard.
      const candidate = await this.prisma.workspace.findUnique({
        where: { personalOwnerUserId: principal.userId },
        select: { id: true },
      });
      try {
        return await runScopeEpochSerializableTransaction(
          this.prisma,
          candidate
            ? [
                {
                  scope: "workspace",
                  workspaceId: candidate.id,
                  mode: "exclusive",
                },
              ]
            : [{ scope: "global", mode: "exclusive" }],
          async (tx) => {
            // Lock the persisted stable authority, including when no P exists yet.
            const users = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "id" = ${principal.userId} FOR UPDATE
      `;
            if (users.length !== 1)
              throw new Error("personal_workspace_user_not_found");
            const existing = await tx.workspace.findUnique({
              where: { personalOwnerUserId: principal.userId },
            });
            if (candidate && existing?.id !== candidate.id)
              throw new PersonalWorkspaceScopeChanged();
            const workspace = existing
              ? await tx.workspace.update({
                  where: { id: existing.id },
                  data: { name: `@${principal.login}` },
                })
              : await tx.workspace.create({
                  data: {
                    personalOwnerUserId: principal.userId,
                    slug: `personal-${randomUUID()}`,
                    name: `@${principal.login}`,
                  },
                });
            const member = await tx.workspaceMember.upsert({
              where: {
                workspaceId_userId: {
                  workspaceId: workspace.id,
                  userId: principal.userId,
                },
              },
              // Repeated login preserves an existing membership's actual role.
              update: {},
              create: {
                workspaceId: workspace.id,
                userId: principal.userId,
                githubLogin,
                role: "owner",
              },
            });
            return {
              workspaceId: workspace.id,
              workspaceSlug: workspace.slug,
              role: member.role,
              source: "personal",
            };
          },
        );
      } catch (error) {
        if (!(error instanceof PersonalWorkspaceScopeChanged) || attempt >= 2)
          throw error;
      }
    }
  }

  async ensureGitHubUserInstallationWorkspaceOwners(
    principal: AuthenticatedPrincipal,
  ): Promise<readonly WorkspaceMembership[]> {
    if (principal.provider !== "github" || !principal.githubLogin) {
      return [];
    }
    const installations = await this.prisma.gitHubInstallation.findMany({
      where: {
        accountType: "User",
        status: "active",
        accountLogin: {
          equals: principal.githubLogin,
          mode: "insensitive",
        },
      },
      select: {
        workspace: {
          select: {
            id: true,
            slug: true,
            members: {
              where: { userId: principal.userId },
              select: { role: true },
            },
          },
        },
      },
    });

    const memberships: WorkspaceMembership[] = [];
    for (const installation of installations) {
      // Login is a read of stable-User membership, never installation enrollment.
      const member = installation.workspace.members[0];
      if (!member) continue;
      memberships.push({
        workspaceId: installation.workspace.id,
        workspaceSlug: installation.workspace.slug,
        role: member.role,
        source: "github_user_installation",
      });
    }

    return memberships;
  }
}

// A discovered scope can change while waiting; rediscover outside a new tx.
class PersonalWorkspaceScopeChanged extends Error {}
