import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ProviderApiKeyGitHubGateway } from "./provider-api-key-github-gateway";
import {
  decryptServerToken,
  encryptServerToken,
} from "@reviewrouter/features-auth";
import {
  classifyProviderApiKeyError,
  providerApiKeyErrorReasonSchema,
  providerApiKeyRepositoryStatusSchema,
  sanitizeProviderApiKeyError,
  type ProviderApiKeyErrorReason,
  type ProviderApiKeyGitHubSecretGatewayPort,
  type ProviderApiKeyLockPort,
  type ProviderApiKeyProvider,
  type ProviderApiKeyRepositoryPort,
  type ProviderApiKeyRepositoryResult,
  type ProviderApiKeyRepositoryStatus,
  type ProviderApiKeyRepositoryTarget,
  type ProviderApiKeyState,
  type ProviderApiKeyStorageCipherPort,
  type ProviderApiKeyStorePort,
} from "@reviewrouter/features-provider-setup";
import { PostgresLeaseLock } from "@reviewrouter/platform-locks";

export function createProviderApiKeyServiceDependencies(input: {
  readonly prisma: PrismaClient;
  readonly githubAppId: string;
  readonly githubAppPrivateKey: string;
  readonly env?: NodeJS.ProcessEnv;
}): {
  readonly providerApiKeys: ProviderApiKeyStorePort;
  readonly providerApiKeyRepositories: ProviderApiKeyRepositoryPort;
  readonly storageCipher: ProviderApiKeyStorageCipherPort;
  readonly githubSecrets: ProviderApiKeyGitHubSecretGatewayPort;
  readonly classifyError: typeof classifyProviderApiKeyError;
  readonly lock: ProviderApiKeyLockPort;
} {
  return {
    providerApiKeys: new PrismaProviderApiKeyStore(input.prisma),
    providerApiKeyRepositories: new PrismaProviderApiKeyRepository(
      input.prisma,
    ),
    storageCipher: new ServerTokenProviderApiKeyCipher(input.env),
    githubSecrets: new ProviderApiKeyGitHubGateway({
      appId: input.githubAppId,
      privateKey: input.githubAppPrivateKey,
    }),
    classifyError: classifyProviderApiKeyError,
    lock: new PostgresLeaseLock(input.prisma),
  };
}

export async function assertProviderApiKeyWorkspaceGranted(
  prisma: PrismaClient,
  workspaceId: string,
): Promise<void> {
  const access = new PrismaProviderApiKeyWorkspaceGrantStore(prisma);
  if (!(await access.isGranted(workspaceId))) {
    throw new Error("provider_key_workspace_grant_required");
  }
}

export class PrismaProviderApiKeyWorkspaceGrantStore {
  constructor(private readonly prisma: PrismaClient) {}

  async isGranted(workspaceId: string): Promise<boolean> {
    const grant = await this.prisma.providerApiKeyWorkspaceGrant.findUnique({
      where: { workspaceId },
      select: { id: true },
    });
    return grant !== null;
  }

  async grant(input: {
    readonly workspaceId: string;
    readonly grantedBy: string;
    readonly grantReason: string;
  }): Promise<void> {
    await this.prisma.providerApiKeyWorkspaceGrant.upsert({
      where: { workspaceId: input.workspaceId },
      update: {
        grantedBy: input.grantedBy,
        grantReason: input.grantReason,
      },
      create: input,
    });
  }

  async revoke(workspaceId: string): Promise<void> {
    await this.prisma.providerApiKeyWorkspaceGrant.deleteMany({
      where: { workspaceId },
    });
  }
}

