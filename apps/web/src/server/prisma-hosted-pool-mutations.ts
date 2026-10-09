import { createHash, randomUUID } from "node:crypto";
import {
  bindRepositoryToDefaultPool,
  createPrismaHostedAccountPoolAdapters,
  createWorkspaceDefaultPool,
  CredentialEnvelopeVault,
  hostedAccountId,
  hostedBindingId,
  hostedCodexProductionKmsBindingArn,
  hostedPoolId,
  importAndEnrollHostedCodexAccount,
  fingerprintCodexAuthJson,
  PrismaHostedCodexMutationFence,
  PrismaHostedCodexSessionPersistence,
  reconnectHostedAccount,
  repositoryId,
  resolveHostedCodexKeyring,
  setHostedAccountAvailability,
  tombstoneHostedAccount,
  switchRepositoryToRepositoryOwnedRotating,
  workspaceId,
  type RepositoryReviewConfigurationAuthModeAuthority,
} from "@reviewrouter/features-hosted-account-pool";
import { switchRepositoryConfigurationAuthMode } from "@reviewrouter/features-workflow-provisioning";
export { switchRepositoryConfigurationAuthMode } from "@reviewrouter/features-workflow-provisioning";
import type { PrismaClient } from "@reviewrouter/platform-db";
import { assertHostedCodexProductionReadiness } from "@reviewrouter/platform-config";
import type { HostedPoolDashboardMutationPort } from "./hosted-pool-dashboard";

