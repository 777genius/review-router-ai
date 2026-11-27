import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  InstallationWorkspaceOwnerGrant,
  InstallationWorkspaceOwnerGrantPort,
} from "../../application/ports/installation-workspace-owner-grant-port";

export class PrismaInstallationWorkspaceOwnerGrant implements InstallationWorkspaceOwnerGrantPort {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
  ) {}

  // Prisma 7 transaction proxies expose $transaction too; only the root client
  // owns connection lifecycle and may start a new transaction.
  private transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return "$connect" in this.prisma &&
      typeof this.prisma.$connect === "function"
      ? this.prisma.$transaction(work)
      : work(this.prisma);
  }

  async grantInstallationActorOwner(
    grant: InstallationWorkspaceOwnerGrant,
  ): Promise<void> {
    await this.transaction(async (tx) => {
      const installation = await tx.gitHubInstallation.findUnique({
        where: {
          githubInstallationId: BigInt(grant.githubInstallationId),
        },
        select: {
          workspaceId: true,
        },
      });
      if (!installation) {
        throw new Error("installation_not_found_for_owner_grant");
      }

      const user = await tx.user.upsert({
        where: { githubUserId: BigInt(grant.githubUserId) },
        update: {
          githubLogin: grant.githubLogin,
          avatarUrl: grant.avatarUrl ?? null,
        },
        create: {
          githubUserId: BigInt(grant.githubUserId),
          githubLogin: grant.githubLogin,
          primaryEmail: null,
          avatarUrl: grant.avatarUrl ?? null,
        },
      });

      const existingByUser = await tx.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: installation.workspaceId,
            userId: user.id,
          },
        },
        select: { id: true },
      });
      // The explicit grant may enroll a first owner, but cannot widen any
      // existing stable membership or reconcile ambiguous legacy login rows.
      if (existingByUser) return;
      const existingByLogin = await tx.workspaceMember.findFirst({
        where: {
          workspaceId: installation.workspaceId,
          githubLogin: { equals: grant.githubLogin, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (existingByLogin) {
        throw new Error("installation_owner_grant_identity_ambiguous");
      }

      await tx.workspaceMember.create({
        data: {
          workspaceId: installation.workspaceId,
          userId: user.id,
          githubLogin: grant.githubLogin,
          role: "owner",
        },
      });
    });
  }
}
