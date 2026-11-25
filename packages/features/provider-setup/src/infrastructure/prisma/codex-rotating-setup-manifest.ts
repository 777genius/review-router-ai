import {
  assertCodexRotatingSetupRecoveryWitness,
  fingerprintConfiguredSetupRecoveryWitness,
} from "./codex-rotating-setup-witness";
import {
  CodexRotatingSetupManifestStatus,
  assertSetupManifestFetchable,
  assertFetchedRecoveryWindow,
  evaluateSetupManifestRecoveryAuthority,
  isReusableIssuedManifest,
  type SetupRecoveryRequestFacts,
} from "../../domain/codex-rotating-setup-manifest-policy";
import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import {
  buildCodexRotatingSetupManifest,
  canonicalCodexRotatingProviderId,
  codexRotatingAuthMode,
  codexRotatingSecretName,
  codexRotatingSetupManifestSchema,
  createCodexRotatingSalt,
  encodeCodexRotatingSetupManifest,
  fingerprintDatabaseRecoveryWitness,
  renderCodexRotatingInstallerCommand,
  codexRuntimeMigrationBindingSchema,
  type CodexRotatingInstallerArgument,
  type CodexRuntimeMigrationBinding,
} from "../../index";
import { isCodexRotatingOAuthAllowedForRepository } from "@reviewrouter/platform-config";
import type { CodexRotatingSeedScriptDescriptor } from "../../domain/codex-rotating-installer";
import {
  isCodexRotatingSetupFenceOwner,
  lockCodexRotatingProviderRow,
  lockCodexRotatingSetupProvider,
} from "./codex-rotating-provider-mutation-fence";
import { assertOriginalCodexRuntimeMigrationSource } from "./codex-runtime-migration-source";

const setupManifestTtlSeconds = 15 * 60;
const setupFetchedRecoveryWindowMs = 24 * 60 * 60 * 1000;
const setupTransactionTimeoutMs = 10_000;

export function assertSetupIssuanceEnabled(
  runtimeEnvironment: NodeJS.ProcessEnv = process.env,
): void {
  if (
    runtimeEnvironment.REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED !==
    "1"
  ) {
    throw new Error("codex_rotating_setup_issuance_quiesced");
  }
}

type SetupManifestRow = {
  readonly id: string;
  readonly providerInstanceRowId: string;
  readonly providerInstanceId: string;
  readonly repositoryId: string;
  readonly setupNonce: string;
  readonly manifestJson: unknown;
  readonly status: CodexRotatingSetupManifestStatus;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
  readonly confirmationJson: unknown | null;
  readonly mutationEpoch: bigint | null;
  readonly databaseRecoveryWitness: string | null;
  readonly recoveryExpiresAt: Date | null;
  readonly payloadVersion: number | null;
  readonly payloadGenerationHash: string | null;
  readonly payloadAccountFingerprint: string | null;
  readonly payloadByteSize: number | null;
  readonly payloadClaimedAt: Date | null;
};

type SetupManifestTransaction = Prisma.TransactionClient;
type SetupManifestQueryClient = Pick<PrismaClient, "$queryRaw">;

export type CodexRotatingSetupAdmittedOperation = (
  tx: SetupManifestTransaction,
) => Promise<void>;