export class PrismaProviderApiKeyRepository implements ProviderApiKeyRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findRepositoryTargets(input: {
    readonly workspaceId: string;
    readonly repositoryIds: readonly string[];
  }): Promise<readonly ProviderApiKeyRepositoryTarget[]> {
    const repositories = await this.prisma.repositoryConnection.findMany({
      where: {
        workspaceId: input.workspaceId,
        provider: "github",
        id: { in: [...input.repositoryIds] },
        archived: false,
        installation: {
          is: {
            workspaceId: input.workspaceId,
            status: "active",
          },
        },
        githubRepositoryId: { not: null },
      },
      select: {
        id: true,
        fullName: true,
        owner: true,
        name: true,
        githubRepositoryId: true,
        installation: { select: { githubInstallationId: true } },
      },
    });
    return repositories.flatMap((repository) =>
      repository.githubRepositoryId !== null && repository.installation
        ? [
            {
              repositoryId: repository.id,
              repositoryFullName: repository.fullName,
              githubInstallationId:
                repository.installation.githubInstallationId.toString(),
              githubRepositoryId: repository.githubRepositoryId.toString(),
              owner: repository.owner,
              repo: repository.name,
            },
          ]
        : [],
    );
  }
}

export class PrismaProviderApiKeyStore implements ProviderApiKeyStorePort {
  constructor(private readonly prisma: PrismaClient) {}

