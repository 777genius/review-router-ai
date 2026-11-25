import type { PrismaClient } from "@prisma/client";
import type { MemoryRepositoryMaintainerPort } from "../../application/ports/memory-permission-port";

export type MemoryRepositoryPermissionClient = {
  request(
    route: "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
    parameters: {
      readonly owner: string;
      readonly repo: string;
      readonly username: string;
      readonly request: { readonly timeout: number };
    },
  ): Promise<{ readonly data: unknown }>;
};

/** Shared web/Action host adapter. A login is a lookup hint, never the actor's authority. */
export function createPrismaMemoryRepositoryMaintainers(dependencies: {
  readonly prisma: PrismaClient;
  readonly createClient: (
    installationId: string,
  ) => Promise<MemoryRepositoryPermissionClient>;
}): MemoryRepositoryMaintainerPort {
  return {
    async isMaintainer(input) {
      try {
        const actor = input.actor;
        if (actor.kind === "system") return "not_maintainer";
        const user =
          actor.kind === "workspace_user"
            ? await dependencies.prisma.user.findUnique({
                where: { id: actor.id },
                select: { githubUserId: true, githubLogin: true },
              })
            : { githubUserId: actor.githubUserId, githubLogin: actor.login };
        if (
          !user?.githubUserId ||
          !/^\d+$/.test(String(user.githubUserId)) ||
          !user.githubLogin
        )
          return "not_maintainer";
        const repository =
          await dependencies.prisma.repositoryConnection.findFirst({
            where: {
              id: input.repositoryId,
              workspaceId: input.workspaceId,
              selected: true,
              archived: false,
              provider: "github",
            },
            select: {
              owner: true,
              name: true,
              installation: {
                select: { githubInstallationId: true, status: true },
              },
            },
          });
        if (
          !repository?.installation ||
          repository.installation.status !== "active"
        )
          return "not_maintainer";
        const client = await dependencies.createClient(
          String(repository.installation.githubInstallationId),
        );
        const result = await client.request(
          "GET /repos/{owner}/{repo}/collaborators/{username}/permission",
          {
            owner: repository.owner,
            repo: repository.name,
            username: user.githubLogin,
            request: { timeout: 1_500 },
          },
        );
        const data = result.data as {
          permission?: unknown;
          role_name?: unknown;
          user?: { id?: unknown; login?: unknown };
        };
        if (
          String(data.user?.id) !== String(user.githubUserId) ||
          typeof data.user?.login !== "string" ||
          data.user.login.toLowerCase() !== user.githubLogin.toLowerCase()
        )
          return "not_maintainer";
        return [data.permission, data.role_name].some(
          (role) => role === "maintain" || role === "admin",
        )
          ? "maintainer"
          : "not_maintainer";
      } catch {
        return "unavailable";
      }
    },
  };
}