export async function issueCodexRotatingSetupCommand(input: {
  readonly prisma: PrismaClient;
  readonly workspaceId: string;
  readonly repositoryId: string;
  readonly repositoryFullName: string;
  readonly githubRepositoryId: string;
  readonly installer: CodexRotatingSeedScriptDescriptor;
  readonly repositoryDefaultBranch: string;
  readonly setupManifestUrl: string;
  readonly setupPrepareUrl?: string;
  readonly setupDispatchUrl?: string;
  readonly setupDispatchOutcomeUrl?: string;
  readonly setupStatusUrl?: string;
  readonly installerArguments?: readonly CodexRotatingInstallerArgument[];
  readonly databaseRecoveryWitness?: string;
  readonly runtimeEnvironment?: NodeJS.ProcessEnv;
  readonly recovery?: {
    readonly requestId: string;
    readonly epoch: bigint;
  };
  readonly admittedOperation?: CodexRotatingSetupAdmittedOperation;
  readonly runtimeMigration?: {
    readonly binding: CodexRuntimeMigrationBinding;
    /** Re-observes exact disabled ingress and complete queue under this fence. */
    readonly assertDrained: () => Promise<void>;
  };
  readonly now?: Date;
}): Promise<{
  readonly command: string;
  readonly expiresAt: string;
  readonly providerInstanceId: string;
  readonly runtimeMigration?: {
    readonly migrationId: string;
    readonly dispatchAdmission: "fresh" | "readback_only";
  };
}> {
  assertSetupIssuanceEnabled(input.runtimeEnvironment);
  const runtimeMigration = input.runtimeMigration
    ? codexRuntimeMigrationBindingSchema.parse(input.runtimeMigration.binding)
    : undefined;
  if (runtimeMigration && input.recovery) {
    throw new Error("codex_runtime_migration_recovery_conflict");
  }
  if (input.recovery && !input.installerArguments?.includes("--force-reseed")) {
    throw new Error("codex_rotating_setup_recovery_force_required");
  }
  const configuredDatabaseRecoveryWitness =
    fingerprintConfiguredSetupRecoveryWitness(input.databaseRecoveryWitness);
  const providerInstanceId = canonicalCodexRotatingProviderId(
    input.githubRepositoryId,
  );
  return input.prisma.$transaction(
    async (tx) => {
      let admittedOperationCompleted = false;
      const runAdmittedOperation = async (): Promise<void> => {
        if (admittedOperationCompleted) return;
        await input.admittedOperation?.(tx);
        admittedOperationCompleted = true;
      };
      await lockCodexRotatingSetupProvider(tx, providerInstanceId);
      let provider = await tx.codexOAuthProviderInstance.findUnique({
        where: {
          repositoryId_authMode: {
            repositoryId: input.repositoryId,
            authMode: codexRotatingAuthMode,
          },
        },
      });
      const providerExisted = provider !== null;
      if (!provider) {
        // A missing provider has no durable witness evidence or row to recheck.
        // Consume admission before the first provider/setup allocation.
        await runAdmittedOperation();
        provider = await tx.codexOAuthProviderInstance.create({
          data: {
            workspaceId: input.workspaceId,
            repositoryId: input.repositoryId,
            providerInstanceId,
            authMode: codexRotatingAuthMode,
            secretName: codexRotatingSecretName,
            generationHashSalt: createCodexRotatingSalt(),
            accountFingerprintSalt: createCodexRotatingSalt(),
          },
        });
      }
      if (
        provider.workspaceId !== input.workspaceId ||
        provider.repositoryId !== input.repositoryId ||
        provider.providerInstanceId !== providerInstanceId ||
        provider.authMode !== codexRotatingAuthMode ||
        provider.secretName !== codexRotatingSecretName
      ) {
        throw new Error("codex_rotating_provider_identity_mismatch");
      }
      // Reject an ordinary W1 -> W2 mismatch before even the bounded row-lock
      // session settings run; the locked recheck below closes the read race.
      const prelockOrdinaryDatabaseRecoveryWitness =
        providerExisted && !input.recovery
          ? await assertCodexRotatingSetupRecoveryWitness(tx, {
              providerInstanceRowId: provider.id,
              ...(input.databaseRecoveryWitness !== undefined
                ? { configuredRecoveryWitness: input.databaseRecoveryWitness }
                : {}),
              forcedRecoveryAuthority: null,
            })
          : null;
      await lockCodexRotatingProviderRow(tx, provider.id);
      provider = await tx.codexOAuthProviderInstance.findUniqueOrThrow({
        where: { id: provider.id },
      });
      const quarantine = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "providerInstanceRowId" AS "id"
        FROM "CodexOAuthProviderIdentityQuarantine"
        WHERE "providerInstanceRowId" = ${provider.id}
          AND "resolvedAt" IS NULL
        LIMIT 1
      `;
      if (quarantine.length > 0) {
        throw new Error("codex_rotating_identity_quarantined");
      }
      const ordinaryDatabaseRecoveryWitness =
        prelockOrdinaryDatabaseRecoveryWitness !== null
          ? await assertCodexRotatingSetupRecoveryWitness(tx, {
              providerInstanceRowId: provider.id,
              ...(input.databaseRecoveryWitness !== undefined
                ? { configuredRecoveryWitness: input.databaseRecoveryWitness }
                : {}),
              forcedRecoveryAuthority: null,
            })
          : null;
      if (ordinaryDatabaseRecoveryWitness !== null) {
        await runAdmittedOperation();
      }
      const now = input.now ?? new Date();
      const activeCandidate = await findActiveSetupManifestForProvider(
        tx,
        provider.id,
      );
      // Match the state that the deferred expiry mutation will expose without
      // writing before forced-recovery witness admission.
      const active =
        activeCandidate?.status === CodexRotatingSetupManifestStatus.Issued &&
        activeCandidate.expiresAt <= now
          ? null
          : activeCandidate;
      const recoveryRequest = input.recovery
        ? await findSetupRecoveryRequest(
            tx,
            provider.id,
            input.recovery.requestId,
          )
        : null;
      const activeRecoveryRequest = await findActiveSetupRecoveryRequest(
        tx,
        provider.id,
      );
      const forcedRecoveryAuthority = evaluateSetupManifestRecoveryAuthority({
        recovery: input.recovery ?? null,
        provider,
        active,
        recoveryRequest,
        activeRecoveryRequest,
      });
      const databaseRecoveryWitness =
        ordinaryDatabaseRecoveryWitness ??
        (!providerExisted && !input.recovery
          ? configuredDatabaseRecoveryWitness
          : await assertCodexRotatingSetupRecoveryWitness(tx, {
              providerInstanceRowId: provider.id,
              ...(input.databaseRecoveryWitness !== undefined
                ? { configuredRecoveryWitness: input.databaseRecoveryWitness }
                : {}),
              forcedRecoveryAuthority,
            }));
      const blockingIntent = await tx.codexOAuthWritebackIntent.findFirst({
        where: {
          providerInstanceRowId: provider.id,
          OR: [
            { status: "pending" },
            {
              status: "remote_outcome_unknown",
              recoveryResolvedAt: null,
            },
          ],
        },
        select: { id: true },
      });
      if (
        blockingIntent ||
        (provider.mutationOwner === "runtime" &&
          provider.activeLeaseExpiresAt &&
          provider.activeLeaseExpiresAt > now)
      ) {
        throw new Error("codex_rotating_mutation_fence_conflict");
      }

      await runAdmittedOperation();
      await expireActiveSetupManifests(tx, provider.id, now);
      const allocationActive = await findActiveSetupManifestForProvider(
        tx,
        provider.id,
      );
      const repositoryIdentity =
        await lockAndAssertCurrentSetupRepositoryIdentity(tx, {
          repositoryId: input.repositoryId,
          workspaceId: input.workspaceId,
          repositoryFullName: input.repositoryFullName,
          repositoryDefaultBranch: input.repositoryDefaultBranch,
          githubRepositoryId: input.githubRepositoryId,
        });
      if (repositoryIdentity.boundAt > now) {
        throw new Error("codex_rotating_setup_repository_identity_changed");
      }
      const parsedActive = allocationActive
        ? codexRotatingSetupManifestSchema.safeParse(
            allocationActive.manifestJson,
          )
        : null;

      if (
        (parsedActive?.success &&
          parsedActive.data.runtimeMigration &&
          JSON.stringify(parsedActive.data.runtimeMigration) !==
            JSON.stringify(runtimeMigration)) ||
        (runtimeMigration &&
          allocationActive &&
          (!parsedActive?.success ||
            JSON.stringify(parsedActive.data.runtimeMigration) !==
              JSON.stringify(runtimeMigration)))
      ) {
        throw new Error("codex_runtime_migration_recovery_required");
      }
      if (runtimeMigration) {
        await assertOriginalCodexRuntimeMigrationSource({
          tx,
          providerInstanceRowId: provider.id,
          binding: runtimeMigration,
          githubRepositoryId: input.githubRepositoryId,
          stage: allocationActive ? "setup" : "before_setup",
        });
        await input.runtimeMigration!.assertDrained();
      }

      let manifest = parsedActive?.success ? parsedActive.data : null;
      let migrationDispatchAdmission: "fresh" | "readback_only" =
        "readback_only";
      if (
        allocationActive &&
        (!manifest ||
          allocationActive.mutationEpoch === null ||
          allocationActive.mutationEpoch !== provider.mutationEpoch ||
          provider.mutationOwner !== "setup" ||
          provider.mutationOwnerId !== allocationActive.id ||
          !isReusableIssuedManifest({
            manifest,
            provider,
            repositoryFullName: input.repositoryFullName,
            githubRepositoryId: input.githubRepositoryId,
            identityVersion: repositoryIdentity.version,
            installer: input.installer,
          }))
      ) {
        await supersedeSetupManifest(tx, allocationActive.id);
        manifest = null;
      }

      if (!manifest) {
        const setupNonce = `stp:${randomUUID()}`;
        const manifestId =
          runtimeMigration?.migrationId ?? `codex_setup_${randomUUID()}`;
        const mutationEpoch = provider.mutationEpoch + 1n;
        manifest = buildCodexRotatingSetupManifest({
          repositoryFullName: input.repositoryFullName,
          repositoryId: input.githubRepositoryId,
          repositoryIdentityVersion: repositoryIdentity.version,
          providerInstanceId,
          setupNonce,
          installerUrl: input.installer.url,
          installerVersion: input.installer.version,
          installerSha256: input.installer.sha256,
          now,
          ttlSeconds: setupManifestTtlSeconds,
          generationHashSalt: provider.generationHashSalt,
          accountFingerprintSalt: provider.accountFingerprintSalt,
          ...(runtimeMigration ? { runtimeMigration } : {}),
        });
        await tx.codexOAuthProviderInstance.update({
          where: { id: provider.id },
          data: {
            // A reseed can start from an active `ready` provider. Move the
            // provider into the setup lifecycle in the same fenced epoch so
            // confirmation can transition it to `workflow_update_required`.
            state: "setup_pending",
            mutationEpoch,
            mutationOwner: "setup",
            mutationOwnerId: manifestId,
          },
        });
        await tx.$executeRaw`
        INSERT INTO "CodexOAuthSetupManifest" (
          "id",
          "workspaceId",
          "repositoryId",
          "providerInstanceRowId",
          "providerInstanceId",
          "setupNonce",
          "manifestJson",
          "status",
          "expiresAt",
          "mutationEpoch",
          "databaseRecoveryWitness"
        )
        VALUES (
          ${manifestId},
          ${input.workspaceId},
          ${input.repositoryId},
          ${provider.id},
          ${providerInstanceId},
          ${setupNonce},
          CAST(${JSON.stringify(manifest)} AS jsonb),
          ${CodexRotatingSetupManifestStatus.Issued},
          ${new Date(manifest.expiresAt)},
          ${mutationEpoch},
          ${databaseRecoveryWitness}
        )
        `;
        migrationDispatchAdmission = "fresh";
        if (recoveryRequest) {
          await transitionRecoveryRequestToManifestIssued(tx, {
            recoveryRequestRowId: recoveryRequest.id,
            providerInstanceRowId: provider.id,
            recoveryRequestId: input.recovery!.requestId,
            recoveryEpoch: input.recovery!.epoch,
            databaseRecoveryWitness,
            manifestId,
            now,
          });
        }
      }

      const result = setupCommandResult({
        manifest,
        setupManifestUrl: input.setupManifestUrl,
        ...(input.setupPrepareUrl
          ? { setupPrepareUrl: input.setupPrepareUrl }
          : {}),
        ...(input.setupDispatchUrl
          ? { setupDispatchUrl: input.setupDispatchUrl }
          : {}),
        ...(input.setupDispatchOutcomeUrl
          ? { setupDispatchOutcomeUrl: input.setupDispatchOutcomeUrl }
          : {}),
        ...(input.setupStatusUrl
          ? { setupStatusUrl: input.setupStatusUrl }
          : {}),
        ...(input.installerArguments
          ? { installerArguments: input.installerArguments }
          : {}),
      });
      return runtimeMigration
        ? {
            ...result,
            runtimeMigration: {
              migrationId: runtimeMigration.migrationId,
              dispatchAdmission: migrationDispatchAdmission,
            },
          }
        : result;
    },
    { timeout: setupTransactionTimeoutMs },
  );
}

export async function lockAndAssertCurrentSetupRepositoryIdentity(
  tx: SetupManifestQueryClient,
  input: {
    readonly repositoryId: string;
    readonly workspaceId: string;
    readonly repositoryFullName: string;
    readonly repositoryDefaultBranch: string;
    readonly githubRepositoryId: string;
  },
): Promise<{ readonly version: number; readonly boundAt: Date }> {
  const locator = await tx.$queryRaw<
    readonly { readonly scmRepositoryIdentityId: string | null }[]
  >`
    SELECT repository."scmRepositoryIdentityId"
    FROM "RepositoryConnection" repository
    WHERE repository."id" = ${input.repositoryId}
  `;
  const scmRepositoryIdentityId = locator[0]?.scmRepositoryIdentityId;
  if (!scmRepositoryIdentityId) {
    throw new Error("codex_rotating_setup_repository_identity_changed");
  }
  const locked = await tx.$queryRaw<
    readonly { readonly version: number; readonly boundAt: Date }[]
  >`
    SELECT identity."version", identity."boundAt"
    FROM "ScmRepositoryIdentity" identity
    WHERE identity."scmRepositoryIdentityId" = ${scmRepositoryIdentityId}
    FOR UPDATE OF identity
  `;
  const lockedIdentity = locked[0];
  if (!lockedIdentity) {
    throw new Error("codex_rotating_setup_repository_identity_changed");
  }
  const current = await tx.$queryRaw<
    readonly { readonly version: number; readonly boundAt: Date }[]
  >`
    SELECT identity."version", identity."boundAt"
    FROM "RepositoryConnection" repository
    JOIN "GitHubInstallation" installation
      ON installation."id" = repository."installationId"
    JOIN "ScmRepositoryIdentity" identity
      ON identity."scmRepositoryIdentityId" = repository."scmRepositoryIdentityId"
    WHERE repository."id" = ${input.repositoryId}
      AND repository."workspaceId" = ${input.workspaceId}
      AND repository."provider" = 'github'
      AND repository."githubRepositoryId" = ${BigInt(input.githubRepositoryId)}
      AND repository."externalRepositoryId" = ${input.githubRepositoryId}
      AND repository."fullName" = ${input.repositoryFullName}
      AND repository."defaultBranch" = ${input.repositoryDefaultBranch}
      AND repository."selected" = true
      AND repository."archived" = false
      AND installation."workspaceId" = repository."workspaceId"
      AND installation."status" = 'active'
      AND identity."scmRepositoryIdentityId" = ${scmRepositoryIdentityId}
      AND identity."version" = ${lockedIdentity.version}
      AND identity."provider" = 'github'
      AND identity."normalizedSourceBaseUrl" = repository."sourceBaseUrl"
      AND identity."externalRepositoryId" = ${input.githubRepositoryId}
      AND identity."currentWorkspaceId" = repository."workspaceId"
      AND identity."currentRepositoryConnectionId" = repository."id"
      AND identity."boundAt" IS NOT NULL
      AND identity."unboundAt" IS NULL
  `;
  if (current.length !== 1 || !current[0]) {
    throw new Error("codex_rotating_setup_repository_identity_changed");
  }
  return current[0];
}

export async function transitionRecoveryRequestToManifestIssued(
  tx: SetupManifestTransaction,
  input: {
    readonly recoveryRequestRowId: string;
    readonly providerInstanceRowId: string;
    readonly recoveryRequestId: string;
    readonly recoveryEpoch: bigint;
    readonly databaseRecoveryWitness: string;
    readonly manifestId: string;
    readonly now: Date;
  },
): Promise<void> {
  const transitionedRecoveryRequest = await tx.$executeRaw`
    UPDATE "CodexOAuthSetupRecoveryRequest"
    SET "state" = 'manifest_issued', "latestManifestId" = ${input.manifestId},
        "updatedAt" = ${input.now}
    WHERE "id" = ${input.recoveryRequestRowId}
      AND "providerInstanceRowId" = ${input.providerInstanceRowId}
      AND "recoveryRequestId" = ${input.recoveryRequestId}
      AND "mutationEpoch" = ${input.recoveryEpoch}
      AND "databaseRecoveryWitness" = ${input.databaseRecoveryWitness}
      AND "state" = 'active'
      AND "latestManifestId" IS NULL
  `;
  if (transitionedRecoveryRequest !== 1) {
    throw new Error("codex_rotating_setup_recovery_transition_conflict");
  }
}

export async function resolveCodexRotatingSetupManifestForNonce(input: {
  readonly prisma: PrismaClient;
  readonly setupNonce: string;
  readonly databaseRecoveryWitness: string;
  readonly runtimeEnvironment?: NodeJS.ProcessEnv;
  readonly now?: Date;
  readonly authorizeRuntimeMigration?: (
    tx: SetupManifestTransaction,
    manifest: ReturnType<typeof codexRotatingSetupManifestSchema.parse>,
  ) => Promise<void>;
}): Promise<{
  readonly manifestBase64: string;
  readonly expiresAt: string;
  readonly recoveryExpiresAt: string;
  readonly payloadClaimed: boolean;
  readonly recoveryEpoch: string;
}> {
  return input.prisma.$transaction(
    async (tx) => {
      // Resolve only the provider identity before entering the common lock
      // order. Taking the manifest row lock here would invert issuance and
      // recovery (provider -> manifest) and can deadlock with a concurrent
      // fetch (manifest -> provider).
      const initial = await findSetupManifestLocatorByNonce(
        tx,
        input.setupNonce,
      );
      await lockCodexRotatingSetupProvider(tx, initial.providerInstanceId);
      await lockCodexRotatingProviderRow(tx, initial.providerInstanceRowId);
      const now = input.now ?? new Date();
      const row = await findSetupManifestByNonce(tx, input.setupNonce);
      assertSetupManifestRecoveryWitness(
        row.databaseRecoveryWitness,
        input.databaseRecoveryWitness,
      );
      const manifest = codexRotatingSetupManifestSchema.parse(row.manifestJson);
      if (manifest.runtimeMigration) {
        if (
          !input.authorizeRuntimeMigration ||
          new Date(manifest.expiresAt) <= now
        ) {
          throw new Error("codex_runtime_migration_oidc_required");
        }
        await assertOriginalCodexRuntimeMigrationSource({
          tx,
          providerInstanceRowId: row.providerInstanceRowId,
          binding: manifest.runtimeMigration,
          githubRepositoryId: manifest.repositoryId,
          stage: "setup",
        });
        await input.authorizeRuntimeMigration(tx, manifest);
      }
      await assertCurrentSetupManifestRepositoryIdentity(tx, {
        providerInstanceRowId: row.providerInstanceRowId,
        manifest,
      });
      if (
        !isCodexRotatingOAuthAllowedForRepository(
          manifest.repositoryFullName,
          input.runtimeEnvironment,
        )
      ) {
        throw new Error("codex_rotating_not_enabled");
      }
      if (row.status === CodexRotatingSetupManifestStatus.Consumed) {
        if (
          !row.consumedAt ||
          (row.payloadClaimedAt === null &&
            !(await hasVersionedPayloadClaim(tx, row.id))) ||
          !row.recoveryExpiresAt ||
          row.recoveryExpiresAt <= now
        ) {
          throw new Error("codex_rotating_setup_manifest_expired");
        }
        return {
          manifestBase64: encodeCodexRotatingSetupManifest(manifest),
          expiresAt: manifest.expiresAt,
          recoveryExpiresAt: row.recoveryExpiresAt.toISOString(),
          payloadClaimed: true,
          recoveryEpoch: row.mutationEpoch!.toString(),
        };
      }
      if (!(await isCodexRotatingSetupFenceOwner(tx, row))) {
        throw new Error("codex_rotating_setup_confirmation_stale_epoch");
      }

      if (row.status === CodexRotatingSetupManifestStatus.Fetched) {
        assertFetchedRecoveryWindow(row, now);
        // Delivery is retryable for the bounded recovery window. The durable
        // payload claim, not the manifest bytes, fences any later PUT.
        return {
          manifestBase64: encodeCodexRotatingSetupManifest(manifest),
          expiresAt: manifest.expiresAt,
          recoveryExpiresAt: row.recoveryExpiresAt!.toISOString(),
          payloadClaimed:
            row.payloadClaimedAt !== null ||
            (await hasVersionedPayloadClaim(tx, row.id)),
          recoveryEpoch: row.mutationEpoch!.toString(),
        };
      }

      assertSetupManifestFetchable(row, now);
      const recoveryExpiresAt = new Date(
        now.getTime() + setupFetchedRecoveryWindowMs,
      );

      const updated = await tx.$executeRaw`
      UPDATE "CodexOAuthSetupManifest"
      SET "status" = ${CodexRotatingSetupManifestStatus.Fetched},
          "lastFetchedAt" = ${now}
          , "recoveryExpiresAt" = ${recoveryExpiresAt}
      WHERE "id" = ${row.id}
        AND "status" = ${CodexRotatingSetupManifestStatus.Issued}
        AND "consumedAt" IS NULL
        AND "expiresAt" > ${now}
    `;
      if (updated !== 1) {
        throw new Error("codex_rotating_setup_manifest_reused");
      }

      return {
        manifestBase64: encodeCodexRotatingSetupManifest(manifest),
        expiresAt: manifest.expiresAt,
        recoveryExpiresAt: recoveryExpiresAt.toISOString(),
        payloadClaimed: false,
        recoveryEpoch: row.mutationEpoch!.toString(),
      };
    },
    { timeout: setupTransactionTimeoutMs },
  );
}

export function assertSetupManifestRecoveryWitness(
  persistedFingerprint: string | null,
  configuredRecoveryWitness: string,
): void {
  let currentFingerprint: string;
  try {
    currentFingerprint = fingerprintDatabaseRecoveryWitness(
      configuredRecoveryWitness,
    );
  } catch {
    throw new Error("codex_rotating_setup_recovery_required");
  }
  if (persistedFingerprint !== currentFingerprint) {
    throw new Error("codex_rotating_setup_recovery_required");
  }
}

export async function assertCurrentSetupManifestRepositoryIdentity(
  tx: SetupManifestQueryClient,
  input: {
    readonly providerInstanceRowId: string;
    readonly manifest: ReturnType<
      typeof codexRotatingSetupManifestSchema.parse
    >;
  },
): Promise<void> {
  const rows = await tx.$queryRaw<readonly { version: number }[]>`
    SELECT identity."version"
    FROM "CodexOAuthProviderInstance" provider
    JOIN "RepositoryConnection" repository
      ON repository."id" = provider."repositoryId"
    JOIN "GitHubInstallation" installation
      ON installation."id" = repository."installationId"
    JOIN "ScmRepositoryIdentity" identity
      ON identity."scmRepositoryIdentityId" = repository."scmRepositoryIdentityId"
    WHERE provider."id" = ${input.providerInstanceRowId}
      AND repository."workspaceId" = provider."workspaceId"
      AND repository."provider" = 'github'
      AND repository."fullName" = ${input.manifest.repositoryFullName}
      AND repository."externalRepositoryId" = ${input.manifest.repositoryId}
      AND repository."selected" = true
      AND repository."archived" = false
      AND installation."workspaceId" = repository."workspaceId"
      AND installation."status" = 'active'
      AND identity."provider" = 'github'
      AND identity."externalRepositoryId" = ${input.manifest.repositoryId}
      AND identity."currentWorkspaceId" = repository."workspaceId"
      AND identity."currentRepositoryConnectionId" = repository."id"
      AND identity."version" = ${input.manifest.repositoryIdentityVersion}
      AND identity."boundAt" IS NOT NULL
      AND identity."unboundAt" IS NULL
    FOR UPDATE OF identity
  `;
  if (rows.length !== 1) {
    throw new Error("codex_rotating_setup_repository_identity_changed");
  }
}

async function hasVersionedPayloadClaim(
  tx: SetupManifestTransaction,
  manifestId: string,
): Promise<boolean> {
  const rows = await tx.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM "CodexOAuthSetupPayloadClaim"
      WHERE "manifestId" = ${manifestId}
        AND "status" IN ('prepared','confirmed_candidate','active')
    ) AS "exists"
  `;
  return rows[0]?.exists === true;
}

export function confirmCodexRotatingSetupManifest(input: {
  readonly prisma: PrismaClient;
  readonly payload: unknown;
  readonly now?: Date;
}): Promise<never> {
  void input;
  return Promise.reject(
    new Error("codex_rotating_legacy_stable_secret_removed"),
  );
}
async function findSetupManifestByNonce(
  prisma: Prisma.TransactionClient | PrismaClient,
  setupNonce: string,
): Promise<SetupManifestRow> {
  assertSetupNonce(setupNonce);
  const rows = await prisma.$queryRaw<SetupManifestRow[]>`
    SELECT
      "id",
      "providerInstanceRowId",
      "providerInstanceId",
      "repositoryId",
      "setupNonce",
      "manifestJson",
      "status",
      "expiresAt",
      "consumedAt",
      "confirmationJson",
      "mutationEpoch", "databaseRecoveryWitness", "recoveryExpiresAt", "payloadVersion",
      "payloadGenerationHash", "payloadAccountFingerprint", "payloadByteSize",
      "payloadClaimedAt"
    FROM "CodexOAuthSetupManifest"
    WHERE "setupNonce" = ${setupNonce}
    LIMIT 1 FOR UPDATE
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("codex_rotating_setup_manifest_not_found");
  }
  return row;
}

async function findSetupManifestLocatorByNonce(
  prisma: Prisma.TransactionClient | PrismaClient,
  setupNonce: string,
): Promise<
  Pick<SetupManifestRow, "providerInstanceRowId" | "providerInstanceId">
> {
  assertSetupNonce(setupNonce);
  const rows = await prisma.$queryRaw<
    Array<
      Pick<SetupManifestRow, "providerInstanceRowId" | "providerInstanceId">
    >
  >`
    SELECT "providerInstanceRowId", "providerInstanceId"
    FROM "CodexOAuthSetupManifest"
    WHERE "setupNonce" = ${setupNonce}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new Error("codex_rotating_setup_manifest_not_found");
  }
  return row;
}

function assertSetupNonce(setupNonce: string): void {
  if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(setupNonce)) {
    throw new Error("codex_rotating_setup_manifest_not_found");
  }
}

