import { z } from "zod";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { PrismaWorkspaceAccessRepository } from "@reviewrouter/features-auth";
import {
  ReviewConfigurationOperatorOperation,
  type ReviewConfigurationOperatorAuthorizationPort,
} from "@reviewrouter/features-review-config";

export const installedGatewayPermission = "confirm_installed_gateway_workflow";
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/);
const grantSchema = z.strictObject({
  operatorId: identifier,
  permission: z.literal(installedGatewayPermission),
  ownerGitHubUserId: z
    .string()
    .regex(/^[1-9][0-9]{0,18}$/)
    .refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n),
  workspaceId: identifier,
  repositoryIds: z.array(identifier).min(1).max(16),
});
export type WorkflowProvisioningOperatorGrant = z.infer<typeof grantSchema>;
export function readWorkflowProvisioningOperatorGrants(
  value: string | undefined,
): readonly WorkflowProvisioningOperatorGrant[] {
  if (value === undefined || value === "") return [];
  try {
    if (Buffer.byteLength(value) > 32_768) throw new Error();
    const grants = z.array(grantSchema).min(1).max(16).parse(JSON.parse(value));
    const selectors = new Set<string>();
    for (const grant of grants) {
      for (const repositoryId of grant.repositoryIds) {
        const key = JSON.stringify([
          grant.operatorId,
          grant.workspaceId,
          repositoryId,
        ]);
        if (selectors.has(key)) throw new Error();
        selectors.add(key);
      }
      Object.freeze(grant.repositoryIds);
      Object.freeze(grant);
    }
    return Object.freeze(grants);
  } catch {
    throw new Error("workflow_provisioning_operator_grants_invalid");
  }
}

export class WorkflowProvisioningOperatorAccessError extends Error {
  constructor(readonly code: "unauthorized" | "forbidden") {
    super(code);
  }
}
export type WorkflowProvisioningOperatorScope = Readonly<{
  operatorId: string;
  ownerUserId: string;
  ownerGitHubUserId: string;
  workspaceId: string;
  repositoryId: string;
  repository: string;
}>;
export interface WorkflowProvisioningOperatorAccess {
  ownerUserId(githubUserId: string): Promise<string | null>;
  isOwner(workspaceId: string, userId: string): Promise<boolean>;
  repository(
    workspaceId: string,
    fullName: string,
    ids: readonly string[],
  ): Promise<{ id: string; fullName: string } | null>;
  assertEntitled(workspaceId: string, operatorId: string): Promise<void>;
}

/** Existing config authentication establishes identity, never this new permission. */
export function createWorkflowProvisioningOperatorAuthorization(input: {
  authorization: ReviewConfigurationOperatorAuthorizationPort;
  grants: readonly WorkflowProvisioningOperatorGrant[];
  access: WorkflowProvisioningOperatorAccess;
}) {
  const denied = (): never => {
    throw new WorkflowProvisioningOperatorAccessError("forbidden");
  };
  const assertCurrent = async (scope: WorkflowProvisioningOperatorScope) => {
    const grant = input.grants.find(
      (entry) =>
        entry.operatorId === scope.operatorId &&
        entry.workspaceId === scope.workspaceId &&
        entry.ownerGitHubUserId === scope.ownerGitHubUserId &&
        entry.repositoryIds.includes(scope.repositoryId),
    );
    if (
      !grant ||
      (await input.access.ownerUserId(scope.ownerGitHubUserId)) !==
        scope.ownerUserId ||
      !(await input.access.isOwner(scope.workspaceId, scope.ownerUserId))
    )
      denied();
    const repository = await input.access.repository(
      scope.workspaceId,
      scope.repository,
      [scope.repositoryId],
    );
    if (!repository || repository.id !== scope.repositoryId) denied();
    await input.access.assertEntitled(scope.workspaceId, scope.operatorId);
    if (
      (await input.access.ownerUserId(scope.ownerGitHubUserId)) !==
        scope.ownerUserId ||
      !(await input.access.isOwner(scope.workspaceId, scope.ownerUserId))
    )
      denied();
  };
  return {
    assertCurrent,
    authorize: async (
      credential: string,
      workspaceId: string,
      repository: string,
    ): Promise<WorkflowProvisioningOperatorScope> => {
      const principal = await input.authorization.authenticate({
        credential,
        operation:
          ReviewConfigurationOperatorOperation.ConfirmInstalledGatewayWorkflow,
      });
      if (!principal)
        throw new WorkflowProvisioningOperatorAccessError("unauthorized");
      const grants = input.grants.filter(
        (entry) =>
          entry.operatorId === principal.operatorId &&
          entry.workspaceId === workspaceId,
      );
      // A missing grant refuses before any tenant, repository or entitlement read.
      if (!grants.length) denied();
      const target = await input.access.repository(
        workspaceId,
        repository,
        grants.flatMap((entry) => entry.repositoryIds),
      );
      if (!target) return denied();
      const matches = grants.filter((entry) =>
        entry.repositoryIds.includes(target.id),
      );
      if (matches.length !== 1) return denied();
      const grant = matches[0]!;
      const ownerUserId = await input.access.ownerUserId(
        grant.ownerGitHubUserId,
      );
      if (!ownerUserId) return denied();
      const scope = Object.freeze({
        operatorId: principal.operatorId,
        ownerUserId,
        ownerGitHubUserId: grant.ownerGitHubUserId,
        workspaceId,
        repositoryId: target.id,
        repository: target.fullName,
      });
      await assertCurrent(scope);
      return scope;
    },
  };
}

export function prismaWorkflowProvisioningOperatorAccess(
  prisma: PrismaClient,
  assertEntitled: WorkflowProvisioningOperatorAccess["assertEntitled"],
): WorkflowProvisioningOperatorAccess {
  const access = new PrismaWorkspaceAccessRepository(prisma);
  return {
    assertEntitled,
    ownerUserId: async (githubUserId) => {
      const [external, legacy] = await Promise.all([
        prisma.userExternalIdentity.findUnique({
          where: {
            provider_externalUserId: {
              provider: "github",
              externalUserId: githubUserId,
            },
          },
          select: { userId: true, user: { select: { githubUserId: true } } },
        }),
        prisma.user.findUnique({
          where: { githubUserId: BigInt(githubUserId) },
          select: { id: true },
        }),
      ]);
      if (
        external &&
        ((external.user.githubUserId !== null &&
          external.user.githubUserId !== BigInt(githubUserId)) ||
          (legacy && external.userId !== legacy.id))
      )
        return null;
      return external?.userId ?? legacy?.id ?? null;
    },
    isOwner: async (workspaceId, userId) => {
      const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { deletionState: true, personalOwnerUserId: true },
      });
      if (!workspace || workspace.deletionState !== "active") return false;
      if (workspace.personalOwnerUserId !== null)
        return workspace.personalOwnerUserId === userId;
      return (
        (await access.findWorkspaceRoleByUserId({ workspaceId, userId })) ===
        "owner"
      );
    },
    repository: async (workspaceId, fullName, ids) => {
      const rows = await prisma.repositoryConnection.findMany({
        where: {
          workspaceId,
          id: { in: [...ids] },
          provider: "github",
          sourceBaseUrl: "https://github.com",
          fullName: { equals: fullName, mode: "insensitive" },
          selected: true,
          archived: false,
        },
        select: { id: true, fullName: true },
        take: 2,
      });
      return rows.length === 1 ? rows[0]! : null;
    },
  };
}
