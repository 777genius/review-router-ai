import { createHmac, generateKeyPairSync, randomUUID, sign } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import {
  codexRotatingSetupManifestSchema,
  codexRotatingSetupPayloadClaimSchema,
  codexRuntimeMigrationAudience,
  codexRuntimeMigrationDispatchKey,
  codexRuntimeMigrationReusableWorkflowPath,
  codexRuntimeMigrationWorkflowPath,
} from "@reviewrouter/features-provider-setup";
import {
  createVersionedProviderSecretNamespace,
  CodexRotatingReviewActionV2Mode,
  renderCodexRotatingAdvisoryWorkflow,
  workflowDocumentSemanticSha256,
} from "@reviewrouter/features-workflow-provisioning";
import { JoseGitHubActionsOidcTokenVerifier } from "@reviewrouter/features-action-control-plane/oidc";
import {
  issueCodexRotatingSetupCommand,
  resolveCodexRotatingSetupManifestForNonce,
} from "./codex-rotating-setup-manifest";
import { PrismaCodexRotatingSetupPayloadClaim } from "./prisma-codex-rotating-setup-payload-claim";
import { exchangeCodexRuntimeMigration } from "./codex-runtime-migration-exchange";
import { completeCodexRuntimeMigrationActivation } from "./codex-runtime-migration-activation";
import {
  readPendingCodexRuntimeMigration,
  readCodexRuntimeMigrationCandidateActionRef,
} from "./codex-runtime-migration-setup";
import {
  codexRuntimeMigrationFixture,
  blob,
  digest,
} from "./test-support/codex-runtime-migration-fixture";

const githubFactory = vi.hoisted(() => vi.fn());
// Only construction/authentication of the external GitHub client is synthetic.
// Its exact source/disabled-state adapter and the native SQL effects remain real.
vi.mock("./codex-runtime-migration-composition", async (original) => ({
  ...(await original<typeof import("./codex-runtime-migration-composition")>()),
  createCodexRuntimeMigrationGitHub: githubFactory,
}));

const databaseUrl = process.env.REVIEW_ROUTER_MIGRATION_TEST_DATABASE_URL;
const databaseSuite = databaseUrl ? describe : describe.skip;
const witness = "synthetic-runtime-migration-recovery-witness-2026";

