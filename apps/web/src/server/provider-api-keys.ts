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
  type ProviderApiKeyApplySession,
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
    lock: new PostgresProviderApiKeyLock(input.prisma),
  };
}

// Provider secret dispatch needs an observable lease fence. The general
// PostgresLeaseLock callback does not expose its owner token.
export class PostgresProviderApiKeyLock implements ProviderApiKeyLockPort {
  constructor(private readonly prisma: PrismaClient) {}

  async withLock<T>(
    key: string,
    ttlMs: number,
    run: (lease: { isOwned(): Promise<boolean> }) => Promise<T>,
  ): Promise<T> {
    if (!key || key.length > 500 || !Number.isInteger(ttlMs) || ttlMs <= 0) {
      throw new Error("provider_api_key_lock_invalid");
    }
    const owner = randomUUID();
    const acquired = await this.prisma.$queryRaw<readonly { owner: string }[]>`
      INSERT INTO "DistributedLock" ("key", "owner", "expiresAt", "createdAt", "updatedAt")
      VALUES (${key}, ${owner}, NOW() + ${ttlMs} * INTERVAL '1 millisecond', NOW(), NOW())
      ON CONFLICT ("key") DO UPDATE SET
        "owner" = EXCLUDED."owner",
        "expiresAt" = EXCLUDED."expiresAt",
        "updatedAt" = EXCLUDED."updatedAt"
      WHERE "DistributedLock"."expiresAt" <= NOW()
      RETURNING "owner"
    `;
    if (acquired[0]?.owner !== owner) {
      throw new Error("provider_api_key_lock_not_acquired");
    }
    try {
      return await run({
        isOwned: async () => {
          try {
            const rows = await this.prisma.$queryRaw<
              readonly { owned: boolean }[]
            >`
              SELECT EXISTS (
                SELECT 1 FROM "DistributedLock"
                WHERE "key" = ${key} AND "owner" = ${owner}
                  AND "expiresAt" > NOW()
              ) AS "owned"
            `;
            return rows[0]?.owned === true;
          } catch {
            return false;
          }
        },
      });
    } finally {
      await this.prisma.$executeRaw`
        DELETE FROM "DistributedLock" WHERE "key" = ${key} AND "owner" = ${owner}
      `.catch(() => {
        // Preserve the operation outcome; the lease still expires by TTL.
      });
    }
  }
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
  }): Promise<ProviderApiKeyApplySession> {
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
            id: true,
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
      const blockedRepositoryIds: string[] = [];
      for (const repositoryId of repositoryIds) {
        const existingLink = existingLinkByRepositoryId.get(repositoryId);
        const preserveUnknownResult =
          existingLink?.reconciliationNeeded === true ||
          existingLink?.status === "applying" ||
          existingLink?.status === "reconciliation_needed";
        if (preserveUnknownResult) {
          // An earlier PUT may still land after this transaction. Keep its
          // durable quarantine and do not dispatch a replacement write.
          blockedRepositoryIds.push(repositoryId);
          continue;
        }
        if (existingLink) {
          const updated =
            await transaction.providerApiKeyRepositoryLink.updateMany({
              where: {
                id: existingLink.id,
                reconciliationNeeded: false,
                status: { notIn: ["applying", "reconciliation_needed"] },
              },
              data: {
                status: "pending",
                operationId,
                attemptedKeyVersion: keyVersion,
                attemptCount: { increment: 1 },
                reconciliationNeeded: false,
                lastErrorReason: null,
                lastErrorSummary: null,
                lastAttemptAt: now,
              },
            });
          if (updated.count === 0) blockedRepositoryIds.push(repositoryId);
        } else {
          await transaction.providerApiKeyRepositoryLink.create({
            data: {
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
      }
      return {
        operationId,
        keyVersion,
        repositoryIds: repositoryIds.filter(
          (repositoryId) => !blockedRepositoryIds.includes(repositoryId),
        ),
        blockedRepositoryIds,
      };
    });
  }

  async markRepositoryApplying(input: {
    readonly operationId: string;
    readonly repositoryId: string;
  }): Promise<boolean> {
    const updated = await this.prisma.providerApiKeyRepositoryLink.updateMany({
      where: {
        repositoryId: input.repositoryId,
        operationId: input.operationId,
        status: "pending",
        reconciliationNeeded: false,
        connection: { latestOperationId: input.operationId },
      },
      data: {
        status: "applying",
        reconciliationNeeded: true,
        lastAttemptAt: new Date(),
      },
    });
    return updated.count === 1;
  }

  async recordRepositoryResult(input: {
    readonly operationId: string;
    readonly keyVersion: number;
    readonly result: ProviderApiKeyRepositoryResult;
  }): Promise<"recorded" | "superseded"> {
    const applied = input.result.status === "applied";
    const errorReason = input.result.errorReason ?? null;
    const updated = await this.prisma.providerApiKeyRepositoryLink.updateMany({
      where: {
        repositoryId: input.result.repositoryId,
        operationId: input.operationId,
        attemptedKeyVersion: input.keyVersion,
        connection: {
          latestOperationId: input.operationId,
          keyVersion: input.keyVersion,
        },
      },
      data: {
        status: input.result.status,
        ...(applied
          ? { appliedKeyVersion: input.keyVersion, appliedAt: new Date() }
          : {}),
        ...(input.result.status === "pending" ||
        input.result.status === "applying"
          ? {}
          : {
              reconciliationNeeded:
                input.result.status === "reconciliation_needed",
            }),
        lastErrorReason: errorReason,
        lastErrorSummary: errorReason
          ? sanitizeProviderApiKeyError(errorReason)
          : null,
      },
    });
    return updated.count === 1 ? "recorded" : "superseded";
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