  async findEncryptedApiKey(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<string | null> {
    const connection = await this.prisma.providerApiKeyConnection.findUnique({
      where: { workspaceId_providerType: input },
      select: { encryptedApiKey: true },
    });
    return connection?.encryptedApiKey ?? null;
  }

  async findConnectedRepositoryIds(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<readonly string[]> {
    const links = await this.prisma.providerApiKeyRepositoryLink.findMany({
      where: {
        connection: {
          workspaceId: input.workspaceId,
          providerType: input.providerType,
        },
      },
      select: { repositoryId: true },
      orderBy: { repositoryId: "asc" },
    });
    return links.map((link) => link.repositoryId);
  }

  async prepareApply(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly encryptedApiKey?: string;
    readonly repositoryIds: readonly string[];
  }): Promise<{
    readonly operationId: string;
    readonly keyVersion: number;
    readonly repositoryIds: readonly string[];
  }> {
    const operationId = randomUUID();
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      const repositoryIds = [...new Set(input.repositoryIds)];
      if (repositoryIds.length === 0) {
        throw new Error("repository_not_allowed");
      }
      const repositories = await transaction.repositoryConnection.findMany({
        where: {
          workspaceId: input.workspaceId,
          id: { in: repositoryIds },
        },
        select: { id: true },
      });
      if (repositories.length !== repositoryIds.length) {
        throw new Error("repository_not_allowed");
      }
      const connectionWhere = {
        workspaceId_providerType: {
          workspaceId: input.workspaceId,
          providerType: input.providerType,
        },
      } as const;
      const existing = await transaction.providerApiKeyConnection.findUnique({
        where: connectionWhere,
        select: { keyVersion: true },
      });
      if (!input.encryptedApiKey && !existing) {
        throw new Error("stored_api_key_unavailable");
      }
      const keyVersion = input.encryptedApiKey
        ? (existing?.keyVersion ?? 0) + 1
        : (existing?.keyVersion ?? 1);
      const connection = input.encryptedApiKey
        ? await transaction.providerApiKeyConnection.upsert({
            where: connectionWhere,
            update: {
              encryptedApiKey: input.encryptedApiKey,
              keyVersion,
              latestOperationId: operationId,
            },
            create: {
              workspaceId: input.workspaceId,
              providerType: input.providerType,
              encryptedApiKey: input.encryptedApiKey,
              keyVersion,
              latestOperationId: operationId,
            },
          })
        : await transaction.providerApiKeyConnection.update({
            where: connectionWhere,
            data: { latestOperationId: operationId },
          });
      const existingLinks =
        await transaction.providerApiKeyRepositoryLink.findMany({
          where: {
            repositoryId: { in: repositoryIds },
            connection: {
              workspaceId: input.workspaceId,
              providerType: input.providerType,
            },
          },
          select: {
            repositoryId: true,
            status: true,
            reconciliationNeeded: true,
          },
        });
      const existingLinkByRepositoryId = new Map<
        string,
        (typeof existingLinks)[number]
      >();
      for (const link of existingLinks) {
        existingLinkByRepositoryId.set(link.repositoryId, link);
      }
      for (const repositoryId of repositoryIds) {
        const existingLink = existingLinkByRepositoryId.get(repositoryId);
        const preserveUnknownResult =
          existingLink?.reconciliationNeeded === true ||
          existingLink?.status === "applying" ||
          existingLink?.status === "reconciliation_needed";
        await transaction.providerApiKeyRepositoryLink.upsert({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connection.id,
              repositoryId,
            },
          },
          update: {
            status: preserveUnknownResult ? "reconciliation_needed" : "pending",
            operationId,
            attemptedKeyVersion: keyVersion,
            attemptCount: { increment: 1 },
            reconciliationNeeded: preserveUnknownResult,
            ...(preserveUnknownResult
              ? {}
              : { lastErrorReason: null, lastErrorSummary: null }),
            lastAttemptAt: now,
          },
          create: {
            workspaceId: input.workspaceId,
            providerApiKeyConnectionId: connection.id,
            repositoryId,
            status: "pending",
            operationId,
            attemptedKeyVersion: keyVersion,
            attemptCount: 1,
            reconciliationNeeded: false,
            lastAttemptAt: now,
          },
        });
      }
      return {
        operationId,
        keyVersion,
        repositoryIds,
      };
    });
  }

  async markRepositoryApplying(input: {
    readonly operationId: string;
    readonly repositoryId: string;
  }): Promise<boolean> {
    return this.prisma.$transaction(async (transaction) => {
      const link = await transaction.providerApiKeyRepositoryLink.findFirst({
        where: {
          repositoryId: input.repositoryId,
          operationId: input.operationId,
        },
        select: {
          id: true,
          operationId: true,
          connection: { select: { latestOperationId: true } },
        },
      });
      if (!link) return false;
      if (
        link.operationId !== input.operationId ||
        link.connection.latestOperationId !== input.operationId
      ) {
        return false;
      }
      await transaction.providerApiKeyRepositoryLink.update({
        where: { id: link.id },
        data: {
          status: "applying",
          reconciliationNeeded: true,
          lastAttemptAt: new Date(),
        },
      });
      return true;
    });
  }

  async recordRepositoryResult(input: {
    readonly operationId: string;
    readonly keyVersion: number;
    readonly result: ProviderApiKeyRepositoryResult;
  }): Promise<"recorded" | "superseded"> {
    return this.prisma.$transaction(async (transaction) => {
      const link = await transaction.providerApiKeyRepositoryLink.findFirst({
        where: {
          repositoryId: input.result.repositoryId,
          operationId: input.operationId,
        },
        select: {
          id: true,
          operationId: true,
          attemptedKeyVersion: true,
          appliedKeyVersion: true,
          appliedAt: true,
          reconciliationNeeded: true,
          connection: { select: { latestOperationId: true, keyVersion: true } },
        },
      });
      if (!link) return "superseded";
      if (
        link.operationId !== input.operationId ||
        link.attemptedKeyVersion !== input.keyVersion ||
        link.connection.latestOperationId !== input.operationId ||
        link.connection.keyVersion !== input.keyVersion
      ) {
        return "superseded";
      }
      const applied = input.result.status === "applied";
      const errorReason = input.result.errorReason ?? null;
      const reconciliationNeeded =
        input.result.status === "reconciliation_needed" ||
        (link.reconciliationNeeded &&
          (input.result.status === "pending" ||
            input.result.status === "applying"));
      await transaction.providerApiKeyRepositoryLink.update({
        where: { id: link.id },
        data: {
          status: input.result.status,
          appliedKeyVersion: applied
            ? input.keyVersion
            : link.appliedKeyVersion,
          appliedAt: applied ? new Date() : link.appliedAt,
          reconciliationNeeded,
          lastErrorReason: errorReason,
          lastErrorSummary: errorReason
            ? sanitizeProviderApiKeyError(errorReason)
            : null,
        },
      });
      return "recorded";
    });
  }

  async markRepositoryReconciliationNeeded(input: {
    readonly operationId: string;
    readonly repositoryId: string;
    readonly errorReason: ProviderApiKeyErrorReason;
  }): Promise<void> {
    await this.prisma.providerApiKeyRepositoryLink.updateMany({
      where: {
        repositoryId: input.repositoryId,
        operationId: input.operationId,
        connection: { latestOperationId: input.operationId },
      },
      data: {
        status: "reconciliation_needed",
        reconciliationNeeded: true,
        lastErrorReason: input.errorReason,
        lastErrorSummary: sanitizeProviderApiKeyError(input.errorReason),
      },
    });
  }

  async findState(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<ProviderApiKeyState> {
    const connection = await this.prisma.providerApiKeyConnection.findUnique({
      where: { workspaceId_providerType: input },
      select: {
        keyVersion: true,
        repositoryLinks: {
          orderBy: { repository: { fullName: "asc" } },
          select: {
            status: true,
            appliedKeyVersion: true,
            attemptedKeyVersion: true,
            reconciliationNeeded: true,
            lastErrorReason: true,
            appliedAt: true,
            repository: { select: { id: true, fullName: true } },
          },
        },
      },
    });
    return {
      providerType: input.providerType,
      connected: connection !== null,
      keyVersion: connection?.keyVersion ?? null,
      repositories: (connection?.repositoryLinks ?? []).map((link) => {
        const errorReason = parseErrorReason(link.lastErrorReason);
        return {
          repositoryId: link.repository.id,
          repositoryFullName: link.repository.fullName,
          status: effectiveRepositoryStatus({
            status: providerApiKeyRepositoryStatusSchema
              .catch("pending")
              .parse(link.status),
            keyVersion: connection?.keyVersion ?? null,
            appliedKeyVersion: link.appliedKeyVersion,
            reconciliationNeeded: link.reconciliationNeeded,
          }),
          ...(errorReason
            ? {
                errorReason,
                errorSummary: sanitizeProviderApiKeyError(errorReason),
              }
            : {}),
          appliedKeyVersion: link.appliedKeyVersion,
          attemptedKeyVersion: link.attemptedKeyVersion,
          appliedAt: link.appliedAt,
        };
      }),
    };
  }
}

export class ServerTokenProviderApiKeyCipher implements ProviderApiKeyStorageCipherPort {
  constructor(private readonly env: NodeJS.ProcessEnv | undefined) {}

  encrypt(plaintext: string): string {
    return encryptServerToken(plaintext, this.env ?? process.env);
  }

  decrypt(payload: string): string {
    return decryptServerToken(payload, this.env ?? process.env);
  }
}

function effectiveRepositoryStatus(input: {
  readonly status: ProviderApiKeyRepositoryStatus;
  readonly keyVersion: number | null;
  readonly appliedKeyVersion: number | null;
  readonly reconciliationNeeded: boolean;
}): ProviderApiKeyRepositoryStatus {
  if (input.reconciliationNeeded) return "reconciliation_needed";
  if (input.status === "applying") return "applying";
  if (
    input.appliedKeyVersion !== null &&
    input.keyVersion !== null &&
    input.appliedKeyVersion !== input.keyVersion
  ) {
    return "stale";
  }
  return input.status;
}

function parseErrorReason(
  value: string | null,
): ProviderApiKeyErrorReason | undefined {
  return value
    ? providerApiKeyErrorReasonSchema
        .catch("github_request_failed")
        .parse(value)
    : undefined;
}