export function createPrismaHostedPoolDashboardMutationPort(input: {
  readonly prisma: PrismaClient;
  readonly env: Readonly<Record<string, string | undefined>>;
}): HostedPoolDashboardMutationPort {
  const createAdapters = () => {
    assertHostedCodexProductionReadiness(input.env, "web");
    const databaseIncarnation =
      input.env.REVIEW_ROUTER_HOSTED_CODEX_DATABASE_INCARNATION?.trim();
    const encodedPepper =
      input.env.REVIEW_ROUTER_HOSTED_CODEX_FINGERPRINT_PEPPER?.trim();
    if (!databaseIncarnation)
      throw new Error("hosted_codex_database_incarnation_missing");
    const databaseResourceIdentity =
      input.env.REVIEW_ROUTER_HOSTED_CODEX_DATABASE_RESOURCE_IDENTITY?.trim();
    if (!databaseResourceIdentity || databaseResourceIdentity.length < 16) {
      throw new Error("hosted_codex_database_resource_identity_invalid");
    }
    if (!encodedPepper)
      throw new Error("hosted_codex_fingerprint_pepper_missing");
    const fingerprintPepper = Buffer.from(encodedPepper, "base64");
    if (
      fingerprintPepper.byteLength < 32 ||
      fingerprintPepper.toString("base64") !== encodedPepper
    ) {
      throw new Error("hosted_codex_fingerprint_pepper_invalid");
    }
    const keyring = resolveHostedCodexKeyring({
      env: input.env,
      purpose: "enrollment",
    });
    const vault = new CredentialEnvelopeVault(keyring, "relay");
    return {
      ...createPrismaHostedAccountPoolAdapters({
        prisma: input.prisma,
        vault,
        databaseIncarnation,
        databaseResourceIdentity,
        fingerprintPepper,
        configurationAuthority: createRepositoryConfigurationAuthority(),
      }),
      fingerprintPepper,
      persistence: new PrismaHostedCodexSessionPersistence(
        input.prisma,
        vault,
        databaseIncarnation,
        databaseResourceIdentity,
        fingerprintPepper,
        hostedCodexProductionKmsBindingArn(keyring),
      ),
    };
  };

  const findReconnectTarget = async (command: {
    readonly workspaceId: string;
    readonly accountId: string;
    readonly expectedGeneration: number;
    readonly expectedHealthVersion: number;
  }) => {
    const account = await input.prisma.hostedCodexAccount.findFirst({
      where: {
        id: command.accountId,
        workspaceId: command.workspaceId,
        state: "paused",
        tombstonedAt: null,
        activeGeneration: BigInt(command.expectedGeneration),
        healthVersion: BigInt(command.expectedHealthVersion),
        pool: {
          workspaceId: command.workspaceId,
          isDefault: true,
          status: "active",
          tombstonedAt: null,
        },
      },
      select: { id: true, poolId: true },
    });
    if (!account) throw new Error("hosted_codex_reconnect_conflict");
    return account;
  };

  return {
    async assertReconnectTarget(command) {
      await findReconnectTarget(command);
    },

    async reconnectAccount(command) {
      try {
        const target = await findReconnectTarget(command);
        const adapters = createAdapters();
        const fences = new PrismaHostedCodexMutationFence(input.prisma);
        await reconnectHostedAccount(
          {
            workspaceId: workspaceId(command.workspaceId),
            poolId: hostedPoolId(target.poolId),
            accountId: hostedAccountId(target.id),
            expectedGeneration: command.expectedGeneration,
            expectedHealthVersion: command.expectedHealthVersion,
            authJsonBytes: command.authJson,
          },
          {
            accounts: adapters.accounts,
            validate: (bytes) => ({
              fingerprint: fingerprintCodexAuthJson(
                bytes,
                adapters.fingerprintPepper,
              ),
              generationHash: createHash("sha256").update(bytes).digest("hex"),
            }),
            acquire: async (accountId) => {
              const lease = await fences.acquire({
                accountId,
                runId: `device-reconnect:${randomUUID()}`,
                attempt: 1,
                ttlMs: 30_000,
                restoredGenerationHash: "operator-reconnect",
              });
              if (lease.status !== "granted")
                throw new Error("hosted_pool_reconnect_busy");
              return lease.leaseId;
            },
            release: (leaseId) =>
              fences.release({
                leaseId,
                reason: "operator_reconnect_finished",
              }),
            commit: (replacement) =>
              adapters.persistence.reconnect(replacement),
          },
        );
        const accounts = await adapters.queries.listAccountSummaries(
          hostedPoolId(target.poolId),
        );
        const account = accounts.find((row) => row.id === target.id);
        if (!account) throw new Error("hosted_account_not_found");
        return account;
      } finally {
        command.authJson.fill(0);
      }
    },

    async importAccount(command) {
      const adapters = createAdapters();
      const authJson = command.authJson;
      const commandWorkspaceId = workspaceId(command.workspaceId);
      try {
        const pool = await createWorkspaceDefaultPool(
          {
            id: hostedPoolId(randomUUID()),
            workspaceId: commandWorkspaceId,
            now: command.requestedAt,
          },
          adapters.pools,
        );
        return await importAndEnrollHostedCodexAccount(
          {
            workspaceId: commandWorkspaceId,
            poolId: pool.id,
            accountId: hostedAccountId(randomUUID()),
            label: command.label,
            priority: command.priority,
            expectedPoolRevision: pool.revision,
            authJsonBytes: authJson,
            requestedAt: command.requestedAt,
          },
          { credentialEnrollment: adapters.credentialEnrollment },
        );
      } finally {
        authJson.fill(0);
      }
    },

    async setAccountState(command) {
      const adapters = createAdapters();
      const account = await adapters.accounts.findById(
        hostedAccountId(command.accountId),
      );
      const pool = account
        ? await adapters.pools.findById(account.poolId)
        : null;
      if (
        !account ||
        !pool ||
        pool.workspaceId !== workspaceId(command.workspaceId)
      )
        throw new Error("hosted_account_not_found");
      await setHostedAccountAvailability(
        {
          accountId: hostedAccountId(command.accountId),
          expectedHealthVersion: command.expectedVersion,
          availability:
            command.state === "healthy"
              ? { status: "healthy" }
              : {
                  status: "paused",
                  reason: "Paused by a workspace administrator",
                },
          now: command.requestedAt,
        },
        adapters.accounts,
      );
    },

    async removeAccount(command) {
      const adapters = createAdapters();
      const account = await adapters.accounts.findById(
        hostedAccountId(command.accountId),
      );
      const pool = account
        ? await adapters.pools.findById(account.poolId)
        : null;
      if (
        !account ||
        !pool ||
        pool.workspaceId !== workspaceId(command.workspaceId)
      )
        throw new Error("hosted_account_not_found");
      await tombstoneHostedAccount(
        {
          accountId: hostedAccountId(command.accountId),
          expectedHealthVersion: command.expectedVersion,
          now: command.requestedAt,
        },
        adapters.accounts,
      );
    },

    async setRepositorySource(command) {
      const adapters = createAdapters();
      const commandRepositoryId = repositoryId(command.repositoryId);
      const commandWorkspaceId = workspaceId(command.workspaceId);
      if (command.source === "hosted_workspace_pool") {
        const binding = await bindRepositoryToDefaultPool(
          {
            bindingId: hostedBindingId(randomUUID()),
            repositoryId: commandRepositoryId,
            workspaceId: commandWorkspaceId,
            expectedRevision:
              command.expectedVersion === 0 ? null : command.expectedVersion,
            now: command.requestedAt,
          },
          { pools: adapters.pools, bindings: adapters.bindings },
        );
        return {
          activation: binding.status === "active" ? "active" : "pending",
          bindingId: String(binding.bindingId),
          bindingRevision: binding.revision,
        };
      } else {
        if (command.expectedVersion < 1)
          throw new Error("hosted_pool_binding_revision_conflict");
        await switchRepositoryToRepositoryOwnedRotating(
          {
            repositoryId: commandRepositoryId,
            workspaceId: commandWorkspaceId,
            expectedBindingRevision: command.expectedVersion,
            now: command.requestedAt,
          },
          {
            bindings: adapters.bindings,
            authModeSwitch: adapters.authModeSwitch,
          },
        );
      }
      return { activation: "pending" };
    },
  };
}

export function createRepositoryConfigurationAuthority(): RepositoryReviewConfigurationAuthModeAuthority {
  return {
    async switchToRepositoryOwnedRotating(input) {
      return switchRepositoryConfigurationAuthMode({
        transaction: input.transaction,
        workspaceId: input.workspaceId,
        repositoryId: input.repositoryId,
        authMode: "codex_subscription_oauth_rotating",
      });
    },
  };
}
