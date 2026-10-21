import { createPrismaReviewSkillsService } from "@reviewrouter/features-review-skills/composition";
import { getPrisma } from "./prisma";
import { assertDashboardSkillsRepositoryManagementAllowed } from "./dashboard-mutations";
import { DashboardMutationRefusedError } from "./dashboard-mutation-errors";

/** Every request gets fresh identity/authority. Construction confers no access. */
export async function productionReviewSkills() {
  const prisma = getPrisma();
  return createPrismaReviewSkillsService({
    prisma,
    repositoryAccess: {
      async authorizeRepositoryManagement({
        actor,
        workspaceId,
        repositoryIds,
      }) {
        const member = await prisma.workspaceMember.findUnique({
          where: { workspaceId_userId: { workspaceId, userId: actor.userId } },
          select: { role: true },
        });
        // This is only a preflight optimization. The atomic feature operation
        // must recheck this DB role and workspace state under its own locks.
        if (member?.role === "owner" || member?.role === "admin") return [];
        const repositories = await prisma.repositoryConnection.findMany({
          where: { workspaceId, id: { in: [...repositoryIds] } },
          include: { installation: true },
        });
        const checked: string[] = [];
        // Bound upstream concurrency; never turn an outage into positive proof.
        for (let offset = 0; offset < repositories.length; offset += 8) {
          const results = await Promise.all(
            repositories.slice(offset, offset + 8).map(async (repository) => {
              if (
                repository.provider !== "github" ||
                !repository.githubRepositoryId ||
                !repository.installation ||
                !repository.selected ||
                repository.archived ||
                repository.installation.status !== "active"
              )
                return null;
              let current;
              try {
                current =
                  await assertDashboardSkillsRepositoryManagementAllowed(
                    workspaceId,
                    {
                      ...repository,
                      githubRepositoryId: repository.githubRepositoryId,
                      installation: repository.installation,
                    },
                  );
              } catch (error) {
                if (
                  error instanceof DashboardMutationRefusedError &&
                  error.message === "repository_mutation_forbidden"
                )
                  return null;
                throw error;
              }
              if (current.userId !== actor.userId)
                throw new Error("review_skills_actor_changed");
              return repository.id;
            }),
          );
          checked.push(...results.filter((id): id is string => id !== null));
        }
        return checked;
      },
    },
  });
}
