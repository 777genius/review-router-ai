import type { PrismaClient } from "@reviewrouter/platform-db";
import { PrismaInstallationSyncStatusReader } from "@reviewrouter/features-github-installations";
import {
  repositoryScanStateOf,
  type RepositoryScanSnapshot,
} from "../features/repository-scan/repository-scan-model";
import { latestInstallationPerAccount } from "./dashboard-workspace-model";

/**
 * Repository scan progress of one workspace. Callers authorize workspace-wide
 * access first; the read returns only installation logins, states and a count.
 */
export async function loadRepositoryScanSnapshot(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
}): Promise<RepositoryScanSnapshot> {
  const installations = latestInstallationPerAccount(
    (
      await input.prisma.gitHubInstallation.findMany({
        where: { workspaceId: input.workspaceId, status: "active" },
        select: {
          githubInstallationId: true,
          accountLogin: true,
          accountType: true,
          createdAt: true,
        },
      })
    ).map((installation) => ({
      ...installation,
      githubInstallationId: installation.githubInstallationId.toString(),
    })),
  );
  const requests = await new PrismaInstallationSyncStatusReader(
    input.prisma,
  ).latestByInstallation(
    installations.map((installation) => installation.githubInstallationId),
  );
  // Count after the status read: a finished scan's repositories are all in it.
  const repositoryCount = await input.prisma.repositoryConnection.count({
    where: { workspaceId: input.workspaceId },
  });
  const now = new Date();

  return {
    checkedAt: now.toISOString(),
    repositoryCount,
    installations: installations
      .map((installation) => ({
        githubInstallationId: installation.githubInstallationId,
        accountLogin: installation.accountLogin,
        ...repositoryScanStateOf({
          request: requests.get(installation.githubInstallationId) ?? null,
          installationCreatedAt: installation.createdAt,
          now,
        }),
      }))
      .sort((left, right) =>
        left.accountLogin.localeCompare(right.accountLogin),
      ),
  };
}
