import type { Prisma, PrismaClient } from "@prisma/client";

type SettingsClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  "workspace" | "gitHubInstallation"
>;

/** Workspace behavior is independent of provider policies and repository overrides. */
export class PrismaWorkspaceReviewSettings {
  constructor(private readonly prisma: SettingsClient) {}

  async reviewDrafts(workspaceId: string): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { reviewDraftPullRequests: true },
    });
    return workspace?.reviewDraftPullRequests === true;
  }

  async reviewDraftsForGitHubInstallation(
    githubInstallationId: string,
  ): Promise<boolean> {
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { githubInstallationId: BigInt(githubInstallationId) },
      select: { workspace: { select: { reviewDraftPullRequests: true } } },
    });
    return installation?.workspace.reviewDraftPullRequests === true;
  }

  async save(
    workspaceId: string,
    reviewDraftPullRequests: boolean,
  ): Promise<void> {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { reviewDraftPullRequests },
    });
  }

  /** Access rights: only owners and admins manage providers. Absent is off. */
  async providerManagementAdminOnly(workspaceId: string): Promise<boolean> {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { providerManagementAdminOnly: true },
    });
    return workspace?.providerManagementAdminOnly === true;
  }

  /** Writes only the Access rights column, never the draft review setting. */
  async saveProviderManagementAdminOnly(
    workspaceId: string,
    providerManagementAdminOnly: boolean,
  ): Promise<void> {
    await this.prisma.workspace.update({
      where: { id: workspaceId },
      data: { providerManagementAdminOnly },
    });
  }
}
