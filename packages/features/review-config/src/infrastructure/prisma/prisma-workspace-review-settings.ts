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

  /**
   * The workspace settings of Dashboard -> Other in one read: draft reviews
   * and Access rights (only owners and admins manage providers). Access
   * rights are written only through the provider profile repository. The
   * review runtime keeps reading drafts alone through `reviewDrafts`.
   */
  async otherSettings(workspaceId: string): Promise<
    Readonly<{
      reviewDraftPullRequests: boolean;
      providerManagementAdminOnly: boolean;
    }>
  > {
    const workspace = await this.prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: {
        reviewDraftPullRequests: true,
        providerManagementAdminOnly: true,
      },
    });
    return {
      reviewDraftPullRequests: workspace?.reviewDraftPullRequests === true,
      providerManagementAdminOnly:
        workspace?.providerManagementAdminOnly === true,
    };
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
}
