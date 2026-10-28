import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  MemoryPermissionDecision,
  MemoryPermissionPort,
  MemoryRepositoryMaintainerPort,
} from "../../application/ports/memory-permission-port";
import type { MemoryActor } from "../../domain/memory-actor";
import type { MemoryScope } from "../../domain/memory-scope-policy";

export class PrismaMemoryPermission implements MemoryPermissionPort {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly options: {
      readonly localAdminGithubLogins?: readonly string[];
      readonly localDevelopmentProfile?: boolean;
      readonly localAdminGithubUserIds?: readonly string[];
      readonly repositoryMaintainers?: MemoryRepositoryMaintainerPort;
    } = {},
  ) {}

  async canConfirmMemory(input: {
    readonly workspaceId: string;
    readonly repositoryId: string | null;
    readonly userId: string | null;
    readonly scope: MemoryScope;
    readonly actor: MemoryActor;
  }): Promise<MemoryPermissionDecision> {
    if (this.isLocalAdmin(input.actor)) {
      return { allowed: true };
    }

    if (input.scope === "user_prefs") {
      const userId = await this.resolveUserId(input.actor);
      return input.userId && input.userId === userId
        ? { allowed: true }
        : deny("not_user_owner", false);
    }

    if (input.scope === "repository") {
      const repositoryAvailable = await this.repositoryAvailable({
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
      });
      if (!repositoryAvailable) {
        return deny("repository_unavailable", false);
      }
    }

    const role = await this.findWorkspaceRole({
      workspaceId: input.workspaceId,
      actor: input.actor,
    });
    if (role === "owner" || role === "admin") {
      return { allowed: true };
    }

    if (
      input.scope === "repository" &&
      input.repositoryId &&
      this.options.repositoryMaintainers
    ) {
      if (!trustedActor(input.actor))
        return deny("not_repository_maintainer", false);
      try {
        const resolved = await this.options.repositoryMaintainers.isMaintainer({
          workspaceId: input.workspaceId,
          repositoryId: input.repositoryId,
          actor: input.actor,
        });
        if (resolved === "maintainer") return { allowed: true };
        if (resolved === "unavailable")
          return deny("permission_service_unavailable", true);
      } catch {
        return deny("permission_service_unavailable", true);
      }
    }

    return deny(
      input.scope === "repository"
        ? "not_repository_maintainer"
        : "not_workspace_admin",
      false,
    );
  }

  private isLocalAdmin(actor: MemoryActor): boolean {
    return (
      this.options.localDevelopmentProfile === true &&
      actor.kind === "github_user" &&
      Boolean(
        actor.githubUserId &&
        /^\d+$/.test(actor.githubUserId) &&
        this.options.localAdminGithubUserIds?.includes(actor.githubUserId),
      )
    );
  }

  private async resolveUserId(actor: MemoryActor): Promise<string | null> {
    return resolveMemoryProductUserId(this.prisma, actor);
  }

  private async repositoryAvailable(input: {
    readonly workspaceId: string;
    readonly repositoryId: string | null;
  }): Promise<boolean> {
    if (!input.repositoryId) return false;
    const repository = await this.prisma.repositoryConnection.findFirst({
      where: {
        id: input.repositoryId,
        workspaceId: input.workspaceId,
      },
      select: {
        selected: true,
        archived: true,
      },
    });
    return Boolean(repository?.selected && !repository.archived);
  }

  private async findWorkspaceRole(input: {
    readonly workspaceId: string;
    readonly actor: MemoryActor;
  }): Promise<"owner" | "admin" | "member" | null> {
    return resolveMemoryWorkspaceRole(this.prisma, input);
  }
}

function workspaceMemberActorFilter(
  actor: MemoryActor,
): Prisma.WorkspaceMemberWhereInput[] | null {
  if (actor.kind === "workspace_user") {
    return [{ userId: actor.id }];
  }
  const filters: Prisma.WorkspaceMemberWhereInput[] = [];
  if (
    actor.kind === "github_user" &&
    actor.githubUserId &&
    /^\d+$/.test(actor.githubUserId)
  ) {
    filters.push({ user: { githubUserId: BigInt(actor.githubUserId) } });
  }
  return filters.length > 0 ? filters : null;
}

function trustedActor(actor: MemoryActor): boolean {
  return actor.kind === "workspace_user"
    ? Boolean(actor.id)
    : actor.kind === "github_user" &&
        Boolean(actor.githubUserId && /^\d+$/.test(actor.githubUserId));
}

function deny(
  reason: Exclude<
    MemoryPermissionDecision,
    { readonly allowed: true }
  >["reason"],
  retryable: boolean,
): MemoryPermissionDecision {
  return { allowed: false, reason, retryable };
}

/** Stable identity helpers shared by product management and read authorization. */
export async function resolveMemoryProductUserId(
  prisma: PrismaClient | Prisma.TransactionClient,
  actor: MemoryActor,
): Promise<string | null> {
  if (actor.kind === "workspace_user") return actor.id || null;
  if (
    actor.kind !== "github_user" ||
    !actor.githubUserId ||
    !/^\d+$/.test(actor.githubUserId)
  )
    return null;
  const user = await prisma.user.findFirst({
    where: { githubUserId: BigInt(actor.githubUserId) },
    select: { id: true },
  });
  return user?.id ?? null;
}

export async function resolveMemoryWorkspaceRole(
  prisma: PrismaClient | Prisma.TransactionClient,
  input: { readonly workspaceId: string; readonly actor: MemoryActor },
): Promise<"owner" | "admin" | "member" | null> {
  const actorFilter = workspaceMemberActorFilter(input.actor);
  if (!actorFilter) return null;
  const member = await prisma.workspaceMember.findFirst({
    where: { workspaceId: input.workspaceId, OR: actorFilter },
    select: { role: true },
  });
  return member?.role ?? null;
}
