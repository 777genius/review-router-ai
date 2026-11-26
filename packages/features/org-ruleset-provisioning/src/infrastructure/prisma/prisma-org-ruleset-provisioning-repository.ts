import type { Prisma, PrismaClient } from "@prisma/client";
import { writePrismaOutboxEvent } from "@reviewrouter/features-outbox";
import { buildSourceWorkflowRef } from "../../domain/org-ruleset-provisioning";
import type {
  OrgRulesetProvisioningRecord,
  OrgRulesetProvisioningRepositoryPort,
} from "../../application/ports/org-ruleset-provisioning-repository-port";
import type {
  OrgRulesetProvisioningRequest,
  OrgRulesetProvisioningTarget,
} from "../../domain/org-ruleset-provisioning";

export class PrismaOrgRulesetProvisioningRepository implements OrgRulesetProvisioningRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findTargetByInstallation(input: {
    readonly workspaceId: string;
    readonly githubInstallationId: string;
  }): Promise<OrgRulesetProvisioningTarget | null> {
    const installation = await this.prisma.gitHubInstallation.findUnique({
      where: { githubInstallationId: BigInt(input.githubInstallationId) },
      select: {
        id: true,
        workspaceId: true,
        githubInstallationId: true,
        accountLogin: true,
        accountType: true,
        repositorySelection: true,
        status: true,
        repositories: {
          where: {
            provider: "github",
            githubRepositoryId: { not: null },
          },
          orderBy: { fullName: "asc" },
          select: {
            id: true,
            githubRepositoryId: true,
            owner: true,
            name: true,
            fullName: true,
            defaultBranch: true,
            selected: true,
            archived: true,
            visibility: true,
          },
        },
      },
    });

    if (!installation || installation.workspaceId !== input.workspaceId) {
      return null;
    }

    return {
      workspaceId: installation.workspaceId,
      installationId: installation.id,
      githubInstallationId: installation.githubInstallationId.toString(),
      organizationLogin: installation.accountLogin,
      accountType: installation.accountType,
      installationStatus: installation.status,
      repositorySelection: installation.repositorySelection,
      repositories: installation.repositories.flatMap((repository) =>
        repository.githubRepositoryId
          ? [
              {
                ...repository,
                githubRepositoryId: repository.githubRepositoryId.toString(),
              },
            ]
          : [],
      ),
    };
  }

  async findById(id: string): Promise<OrgRulesetProvisioningRecord | null> {
    const record = await this.prisma.orgRulesetProvisioning.findUnique({
      where: { id },
    });
    return record ? toRecord(record) : null;
  }

  async findByWorkspaceId(
    workspaceId: string,
  ): Promise<OrgRulesetProvisioningRecord | null> {
    const record = await this.prisma.orgRulesetProvisioning.findUnique({
      where: { workspaceId },
    });
    return record ? toRecord(record) : null;
  }

  async listConfiguredTrustedWorkflows(input: {
    readonly workspaceId: string;
    readonly githubRepositoryId: string;
  }): Promise<readonly string[]> {
    const rows = await this.prisma.orgRulesetProvisioning.findMany({
      where: { workspaceId: input.workspaceId, status: "configured" },
      select: {
        scope: true,
        sourceGithubRepositoryId: true,
        sourceRepositoryFullName: true,
        sourceWorkflowPath: true,
        sourceWorkflowRef: true,
        targetRepositoryIds: true,
      },
    });

    return rows
      .filter((row) => {
        if (
          row.sourceGithubRepositoryId?.toString() === input.githubRepositoryId
        ) {
          return false;
        }
        if (row.scope === "all_repositories") return true;
        return parseTargetRepositoryIds(row.targetRepositoryIds).includes(
          input.githubRepositoryId,
        );
      })
      .flatMap((row) => {
        if (!row.sourceRepositoryFullName) return [];
        return [
          buildSourceWorkflowRef({
            repositoryFullName: row.sourceRepositoryFullName,
            path: row.sourceWorkflowPath,
            ref: row.sourceWorkflowRef,
          }),
        ];
      });
  }

  async requestAndEnqueue(
    request: OrgRulesetProvisioningRequest,
  ): Promise<OrgRulesetProvisioningRecord> {
    return this.prisma.$transaction(async (tx) => {
      // A stable parent row also serializes the first request, before a ruleset row exists.
      await tx.$queryRaw`
        SELECT "id" FROM "Workspace"
        WHERE "id" = ${request.workspaceId} FOR NO KEY UPDATE
      `;
      await tx.$queryRaw`
        SELECT "id" FROM "OrgRulesetProvisioning"
        WHERE "workspaceId" = ${request.workspaceId} FOR UPDATE
      `;
      const previous = await tx.orgRulesetProvisioning.findUnique({
        where: { workspaceId: request.workspaceId },
      });
      const organization = request.organizationLogin.toLowerCase();
      if (
        previous?.pendingRulesetCreateOrganization &&
        previous.pendingRulesetCreateOrganization !== organization
      ) {
        throw new Error(
          "org_ruleset_create_outcome_unknown_for_previous_organization",
        );
      }
      const changedOrganization =
        previous !== null &&
        previous.organizationLogin.toLowerCase() !== organization;
      if (changedOrganization && previous?.pendingRemoteAttemptId) {
        throw new Error(
          "org_ruleset_remote_outcome_unknown_for_previous_organization",
        );
      }
      const data = {
        installationId: request.installationId,
        githubInstallationId: BigInt(request.githubInstallationId),
        organizationLogin: request.organizationLogin,
        status: "requested" as const,
        scope: request.scope,
        enforcement: request.enforcement,
        sourceRepositoryId: request.sourceRepositoryId ?? null,
        sourceGithubRepositoryId: request.sourceGithubRepositoryId
          ? BigInt(request.sourceGithubRepositoryId)
          : null,
        sourceRepositoryFullName: request.sourceRepositoryFullName ?? null,
        sourceWorkflowPath: request.sourceWorkflowPath,
        sourceWorkflowRef: request.sourceWorkflowRef,
        sourceWorkflowSha: null,
        ...(changedOrganization ? { rulesetId: null, rulesetUrl: null } : {}),
        targetRepositoryIds: [...request.targetRepositoryIds],
        safeErrorCode: null,
        safeErrorSummary: null,
        requestedBy: request.requestedBy,
        requestedAt: request.requestedAt,
        lastAttemptAt: null,
        configuredAt: null,
      };
      const record = await tx.orgRulesetProvisioning.upsert({
        where: { workspaceId: request.workspaceId },
        create: { workspaceId: request.workspaceId, ...data },
        update: { ...data, revision: { increment: 1 } },
      });
      await writePrismaOutboxEvent(
        tx,
        provisioningEvent(record, request.requestedAt),
      );
      return toRecord(record);
    });
  }

  async markProcessing(input: {
    readonly id: string;
    readonly revision: number;
    readonly attemptedAt: Date;
  }): Promise<boolean> {
    const result = await this.prisma.orgRulesetProvisioning.updateMany({
      where: { id: input.id, revision: input.revision },
      data: {
        status: "processing",
        lastAttemptAt: input.attemptedAt,
        safeErrorCode: null,
        safeErrorSummary: null,
      },
    });
    return result.count === 1;
  }

  async markConfigured(input: {
    readonly id: string;
    readonly revision: number;
    readonly sourceWorkflowSha: string | null;
    readonly rulesetId: string;
    readonly rulesetUrl: string | null;
    readonly configuredAt: Date;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await lockUnresolvedRemoteOrganization(tx, input.id, input.revision))
      )
        return false;
      const result = await tx.orgRulesetProvisioning.updateMany({
        where: {
          id: input.id,
          revision: input.revision,
          pendingRemoteAttemptId: null,
        },
        data: {
          status: "configured",
          sourceWorkflowSha: input.sourceWorkflowSha,
          rulesetId: BigInt(input.rulesetId),
          rulesetUrl: input.rulesetUrl,
          pendingRulesetCreateOrganization: null,
          configuredAt: input.configuredAt,
          safeErrorCode: null,
          safeErrorSummary: null,
        },
      });
      return result.count === 1;
    });
  }

  async markFailed(input: {
    readonly id: string;
    readonly revision: number;
    readonly safeErrorCode: string;
    readonly safeErrorSummary: string;
  }): Promise<boolean> {
    const result = await this.prisma.orgRulesetProvisioning.updateMany({
      where: { id: input.id, revision: input.revision },
      data: {
        status: "failed",
        safeErrorCode: input.safeErrorCode,
        safeErrorSummary: input.safeErrorSummary,
      },
    });
    return result.count === 1;
  }

  async beginRulesetCreate(input: {
    readonly id: string;
    readonly revision: number;
    readonly organizationLogin: string;
  }): Promise<boolean> {
    const organization = input.organizationLogin.toLowerCase();
    return this.prisma.$transaction(async (tx) => {
      // The caller owns the normalized organization lease across this check and POST.
      const unresolved = await tx.orgRulesetProvisioning.findFirst({
        where: { pendingRulesetCreateOrganization: organization },
        select: { id: true },
      });
      if (unresolved) throw new Error("org_ruleset_create_outcome_unknown");
      const result = await tx.orgRulesetProvisioning.updateMany({
        where: {
          id: input.id,
          revision: input.revision,
          pendingRulesetCreateOrganization: null,
        },
        data: { pendingRulesetCreateOrganization: organization },
      });
      return result.count === 1;
    });
  }

  async beginRemoteAttempt(input: {
    readonly id: string;
    readonly revision: number;
    readonly attemptId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      if (
        !(await lockUnresolvedRemoteOrganization(tx, input.id, input.revision))
      )
        return false;
      const result = await tx.orgRulesetProvisioning.updateMany({
        where: {
          id: input.id,
          revision: input.revision,
          pendingRemoteAttemptId: null,
        },
        data: { pendingRemoteAttemptId: input.attemptId },
      });
      return result.count === 1;
    });
  }

  async settleRemoteAttempt(input: {
    readonly id: string;
    readonly attemptId: string;
    readonly observedRevision: number;
    readonly occurredAt: Date;
    readonly reconcile: boolean;
    readonly clearRejectedCreateForOrganization?: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT "id" FROM "OrgRulesetProvisioning" WHERE "id" = ${input.id} FOR UPDATE
      `;
      const current = await tx.orgRulesetProvisioning.findUnique({
        where: { id: input.id },
      });
      if (!current || current.pendingRemoteAttemptId !== input.attemptId)
        return;
      const reconcile =
        input.reconcile || current.revision !== input.observedRevision;
      await tx.orgRulesetProvisioning.update({
        where: { id: current.id },
        data: {
          pendingRemoteAttemptId: null,
          ...(input.clearRejectedCreateForOrganization?.toLowerCase() ===
          current.pendingRulesetCreateOrganization
            ? { pendingRulesetCreateOrganization: null }
            : {}),
          ...(reconcile
            ? {
                status: "failed",
                safeErrorCode: "org_ruleset_reconciliation_required",
                safeErrorSummary:
                  "A completed superseded remote operation requires readback of the current desired revision.",
              }
            : {}),
        },
      });
      if (reconcile)
        await writePrismaOutboxEvent(tx, {
          ...provisioningEvent(current, input.occurredAt),
          idempotencyKey: `org-ruleset:${current.id}:revision:${current.revision}:repair:${input.attemptId}`,
        });
    });
  }
}

type OrgRulesetProvisioningRow = Awaited<
  ReturnType<PrismaClient["orgRulesetProvisioning"]["findUnique"]>
>;

function toRecord(
  record: NonNullable<OrgRulesetProvisioningRow>,
): OrgRulesetProvisioningRecord {
  return {
    id: record.id,
    revision: record.revision,
    pendingRulesetCreateOrganization: record.pendingRulesetCreateOrganization,
    pendingRemoteAttemptId: record.pendingRemoteAttemptId,
    workspaceId: record.workspaceId,
    installationId: record.installationId,
    githubInstallationId: record.githubInstallationId.toString(),
    organizationLogin: record.organizationLogin,
    status: record.status,
    scope: record.scope,
    enforcement: record.enforcement,
    sourceRepositoryId: record.sourceRepositoryId,
    sourceGithubRepositoryId:
      record.sourceGithubRepositoryId?.toString() ?? null,
    sourceRepositoryFullName: record.sourceRepositoryFullName,
    sourceWorkflowPath: record.sourceWorkflowPath,
    sourceWorkflowRef: record.sourceWorkflowRef,
    sourceWorkflowSha: record.sourceWorkflowSha,
    rulesetId: record.rulesetId?.toString() ?? null,
    rulesetUrl: record.rulesetUrl,
    targetRepositoryIds: parseTargetRepositoryIds(record.targetRepositoryIds),
    safeErrorCode: record.safeErrorCode,
    safeErrorSummary: record.safeErrorSummary,
    requestedBy: record.requestedBy,
    requestedAt: record.requestedAt,
    lastAttemptAt: record.lastAttemptAt,
    configuredAt: record.configuredAt,
    updatedAt: record.updatedAt,
  };
}

function parseTargetRepositoryIds(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : String(item)))
    .filter(Boolean);
}

function provisioningEvent(
  record: {
    readonly id: string;
    readonly workspaceId: string;
    readonly revision: number;
  },
  occurredAt: Date,
) {
  return {
    type: "org_ruleset.provision_requested",
    version: 1,
    idempotencyKey: `org-ruleset:${record.id}:revision:${record.revision}`,
    workspaceId: record.workspaceId,
    aggregateId: `org-ruleset:${record.id}`,
    payload: { provisioningId: record.id, revision: record.revision },
    occurredAt,
    maxAttempts: 5,
  };
}

/** Serialize admission/settlement across workspaces sharing one remote identity. */
async function lockUnresolvedRemoteOrganization(
  tx: Prisma.TransactionClient,
  id: string,
  revision: number,
): Promise<boolean> {
  const record = await tx.orgRulesetProvisioning.findUnique({
    where: { id },
    select: { organizationLogin: true, revision: true },
  });
  if (!record || record.revision !== revision) return false;
  const rows = await tx.$queryRaw<
    readonly { id: string; pendingRemoteAttemptId: string | null }[]
  >`
    SELECT "id", "pendingRemoteAttemptId" FROM "OrgRulesetProvisioning"
    WHERE lower("organizationLogin") = ${record.organizationLogin.toLowerCase()}
    ORDER BY "id" FOR UPDATE
  `;
  return (
    rows.some((row) => row.id === id) &&
    rows.every((row) => row.pendingRemoteAttemptId === null)
  );
}