async function findSetupRecoveryRequest(
  tx: SetupManifestTransaction,
  providerInstanceRowId: string,
  recoveryRequestId: string,
): Promise<SetupRecoveryRequestFacts | null> {
  const rows = await tx.$queryRaw<SetupRecoveryRequestFacts[]>`
    SELECT "id", "mutationEpoch", "databaseRecoveryWitness", "mode", "state", "latestManifestId"
    FROM "CodexOAuthSetupRecoveryRequest"
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "recoveryRequestId" = ${recoveryRequestId}
    LIMIT 1 FOR UPDATE
  `;
  return rows[0] ?? null;
}

async function findActiveSetupRecoveryRequest(
  tx: SetupManifestTransaction,
  providerInstanceRowId: string,
): Promise<{ readonly id: string } | null> {
  const rows = await tx.$queryRaw<Array<{ readonly id: string }>>`
    SELECT "id" FROM "CodexOAuthSetupRecoveryRequest"
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "state" IN ('active', 'manifest_issued')
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function expireActiveSetupManifests(
  prisma: SetupManifestTransaction,
  providerInstanceRowId: string,
  now: Date,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "CodexOAuthSetupManifest"
    SET "status" = ${CodexRotatingSetupManifestStatus.Expired}
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "status" = ${CodexRotatingSetupManifestStatus.Issued}
      AND "expiresAt" <= ${now}
  `;
}

