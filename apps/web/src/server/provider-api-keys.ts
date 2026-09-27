import type { PrismaClient } from "@prisma/client";
import { OctokitCodexRotatingGitHubSecretGateway } from "../../../api/src/github/octokit-codex-rotating-github-secret-gateway.js";
import {
  decryptServerToken,
  encryptServerToken,
} from "@reviewrouter/features-auth";
import {
  classifyProviderApiKeyError,
  providerApiKeyErrorReasonSchema,
  providerApiKeyRepositoryStatusSchema,
  type ProviderApiKeyErrorReason,
  type ProviderApiKeyGitHubSecretGatewayPort,
  type ProviderApiKeyProvider,
  type ProviderApiKeyRepositoryPort,
  type ProviderApiKeyRepositoryResult,
  type ProviderApiKeyRepositoryTarget,
  type ProviderApiKeyRepositoryStatus,
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
} {
  return {
    providerApiKeys: new PrismaProviderApiKeyStore(input.prisma),
    providerApiKeyRepositories: new PrismaProviderApiKeyRepository(
      input.prisma,
    ),
    storageCipher: new ServerTokenProviderApiKeyCipher(input.env),
    githubSecrets: new OctokitCodexRotatingGitHubSecretGateway({
      appId: input.githubAppId,
      privateKey: input.githubAppPrivateKey,
    }),
    classifyError: classifyProviderApiKeyError,
  };
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
        installationId: { not: null },
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

  async saveEncryptedApiKey(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly encryptedApiKey: string;
  }): Promise<void> {
    await this.prisma.providerApiKeyConnection.upsert({
      where: {
        workspaceId_providerType: {
          workspaceId: input.workspaceId,
          providerType: input.providerType,
        },
      },
      update: { encryptedApiKey: input.encryptedApiKey },
      create: {
        workspaceId: input.workspaceId,
        providerType: input.providerType,
        encryptedApiKey: input.encryptedApiKey,
      },
    });
  }

  async saveRepositoryResults(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
    readonly results: readonly ProviderApiKeyRepositoryResult[];
  }): Promise<void> {
    const connection = await this.prisma.providerApiKeyConnection.findUnique({
      where: {
        workspaceId_providerType: {
          workspaceId: input.workspaceId,
          providerType: input.providerType,
        },
      },
      select: { id: true },
    });
    if (!connection) throw new Error("provider_api_key_connection_not_found");
    const repositories = await this.prisma.repositoryConnection.findMany({
      where: {
        workspaceId: input.workspaceId,
        id: { in: input.results.map((result) => result.repositoryId) },
      },
      select: { id: true },
    });
    const repositoryIds = new Set(
      repositories.map((repository) => repository.id),
    );
    const operations = input.results
      .filter((result) => repositoryIds.has(result.repositoryId))
      .map((result) =>
        this.prisma.providerApiKeyRepositoryLink.upsert({
          where: {
            providerApiKeyConnectionId_repositoryId: {
              providerApiKeyConnectionId: connection.id,
              repositoryId: result.repositoryId,
            },
          },
          update: repositoryLinkValues(result),
          create: {
            providerApiKeyConnectionId: connection.id,
            repositoryId: result.repositoryId,
            ...repositoryLinkValues(result),
          },
        }),
      );
    if (operations.length > 0) await this.prisma.$transaction(operations);
  }

  async findState(input: {
    readonly workspaceId: string;
    readonly providerType: ProviderApiKeyProvider;
  }): Promise<ProviderApiKeyState> {
    const connection = await this.prisma.providerApiKeyConnection.findUnique({
      where: {
        workspaceId_providerType: {
          workspaceId: input.workspaceId,
          providerType: input.providerType,
        },
      },
      select: {
        repositoryLinks: {
          orderBy: { repository: { fullName: "asc" } },
          select: {
            status: true,
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
      repositories: (connection?.repositoryLinks ?? []).map((link) => {
        const errorReason = parseErrorReason(link.lastErrorReason);
        return {
          repositoryId: link.repository.id,
          repositoryFullName: link.repository.fullName,
          status: providerApiKeyRepositoryStatusSchema
            .catch("pending")
            .parse(link.status),
          ...(errorReason ? { errorReason } : {}),
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

export function repositoryLinkValues(result: ProviderApiKeyRepositoryResult): {
  readonly status: ProviderApiKeyRepositoryStatus;
  readonly lastErrorReason: string | null;
  readonly appliedAt: Date | null;
} {
  return {
    status: result.status,
    lastErrorReason: result.errorReason ?? null,
    appliedAt: result.status === "applied" ? new Date() : null,
  };
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