databaseSuite(
  "runtime migration: signed OIDC + real existing PostgreSQL setup ledger",
  () => {
    let prisma: PrismaClient;
    let authority: PrismaClient;
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const oidc = new JoseGitHubActionsOidcTokenVerifier({
      jwks: async () => keys.publicKey,
    });
    beforeAll(async () => {
      if (
        !databaseUrl ||
        !new URL(databaseUrl).pathname.endsWith(
          "/reviewrouter_hosted_model_test",
        )
      ) {
        throw new Error("migration_fixture_requires_disposable_database");
      }
      prisma = createPrismaClient({ databaseUrl });
      authority = createPrismaClient({ databaseUrl });
      vi.stubEnv("REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED", "1");
      vi.stubEnv("REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH", "1");
      vi.stubEnv(
        "REVIEW_ROUTER_CODEX_ROTATING_OAUTH_REPOSITORIES",
        "777genius/review-router-saas-e2e",
      );
    });
    afterAll(async () => {
      // Native setup/effect rows are immutable evidence; the disposable DB owns cleanup.
      await Promise.all([prisma?.$disconnect(), authority?.$disconnect()]);
      vi.unstubAllEnvs();
    });

    it.each(["confirmed", "unknown", "concurrent"] as const)(
      "two trusted bootstrap runners preserve one setup effect (%s)",
      async (outcome) => {
        const suffix = randomUUID();
        const repositoryId = `runtime-migration-repo-${suffix}`;
        const workspaceId = `runtime-migration-workspace-${suffix}`;
        const githubRepositoryId = String(
          Date.now() + Math.floor(Math.random() * 100_000),
        );
        let f = codexRuntimeMigrationFixture({
          repositoryId: githubRepositoryId,
        });
        const installationId = `runtime-migration-installation-${suffix}`;
        await prisma.workspace.create({
          data: {
            id: workspaceId,
            slug: `runtime-migration-${suffix}`,
            name: "Synthetic runtime migration",
          },
        });
        await prisma.gitHubInstallation.create({
          data: {
            id: installationId,
            workspaceId,
            githubInstallationId: BigInt(githubRepositoryId),
            accountLogin: "777genius",
            accountType: "Organization",
            repositorySelection: "selected",
            status: "active",
          },
        });
        await prisma.repositoryConnection.create({
          data: {
            id: repositoryId,
            workspaceId,
            provider: "github",
            externalRepositoryId: githubRepositoryId,
            githubRepositoryId: BigInt(githubRepositoryId),
            installationId,
            owner: "777genius",
            name: "review-router-saas-e2e",
            fullName: f.repositoryFullName,
            defaultBranch: "main",
            visibility: "private",
            selected: true,
          },
        });
        const identityId = `runtime-migration-identity-${suffix}`;
        await prisma.$transaction(async (tx) => {
          await tx.scmRepositoryIdentity.create({
            data: {
              scmRepositoryIdentityId: identityId,
              provider: "github",
              normalizedSourceBaseUrl: "https://github.com",
              externalRepositoryId: githubRepositoryId,
              currentWorkspaceId: workspaceId,
              currentRepositoryConnectionId: repositoryId,
              createdAt: new Date("2026-01-01T00:00:00Z"),
              boundAt: new Date("2026-01-01T00:00:00Z"),
            },
          });
          await tx.repositoryConnection.update({
            where: { id: repositoryId },
            data: { scmRepositoryIdentityId: identityId },
          });
        });
        const installer = {
          url: `https://raw.githubusercontent.com/777genius/review-router/${"b".repeat(40)}/scripts/seed-codex-rotating-auth.sh`,
          version: "synthetic-migration-v1",
          sha256: "a".repeat(64),
        };
        const issueInput = {
          prisma,
          workspaceId,
          repositoryId,
          repositoryFullName: f.repositoryFullName,
          repositoryDefaultBranch: "main",
          githubRepositoryId,
          installer,
          databaseRecoveryWitness: witness,
          setupManifestUrl: `${f.setupBaseUrl}/api/codex-rotating/setup-manifest`,
        };
        await issueCodexRotatingSetupCommand(issueInput);
        const originalRow =
          await prisma.codexOAuthSetupManifest.findFirstOrThrow({
            where: { repositoryId },
            orderBy: { createdAt: "desc" },
          });
        const originalDelivery =
          await resolveCodexRotatingSetupManifestForNonce({
            prisma,
            setupNonce: originalRow.setupNonce,
            databaseRecoveryWitness: witness,
          });
        const originalManifest = codexRotatingSetupManifestSchema.parse(
          JSON.parse(
            Buffer.from(
              originalDelivery.manifestBase64,
              "base64url",
            ).toString(),
          ),
        );
        const syntheticAuth = JSON.stringify({
          auth_mode: "chatgpt",
          tokens: {
            access_token: "synthetic-access",
            refresh_token: "synthetic-refresh",
            id_token: "synthetic-id",
            account_id: "synthetic-account",
          },
        });
        const generationHash = createHmac(
          "sha256",
          Buffer.from(originalManifest.generationHashSalt, "base64url"),
        )
          .update(syntheticAuth)
          .digest("base64url");
        const accountIdentityHash = createHmac(
          "sha256",
          Buffer.from(originalManifest.accountFingerprintSalt, "base64url"),
        )
          .update(
            JSON.stringify({
              issuer: "synthetic",
              subject: "synthetic-user",
              chatgptAccountId: "synthetic-account",
            }),
          )
          .digest("base64url");
        const payload = {
          payloadVersion: 2 as const,
          canonicalizationVersion: 1 as const,
          operationId: `original:${suffix}`,
          repositoryId: githubRepositoryId,
          providerInstanceId: f.providerInstanceId,
          setupNonce: originalManifest.setupNonce,
          manifestDigest: digest(JSON.stringify(originalManifest)),
          recoveryEpoch: originalDelivery.recoveryEpoch,
          generationHash,
          accountIdentityHash,
          accountIdentityAlgorithm:
            "provider_issuer_subject_account_v1" as const,
          authByteSize: Buffer.byteLength(syntheticAuth),
          installerVersion: installer.version,
          installerDigest: installer.sha256,
        };
        const ledger = new PrismaCodexRotatingSetupPayloadClaim(
          prisma,
          witness,
          undefined,
          process.env,
          authority,
        );
        const originalClaim = await ledger.claim(payload);
        await ledger.authorizeDispatch(
          {
            claimId: originalClaim.claimId,
            idempotencyKey: `original:${suffix}`,
          },
          async () => ({ statusCode: 204 }),
        );
        const originalAttempt = (await ledger.status(originalClaim.claimId))
          .attempt!;
        const namespace = createVersionedProviderSecretNamespace({
          scope: {
            repositoryId: githubRepositoryId,
            providerInstanceId: f.providerInstanceId,
          },
          namespaceId: originalAttempt.namespaceId,
          epoch: originalAttempt.namespaceEpoch,
          name: originalAttempt.secretName,
        });
        f = codexRuntimeMigrationFixture({
          repositoryId: githubRepositoryId,
          namespace,
        });
        const originalSource = f.renderReview();
        await ledger.activate({
          claimId: originalClaim.claimId,
          attemptId: originalAttempt.attemptId,
          namespaceId: namespace.namespaceId,
          namespaceEpoch: namespace.epoch.toString(),
          secretName: namespace.name,
          repositoryId: githubRepositoryId,
          repositoryFullName: f.repositoryFullName,
          workflowPath: f.source.workflowPath,
          workflowSourceCommitSha: f.source.workflowSourceCommitSha,
          workflowSourceBlobSha: blob(originalSource),
          workflowSourceSha256: digest(originalSource),
          workflowSemanticSha256:
            workflowDocumentSemanticSha256(originalSource),
          sourceTrust: "trusted_default_branch_revision",
          workflowSchemaVersion: 5,
        });
        const provider =
          await prisma.codexOAuthProviderInstance.findUniqueOrThrow({
            where: { providerInstanceId: f.providerInstanceId },
          });
        Object.assign(f.source, {
          mutationEpoch: provider.mutationEpoch.toString(),
          generation: provider.latestGeneration,
          generationHash,
          accountIdentityHash,
          generationHashSalt: provider.generationHashSalt,
          accountFingerprintSalt: provider.accountFingerprintSalt,
          workflowSemanticSha256:
            workflowDocumentSemanticSha256(originalSource),
        });
        // Each fixture receives a distinct nonauthorizing migration ID.
        const binding = await f.github.captureBinding({
          migrationId: `codex_migration_${suffix}`,
          source: f.source,
          targetActionRef: f.targetActionRef,
          defaultBranch: "main",
        });
        await f.github.disableIngress(binding);
        const allocated = await issueCodexRotatingSetupCommand({
          ...issueInput,
          runtimeMigration: {
            binding,
            assertDrained: () => f.github.assertDrained(binding),
          },
        });
        expect(allocated.runtimeMigration?.dispatchAdmission).toBe("fresh");
        const replay = await issueCodexRotatingSetupCommand({
          ...issueInput,
          runtimeMigration: {
            binding,
            assertDrained: () => f.github.assertDrained(binding),
          },
        });
        expect(replay.runtimeMigration?.dispatchAdmission).toBe(
          "readback_only",
        );
        const migrationRow =
          await prisma.codexOAuthSetupManifest.findUniqueOrThrow({
            where: { id: binding.migrationId },
          });
        await expect(
          resolveCodexRotatingSetupManifestForNonce({
            prisma,
            setupNonce: migrationRow.setupNonce,
            databaseRecoveryWitness: witness,
          }),
        ).rejects.toThrow("oidc_required");
        const targetQualified = vi.fn().mockResolvedValue(undefined);
        const exchange = async (runId: number) => {
          f.runs.get(200)!.push({
            ...f.bootstrapRun(runId),
            display_title: `ReviewRouter runtime migration ${binding.migrationId}`,
          });
          const ref = "refs/heads/main";
          const now = Math.floor(Date.now() / 1000);
          const claims = {
            iss: "https://token.actions.githubusercontent.com",
            aud: codexRuntimeMigrationAudience,
            sub: `repo:${f.repositoryFullName}:ref:${ref}`,
            repository: f.repositoryFullName,
            repository_id: githubRepositoryId,
            repository_owner: "777genius",
            event_name: "workflow_dispatch",
            ref,
            run_id: String(runId),
            run_attempt: "1",
            actor: "fixture",
            runner_environment: "github-hosted",
            workflow_sha: f.head,
            workflow_ref: `${f.repositoryFullName}/${codexRuntimeMigrationWorkflowPath}@${ref}`,
            job_workflow_ref: `${codexRuntimeMigrationReusableWorkflowPath}@${"b".repeat(40)}`,
            job_workflow_sha: "b".repeat(40),
            iat: now,
            exp: now + 300,
          };
          const unsigned = `${Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}`;
          const oidcToken = `${unsigned}.${sign("sha256", Buffer.from(unsigned), keys.privateKey).toString("base64url")}`;
          return exchangeCodexRuntimeMigration({
            prisma,
            migrationId: binding.migrationId,
            oidcToken,
            oidc,
            setupBaseUrl: f.setupBaseUrl,
            databaseRecoveryWitness: witness,
            runtimeEnvironment: process.env,
            assertTargetQualified: targetQualified,
            github: async () => ({
              migration: f.github,
              publicKey: async () => ({
                keyId: "synthetic-key",
                key: Buffer.alloc(32, 1).toString("base64"),
              }),
            }),
          });
        };
        const deliveries = await Promise.all([exchange(501), exchange(502)]);
        expect(deliveries[0]!.manifestBase64).toBe(
          deliveries[1]!.manifestBase64,
        );
        expect(targetQualified).toHaveBeenCalledTimes(2);
        const manifest = codexRotatingSetupManifestSchema.parse(
          JSON.parse(
            Buffer.from(deliveries[0]!.manifestBase64, "base64url").toString(),
          ),
        );
        const migrationPayload = codexRotatingSetupPayloadClaimSchema.parse({
          ...payload,
          operationId: binding.migrationId,
          setupNonce: manifest.setupNonce,
          recoveryEpoch: deliveries[0]!.recoveryEpoch,
          manifestDigest: digest(JSON.stringify(manifest)),
          runtimeMigrationSource: {
            namespaceId: namespace.namespaceId,
            namespaceEpoch: namespace.epoch.toString(),
            canonicalizationVersion: 1,
            generationHash,
            accountIdentityHash,
          },
        });
        await expect(
          ledger.claim({ ...migrationPayload, generationHash: "x".repeat(43) }),
        ).rejects.toThrow("source_mismatch");
        const claims = await Promise.all([
          ledger.claim(migrationPayload),
          ledger.claim(structuredClone(migrationPayload)),
        ]);
        expect(claims[0]!.claimId).toBe(claims[1]!.claimId);
        const dispatch = {
          claimId: claims[0]!.claimId,
          idempotencyKey: codexRuntimeMigrationDispatchKey(binding.migrationId),
        };
        let puts = 0;
        const put = async () => {
          puts += 1;
          if (outcome === "unknown")
            throw new Error("synthetic lost PUT acknowledgement");
          return { statusCode: 204 as const };
        };
        if (outcome === "concurrent") {
          await Promise.allSettled([
            ledger.authorizeDispatch(dispatch, put),
            ledger.authorizeDispatch(dispatch, put),
          ]);
        } else {
          const firstDispatch = ledger.authorizeDispatch(dispatch, put);
          if (outcome === "confirmed")
            await expect(firstDispatch).resolves.toMatchObject({
              status: "confirmed",
            });
          else await expect(firstDispatch).rejects.toThrow("secret_put_failed");
        }
        await ledger.authorizeDispatch(dispatch, put).catch(() => undefined);
        await expect(
          ledger.authorizeDispatch(
            { ...dispatch, idempotencyKey: `fresh:${suffix}` },
            put,
          ),
        ).rejects.toThrow("recovery_required");
        if (outcome === "concurrent") expect(puts).toBeLessThanOrEqual(1);
        else expect(puts).toBe(1);
        expect(
          await prisma.codexOAuthSetupPayloadClaim.count({
            where: { manifestId: binding.migrationId },
          }),
        ).toBe(1);
        expect(
          await prisma.codexOAuthSetupDispatchAttempt.count({
            where: { claimId: dispatch.claimId },
          }),
        ).toBe(1);
        const finalAttempt = (await ledger.status(dispatch.claimId)).attempt!;
        if (finalAttempt.status === "confirmed") {
          expect(
            await readPendingCodexRuntimeMigration({
              prisma,
              providerInstanceId: f.providerInstanceId,
            }),
          ).toBeNull();
          expect(
            await readCodexRuntimeMigrationCandidateActionRef({
              prisma,
              namespaceId: finalAttempt.namespaceId,
              trustedActionRefs: [
                f.source.actionRef,
                f.targetActionRef,
                `777genius/review-router@${"c".repeat(40)}`,
              ],
            }),
          ).toBe(f.targetActionRef);
          await expect(
            readCodexRuntimeMigrationCandidateActionRef({
              prisma,
              namespaceId: finalAttempt.namespaceId,
              trustedActionRefs: [
                f.source.actionRef,
                `777genius/review-router@${"c".repeat(40)}`,
              ],
            }),
          ).rejects.toThrow("target_unavailable");
        } else {
          expect(
            (
              await readPendingCodexRuntimeMigration({
                prisma,
                providerInstanceId: f.providerInstanceId,
              })
            )?.migrationId,
          ).toBe(binding.migrationId);
        }
        expect(
          (
            await prisma.codexOAuthProviderInstance.findUniqueOrThrow({
              where: { id: provider.id },
            })
          ).activeSecretNamespaceId,
        ).toBe(namespace.namespaceId);
        expect(
          (
            await prisma.codexOAuthSecretNamespace.findUniqueOrThrow({
              where: { id: namespace.namespaceId },
            })
          ).permanentlyRetired,
        ).toBe(false);
        if (outcome === "confirmed") {
          const targetNamespace = createVersionedProviderSecretNamespace({
            scope: {
              repositoryId: githubRepositoryId,
              providerInstanceId: f.providerInstanceId,
            },
            namespaceId: finalAttempt.namespaceId,
            epoch: finalAttempt.namespaceEpoch,
            name: finalAttempt.secretName,
          });
          const finalSource = renderCodexRotatingAdvisoryWorkflow({
            actionRef: f.targetActionRef,
            apiUrl: f.apiUrl,
            providerInstanceId: f.providerInstanceId,
            workflowSchemaVersion: 5,
            reviewActionV2Mode: CodexRotatingReviewActionV2Mode.T0,
            activeSecretNamespace: targetNamespace,
          });
          f.faults.changedHead = true;
          f.files.set(f.source.workflowPath, finalSource);
          await ledger.activate({
            claimId: dispatch.claimId,
            attemptId: finalAttempt.attemptId,
            namespaceId: targetNamespace.namespaceId,
            namespaceEpoch: targetNamespace.epoch.toString(),
            secretName: targetNamespace.name,
            repositoryId: githubRepositoryId,
            repositoryFullName: f.repositoryFullName,
            workflowPath: f.source.workflowPath,
            workflowSourceCommitSha: "f".repeat(40),
            workflowSourceBlobSha: blob(finalSource),
            workflowSourceSha256: digest(finalSource),
            workflowSemanticSha256: workflowDocumentSemanticSha256(finalSource),
            sourceTrust: "trusted_default_branch_revision",
            workflowSchemaVersion: 5,
          });
          githubFactory.mockResolvedValue({ migration: f.github });
          const activation = {
            prisma,
            claimId: dispatch.claimId,
            namespaceId: targetNamespace.namespaceId,
            expectedApiUrl: f.apiUrl,
          };
          await expect(
            completeCodexRuntimeMigrationActivation(activation),
          ).rejects.toThrow("bootstrap_cleanup_required");
          expect(
            f.workflows.find((workflow) => workflow.id === 100)?.state,
          ).toBe("disabled_manually");
          f.files.delete(codexRuntimeMigrationWorkflowPath);
          f.faults.loseEnableAck = true;
          await completeCodexRuntimeMigrationActivation(activation);
          await completeCodexRuntimeMigrationActivation(activation);
          expect(
            f.writes.filter((write) => write.path.endsWith("/enable")),
          ).toHaveLength(1);
          expect(
            f.workflows.find((workflow) => workflow.id === 100)?.state,
          ).toBe("active");
          expect(
            (
              await prisma.codexOAuthProviderInstance.findUniqueOrThrow({
                where: { id: provider.id },
              })
            ).activeSecretNamespaceId,
          ).toBe(targetNamespace.namespaceId);
          expect(
            (
              await prisma.codexOAuthSecretNamespace.findUniqueOrThrow({
                where: { id: namespace.namespaceId },
              })
            ).permanentlyRetired,
          ).toBe(true);
          expect(
            (
              await prisma.codexOAuthSetupManifest.findUniqueOrThrow({
                where: { id: binding.migrationId },
              })
            ).status,
          ).toBe("consumed");
        }
      },
      30_000,
    );
  },
);