async function findActiveSetupManifestForProvider(
  prisma: SetupManifestTransaction,
  providerInstanceRowId: string,
): Promise<SetupManifestRow | null> {
  const rows = await prisma.$queryRaw<SetupManifestRow[]>`
    SELECT
      "id",
      "providerInstanceRowId",
      "providerInstanceId",
      "repositoryId",
      "setupNonce",
      "manifestJson",
      "status",
      "expiresAt",
      "consumedAt",
      "confirmationJson",
      "mutationEpoch", "databaseRecoveryWitness", "recoveryExpiresAt", "payloadVersion",
      "payloadGenerationHash", "payloadAccountFingerprint", "payloadByteSize",
      "payloadClaimedAt"
    FROM "CodexOAuthSetupManifest"
    WHERE "providerInstanceRowId" = ${providerInstanceRowId}
      AND "status" IN (
        ${CodexRotatingSetupManifestStatus.Issued},
        ${CodexRotatingSetupManifestStatus.Fetched}
      )
    ORDER BY "createdAt" DESC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function supersedeSetupManifest(
  prisma: SetupManifestTransaction,
  id: string,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "CodexOAuthSetupManifest"
    SET "status" = ${CodexRotatingSetupManifestStatus.Superseded}
    WHERE "id" = ${id}
      AND "status" = ${CodexRotatingSetupManifestStatus.Issued}
  `;
}

