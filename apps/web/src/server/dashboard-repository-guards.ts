import { PrismaAuditLogRepository } from "@reviewrouter/features-audit-log";
import {
  assertWorkspaceFeatureEntitlement,
  PrismaEntitlementRepository,
  type EntitlementFeature,
} from "@reviewrouter/features-entitlements";
import type { PrismaClient } from "@reviewrouter/platform-db";
import type { DashboardMutationActor } from "./dashboard-mutations";

/** A GitHub repository of the workspace as dashboard mutations read it. */
export type DashboardRepository = Readonly<{
  id: string;
  workspaceId: string;
  githubRepositoryId: bigint;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  visibility: string;
  selected: boolean;
  archived: boolean;
  installation: Readonly<{
    status: string;
    githubInstallationId: bigint;
  }>;
}>;

/**
 * Reads a GitHub repository of the workspace; any other repository, including
 * one of another workspace, is `repository_not_found`.
 */
export async function loadDashboardRepository(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly repositoryId: string;
}): Promise<DashboardRepository> {
  const repository = await input.prisma.repositoryConnection.findUnique({
    where: { id: input.repositoryId },
    select: {
      id: true,
      workspaceId: true,
      provider: true,
      githubRepositoryId: true,
      owner: true,
      name: true,
      fullName: true,
      defaultBranch: true,
      visibility: true,
      selected: true,
      archived: true,
      installation: { select: { status: true, githubInstallationId: true } },
    },
  });
  if (!repository || repository.workspaceId !== input.workspaceId) {
    throw new Error("repository_not_found");
  }
  if (
    repository.provider !== "github" ||
    !repository.githubRepositoryId ||
    !repository.installation
  ) {
    throw new Error("repository_not_found");
  }

  return {
    ...repository,
    githubRepositoryId: repository.githubRepositoryId,
    installation: repository.installation,
  };
}

export function assertRepositoryConfigMutable(input: {
  readonly selected: boolean;
  readonly archived: boolean;
  readonly installation: { readonly status: string };
}): void {
  if (!input.selected) {
    throw new Error("repository_not_selected");
  }
  if (input.archived) {
    throw new Error("repository_archived");
  }
  if (input.installation.status !== "active") {
    throw new Error("installation_not_active");
  }
}

export async function assertDashboardEntitlement(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly actor: string;
  readonly feature: EntitlementFeature;
}): Promise<void> {
  await assertWorkspaceFeatureEntitlement(
    {
      workspaceId: input.workspaceId,
      actor: input.actor,
      feature: input.feature,
    },
    {
      entitlements: new PrismaEntitlementRepository(input.prisma),
      auditLog: new PrismaAuditLogRepository(input.prisma),
    },
  );
}

/**
 * A network-bound check ran between two authorizations of one mutation; the
 * write continues only for the same signed-in identity.
 */
export function assertGatewayReviewActorUnchanged(
  original: DashboardMutationActor,
  current: DashboardMutationActor,
): void {
  if (
    original.userId !== current.userId ||
    original.sourceProvider !== current.sourceProvider ||
    original.externalUserId !== current.externalUserId ||
    original.githubUserId !== current.githubUserId
  )
    throw new Error("gateway_review_config_denied");
}
