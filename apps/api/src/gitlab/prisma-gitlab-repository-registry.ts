import type { PrismaClient } from "@reviewrouter/platform-db";
import type {
  GitLabRepositoryContext,
  GitLabRepositoryIdentity,
  GitLabRepositoryPort,
} from "@reviewrouter/features-gitlab-integration";

export class PrismaGitLabRepositoryRegistry implements GitLabRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findRepositoryByGitLabProjectIdentity(
    identity: GitLabRepositoryIdentity,
  ): Promise<GitLabRepositoryContext | null> {
    const repository = await this.prisma.repositoryConnection.findUnique({
      where: {
        provider_externalRepositoryId_sourceBaseUrl: {
          provider: "gitlab",
          externalRepositoryId: identity.gitlabProjectId,
          sourceBaseUrl: identity.sourceBaseUrl,
        },
      },
      select: {
        id: true,
        workspaceId: true,
        externalRepositoryId: true,
        sourceBaseUrl: true,
        fullName: true,
        owner: true,
        selected: true,
        gitlabInstallation: { select: { status: true } },
      },
    });
    if (!repository) return null;

    // Return deselected records too: the application denies them, while the
    // fallback registry must not reinterpret the DB denial as a missing row.
    return {
      workspaceId: repository.workspaceId,
      repositoryId: repository.id,
      gitlabProjectId: repository.externalRepositoryId,
      sourceBaseUrl: repository.sourceBaseUrl,
      fullName: repository.fullName,
      owner: repository.owner,
      selected: repository.selected,
      installationStatus: repository.gitlabInstallation?.status ?? "removed",
    };
  }
}