function setupCommandResult(input: {
  readonly manifest: ReturnType<typeof codexRotatingSetupManifestSchema.parse>;
  readonly setupManifestUrl: string;
  readonly setupPrepareUrl?: string;
  readonly setupDispatchUrl?: string;
  readonly setupDispatchOutcomeUrl?: string;
  readonly setupStatusUrl?: string;
  readonly installerArguments?: readonly CodexRotatingInstallerArgument[];
}) {
  return {
    command: renderCodexRotatingInstallerCommand({
      manifest: input.manifest,
      setupManifestUrl: input.setupManifestUrl,
      ...(input.setupPrepareUrl
        ? { setupPrepareUrl: input.setupPrepareUrl }
        : {}),
      ...(input.setupDispatchUrl
        ? { setupDispatchUrl: input.setupDispatchUrl }
        : {}),
      ...(input.setupDispatchOutcomeUrl
        ? { setupDispatchOutcomeUrl: input.setupDispatchOutcomeUrl }
        : {}),
      ...(input.setupStatusUrl ? { setupStatusUrl: input.setupStatusUrl } : {}),
      ...(input.installerArguments
        ? { installerArguments: input.installerArguments }
        : {}),
    }),
    expiresAt: input.manifest.expiresAt,
    providerInstanceId: input.manifest.providerInstanceId,
  } as const;
}
