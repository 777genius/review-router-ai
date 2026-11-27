import { runScopeEpochSerializableTransaction } from "@reviewrouter/platform-db";
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
    // Reads can use an existing transaction; writes require a root client so
    // the scope guard is always acquired before the transaction's first read.
    if (typeof Reflect.get(this.prisma, "$connect") !== "function")
      throw new Error("workspace_review_settings_requires_root_client");
    await runScopeEpochSerializableTransaction(
      this.prisma as PrismaClient,
      [{ scope: "workspace", workspaceId, mode: "exclusive" }],
      async (tx) => {
        await tx.workspace.update({
          where: { id: workspaceId },
          data: { reviewDraftPullRequests },
        });
      },
    );
  }
}
