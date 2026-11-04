import { lockCodexRotatingCurrentProvider } from "../packages/features/action-control-plane/src/infrastructure/prisma/codex-rotating-current-provider";
import {
  createVersionedSecretWorkflowSourceAttestation,
  WorkflowSourceTrust,
} from "../packages/features/codex-oauth-rotating/src/index";
import { PrismaCodexRotatingOAuthRepository } from "../packages/features/action-control-plane/src/infrastructure/prisma/prisma-codex-rotating-oauth-repository";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveCodexRotatingSetupManifestForNonce } from "../packages/features/provider-setup/src/composition/index";
import { PrismaCodexRotatingSetupPayloadClaim } from "../packages/features/provider-setup/src/composition/index";
import { codexRotatingSetupManifestSchema } from "../packages/features/provider-setup/src/index";
import { issueCodexRotatingSetupCommand } from "../packages/features/provider-setup/src/composition/index";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { managedPg17Fixture } from "./lib/render-managed-pg17-fixture";
import {
  readRenderManagedCheckoutInventory,
  readRenderSchemaHandoffCatalog,
} from "./lib/render-schema-handoff-policy.mjs";
import { readLockedCodexRotatingCurrentProvider } from "../packages/features/action-control-plane/src/infrastructure/prisma/codex-rotating-current-provider";
// Root-only opt-in; authentic local source catalog and offline managed PG image.
describe.skipIf(process.env.REVIEW_ROUTER_RUN_LOCKED_PROVIDER_PG17 !== "1")(
  "Locked provider actual Prisma transaction / PG17",
  () => {
    const pg = managedPg17Fixture();
    const database = "locked_provider_test";
    const clients: PrismaClient[] = [];
    let reader: PrismaClient;
    let writer: PrismaClient;
    let observer: PrismaClient;
    function client(name: string) {
      const result = new PrismaClient({
        adapter: new PrismaPg({
          user: "reviewrouter",
          database,
          host: "127.0.0.1",
          port: 5432,
          ssl: false,
          max: 2,
          application_name: name,
          connectionTimeoutMillis: 5000,
          stream: () => {
            const stream = pg.wireStream();
            return Object.assign(stream, {
              ref: () => stream,
              unref: () => stream,
            });
          },
        }),
        transactionOptions: {
          timeout: 20000,
          maxWait: 5000,
          isolationLevel: "ReadCommitted",
        },
      });
      clients.push(result);
      return result;
    }
    async function seedProvider(prefix: string, githubRepositoryId: number) {
      const workspaceId = `${prefix}-ws`;
      const repositoryId = `${prefix}-repo`;
      const installationId = `${prefix}-installation`;
      const identityId = `${prefix}-identity`;
      await reader.workspace.create({
        data: {
          id: workspaceId,
          slug: workspaceId,
          name: "Disposable provider",
        },
      });
      await reader.gitHubInstallation.create({
        data: {
          id: installationId,
          workspaceId,
          githubInstallationId: BigInt(githubRepositoryId),
          accountLogin: "local",
          accountType: "Organization",
          repositorySelection: "selected",
          status: "active",
        },
      });
      await reader.scmRepositoryIdentity.create({
        data: {
          scmRepositoryIdentityId: identityId,
          provider: "github",
          normalizedSourceBaseUrl: "https://github.com",
          externalRepositoryId: String(githubRepositoryId),
          currentWorkspaceId: null,
          currentRepositoryConnectionId: null,
          createdAt: new Date(),
          boundAt: null,
        },
      });
      await reader.$executeRaw`INSERT INTO "RepositoryConnection"
        ("id","workspaceId","provider","sourceBaseUrl","externalRepositoryId","scmRepositoryIdentityId","installationId","githubRepositoryId","owner","name","fullName","defaultBranch","visibility","selected","archived","updatedAt")
        VALUES (${repositoryId},${workspaceId},'github','https://github.com',${String(githubRepositoryId)},${identityId},${installationId},${githubRepositoryId},'local','proof','local/proof','main','private',true,false,now())`;
      await reader.scmRepositoryIdentity.update({
        where: { scmRepositoryIdentityId: identityId },
        data: {
          currentWorkspaceId: workspaceId,
          currentRepositoryConnectionId: repositoryId,
          boundAt: new Date(),
        },
      });
      await reader.codexOAuthProviderInstance.create({
        data: {
          id: `${prefix}-row`,
          workspaceId: `${prefix}-ws`,
          repositoryId: `${prefix}-repo`,
          providerInstanceId: `codex-rotating:${githubRepositoryId}`,
          authMode: "codex_subscription_oauth_rotating",
          secretName: "REVIEWROUTER_CODEX_AUTH_JSON",
          state: "setup_pending",
          generationHashSalt: "disposable-salt",
          accountFingerprintSalt: "disposable-salt",
        },
      });
    }
    beforeAll(async () => {
      await pg.start();
      pg.query(
        "postgres",
        `CREATE ROLE reviewrouter LOGIN; CREATE DATABASE ${database} OWNER reviewrouter;`,
        "postgres",
      );
      const catalog = readRenderSchemaHandoffCatalog();
      const checkout = readRenderManagedCheckoutInventory();
      expect(catalog.length).toBeGreaterThan(0);
      expect(checkout.slice(0, catalog.length)).toEqual(catalog);
      const applied = await pg.apply(
        database,
        catalog.length,
        "provider-root-current-scope",
      ).result;
      expect(applied).toEqual(catalog.map((entry) => entry.migrationName));
      const setupTableOwners = () =>
        pg.query(
          database,
          `SELECT c.relname || ':' || pg_catalog.pg_get_userbyid(c.relowner)
           FROM pg_catalog.pg_class c
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'r'
             AND (c.relname LIKE 'CodexOAuth%'
                  OR c.relname IN ('Workspace', 'GitHubInstallation',
                                   'RepositoryConnection', 'ScmRepositoryIdentity'))
           ORDER BY c.relname`,
          "postgres",
        );
      const originalSetupOwners = setupTableOwners();
      expect(originalSetupOwners).toContain(
        "CodexOAuthSetupManifest:reviewrouter",
      );
      expect(
        originalSetupOwners
          .split("\n")
          .every((owner) => owner.endsWith(":reviewrouter")),
      ).toBe(true);
      // This exercises current Prisma source, not a historical upgrade. Keep
      // the managed schema and setup table owners, then apply verified checkout
      // additions as the disposable administrator their role bootstrap needs.
      // Runtime clients retain the original non-superuser reviewrouter identity.
      // The unchanged cutover guard also requires this writer to be quiesced.
      // Its migration engine has exited; keep login closed until schema checks
      // pass, and let afterAll remove the contained database if bootstrap fails.
      pg.query(database, "ALTER ROLE reviewrouter NOLOGIN", "postgres");
      expect(
        pg.query(
          database,
          `SELECT count(*) FROM pg_catalog.pg_stat_activity
           WHERE datname = current_database() AND pid <> pg_backend_pid()
             AND backend_type = 'client backend'`,
          "postgres",
        ),
      ).toBe("0");
      const extensions = checkout.slice(catalog.length);
      expect(extensions.length).toBeGreaterThan(0);
      const appliedExtensions: string[] = [];
      for (const entry of extensions) {
        const source = readFileSync(
          new URL(
            `../packages/platform/db/prisma/migrations/${entry.migrationName}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        );
        expect(createHash("sha256").update(source).digest("hex")).toBe(
          entry.checksum,
        );
        pg.query(database, source, "postgres");
        appliedExtensions.push(entry.migrationName);
      }
      expect([...applied, ...appliedExtensions]).toEqual(
        checkout.map((entry) => entry.migrationName),
      );
      expect(
        pg.query(
          database,
          `SELECT count(*) FROM information_schema.columns
           WHERE table_schema='public' AND table_name='Workspace'
             AND column_name IN ('personalOwnerUserId', 'deletionState',
                                 'deletionRevision', 'deletionTombstonedAt')`,
          "postgres",
        ),
      ).toBe("4");
      expect(setupTableOwners()).toBe(originalSetupOwners);
      pg.query(database, "ALTER ROLE reviewrouter LOGIN", "postgres");
      reader = client("provider-root-reader");
      writer = client("provider-root-writer");
      observer = client("provider-root-observer");
      await expect(reader.$queryRaw`
        SELECT current_user::text AS "currentUser", session_user::text AS "sessionUser",
          (rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls) AS privileged
        FROM pg_catalog.pg_roles WHERE rolname = current_user
      `).resolves.toEqual([
        {
          currentUser: "reviewrouter",
          sessionUser: "reviewrouter",
          privileged: false,
        },
      ]);
      await seedProvider("provider", 900007);
    }, 300000);
    afterAll(async () => {
      try {
        await Promise.all(clients.map((c) => c.$disconnect()));
      } finally {
        pg.cleanup();
      }
    });
    it("rejects a persisted provider without active namespace under real constraints", async () => {
      await reader.$transaction(async (tx) => {
        await expect(
          readLockedCodexRotatingCurrentProvider(tx, {
            workspaceId: "provider-ws",
            repositoryId: "provider-repo",
            githubRepositoryId: "900007",
            providerInstanceId: "codex-rotating:900007",
          }),
        ).rejects.toThrow("codex_rotating_namespace_missing");
      });
    });
    it("waits for a real provider UPDATE lock before rejecting missing namespace", async () => {
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const write = writer.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "CodexOAuthProviderInstance" WHERE "id"='provider-row' FOR UPDATE`;
        ready();
        await gate;
      });
      const writeOutcome = write.then(
        () => null,
        (error) => error,
      );
      let readOutcome: Promise<unknown> | undefined;
      try {
        await Promise.race([
          held,
          writeOutcome.then((error) => {
            throw error ?? new Error("writer_finished_before_hold");
          }),
        ]);
        readOutcome = reader
          .$transaction((tx) =>
            readLockedCodexRotatingCurrentProvider(tx, {
              workspaceId: "provider-ws",
              repositoryId: "provider-repo",
              githubRepositoryId: "900007",
              providerInstanceId: "codex-rotating:900007",
            }),
          )
          .then(
            () => "unexpected_success",
            (error) => error,
          );
        let blocked = false;
        for (let i = 0; i < 200; i++) {
          const rows = await observer.$queryRaw<
            Array<{ blocked: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='provider-root-reader' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0) AS blocked`;
          if (rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await delay(20);
        }
        expect(blocked).toBe(true);
        release();
        expect(await writeOutcome).toBeNull();
        expect(await readOutcome).toMatchObject({
          message: "codex_rotating_namespace_missing",
        });
      } finally {
        release();
        await writeOutcome;
        if (readOutcome) await readOutcome;
      }
    });
    it("serializes setup and runtime writers with their independent current-provider readers", async () => {
      await seedProvider("runtime", 900008);
      let release!: () => void;
      let ready!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const reading = reader
        .$transaction(async (tx) => {
          await expect(
            readLockedCodexRotatingCurrentProvider(tx, {
              workspaceId: "runtime-ws",
              repositoryId: "runtime-repo",
              githubRepositoryId: "900008",
              providerInstanceId: "codex-rotating:900008",
            }),
          ).rejects.toThrow("codex_rotating_namespace_missing");
          ready();
          await gate;
        })
        .then(
          () => null,
          (error) => error,
        );
      let writing: Promise<unknown> | undefined;
      try {
        await Promise.race([
          held,
          reading.then((error) => {
            throw error ?? new Error("reader_ended_before_hold");
          }),
        ]);
        writing = issueCodexRotatingSetupCommand({
          prisma: writer,
          workspaceId: "runtime-ws",
          repositoryId: "runtime-repo",
          repositoryFullName: "local/proof",
          repositoryDefaultBranch: "main",
          githubRepositoryId: "900008",
          installer: {
            url: "https://reviewrouter.invalid/seed.sh",
            version: "test",
            sha256: "e".repeat(64),
          },
          setupManifestUrl: "https://reviewrouter.invalid/setup-manifest",
          databaseRecoveryWitness: "r".repeat(43),
          runtimeEnvironment: {
            REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED: "1",
          },
        }).then(
          () => null,
          (error) => error,
        );
        let blocked = false;
        for (let i = 0; i < 200; i++) {
          const rows = await observer.$queryRaw<
            Array<{ blocked: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='provider-root-writer' AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0) AS blocked`;
          if (rows[0]?.blocked) {
            blocked = true;
            break;
          }
          await delay(20);
        }
        expect(blocked).toBe(true);
        release();
        expect(await reading).toBeNull();
        expect(await writing).toBeNull();
        expect(
          await observer.codexOAuthSetupManifest.count({
            where: { providerInstanceRowId: "runtime-row", status: "issued" },
          }),
        ).toBe(1);
        const manifest =
          await observer.codexOAuthSetupManifest.findFirstOrThrow({
            where: { providerInstanceRowId: "runtime-row", status: "issued" },
            select: { setupNonce: true },
          });
        const env = {
          REVIEW_ROUTER_CODEX_ROTATING_SETUP_ISSUANCE_ENABLED: "1",
          REVIEW_ROUTER_ENABLE_CODEX_ROTATING_OAUTH: "1",
          REVIEW_ROUTER_CODEX_ROTATING_OAUTH_REPOSITORIES: "local/proof",
        };
        const fetched = await resolveCodexRotatingSetupManifestForNonce({
          prisma: writer,
          setupNonce: manifest.setupNonce,
          databaseRecoveryWitness: "r".repeat(43),
          runtimeEnvironment: env,
        });
        const payload = codexRotatingSetupManifestSchema.parse(
          JSON.parse(
            Buffer.from(fetched.manifestBase64, "base64").toString("utf8"),
          ),
        );
        const ledger = new PrismaCodexRotatingSetupPayloadClaim(
          writer,
          "r".repeat(43),
          undefined,
          env,
          observer,
        );
        const claim = await ledger.claim({
          payloadVersion: 2,
          canonicalizationVersion: 1,
          operationId: "locked-provider-setup",
          repositoryId: "900008",
          providerInstanceId: "codex-rotating:900008",
          setupNonce: manifest.setupNonce,
          manifestDigest: createHash("sha256")
            .update(JSON.stringify(payload))
            .digest("hex"),
          recoveryEpoch: fetched.recoveryEpoch,
          generationHash: "restored-hash-1",
          accountIdentityHash: "a".repeat(64),
          accountIdentityAlgorithm: "provider_issuer_subject_account_v1",
          authByteSize: 128,
          installerVersion: payload.installer.version,
          installerDigest: payload.installer.sha256,
        });
        expect(claim.claimId).toBeTruthy();
        const dispatch = await ledger.authorizeDispatch({
          claimId: claim.claimId,
          idempotencyKey: "locked-provider-dispatch",
        });
        await ledger.recordDispatchOutcome({
          claimId: claim.claimId,
          attemptId: dispatch.attemptId,
          outcome: "definite_success",
          responseCode: 204,
        });
        await ledger.activate({
          claimId: claim.claimId,
          attemptId: dispatch.attemptId,
          repositoryId: "900008",
          repositoryFullName: "local/proof",
          namespaceId: dispatch.namespaceId,
          namespaceEpoch: dispatch.namespaceEpoch,
          secretName: dispatch.secretName,
          workflowPath: ".github/workflows/reviewrouter-codex.yml",
          workflowSourceCommitSha: "1".repeat(40),
          workflowSourceBlobSha: "1".repeat(40),
          workflowSourceSha256: "1".repeat(64),
          workflowSemanticSha256: "1".repeat(64),
          sourceTrust: "trusted_default_branch_revision",
          workflowSchemaVersion: 5,
        });
        let releaseActive!: () => void;
        let readyActive!: () => void;
        const activeGate = new Promise<void>((resolve) => {
          releaseActive = resolve;
        });
        const activeReady = new Promise<void>((resolve) => {
          readyActive = resolve;
        });
        let attestation!: ReturnType<
          typeof createVersionedSecretWorkflowSourceAttestation
        >;
        const activeReading = reader
          .$transaction(async (tx) => {
            const handle = await lockCodexRotatingCurrentProvider(tx, {
              workspaceId: "runtime-ws",
              repositoryId: "runtime-repo",
              githubRepositoryId: "900008",
              providerInstanceId: "codex-rotating:900008",
            });
            try {
              const view = handle.snapshot;
              expect(view.namespace.id).toBe(dispatch.namespaceId);
              expect(view.namespace.workflowSchemaVersion).toBe(5);
              expect(view.provider.mutationOwner).toBeNull();
              attestation = createVersionedSecretWorkflowSourceAttestation({
                repositoryId: "900008",
                workflowPath: ".github/workflows/reviewrouter-codex.yml",
                workflowSourceCommitSha: "1".repeat(40),
                workflowSourceBlobSha: "1".repeat(40),
                workflowSourceSha256: "1".repeat(64),
                workflowSemanticSha256: "1".repeat(64),
                workflowSchemaVersion: 5,
                sourceTrust: WorkflowSourceTrust.TrustedDefaultBranchRevision,
                secretNamespace: view.canonicalNamespace,
              });
              const rows = await tx.$queryRaw<
                Array<{ now: Date }>
              >`SELECT clock_timestamp() AS now`;
              handle.assertNewWork({
                at: rows[0]!.now,
                verified: attestation,
                currentRecoveryWitness: "r".repeat(43),
                newWorkAdmissionBarrier: { assertAdmitted() {} },
              });
              readyActive();
              await activeGate;
            } finally {
              handle.close();
            }
          })
          .then(
            () => null,
            (error) => error,
          );
        let preleaseOutcome: Promise<unknown> | undefined;
        try {
          await Promise.race([
            activeReady,
            activeReading.then((error) => {
              throw error ?? new Error("active_reader_ended_before_hold");
            }),
          ]);
          const runtime = new PrismaCodexRotatingOAuthRepository(writer, {
            actionOwnerRepo: "reviewrouter/action",
            databaseRecoveryWitness: "r".repeat(43),
          });
          preleaseOutcome = runtime
            .acquirePrelease({
              repository: {
                workspaceId: "runtime-ws",
                repositoryId: "runtime-repo",
                githubRepositoryId: "900008",
                githubInstallationId: "789",
                fullName: "local/proof",
                owner: "local",
                selected: true,
                installationStatus: "active",
              },
              providerInstanceId: "codex-rotating:900008",
              githubRunId: "100",
              githubRunAttempt: "1",
              verifiedWorkflowAttestation: attestation,
              newWorkAdmissionBarrier: { assertAdmitted() {} },
            })
            .then(
              (lease) => ({ lease }),
              (error) => ({ error }),
            );
          let blocked = false;
          for (let i = 0; i < 200; i++) {
            const rows = await observer.$queryRaw<Array<{ blocked: boolean }>>`
              SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                WHERE application_name='provider-root-writer' AND wait_event_type='Lock'
                AND cardinality(pg_blocking_pids(pid))>0) AS blocked`;
            if (rows[0]?.blocked) {
              blocked = true;
              break;
            }
            await delay(20);
          }
          expect(blocked).toBe(true);
          releaseActive();
          expect(await activeReading).toBeNull();
          expect(await preleaseOutcome).toHaveProperty("lease");
          const persisted =
            await observer.codexOAuthProviderInstance.findUniqueOrThrow({
              where: { id: "runtime-row" },
              select: { mutationOwner: true, activeLeaseId: true },
            });
          expect(persisted.mutationOwner).toBe("runtime");
          expect(persisted.activeLeaseId).toBeTruthy();
        } finally {
          releaseActive();
          await activeReading;
          if (preleaseOutcome) await preleaseOutcome;
        }
        // Inject a namespace-only wait without changing persisted authority.
        // The runtime clock must be sampled after this wait, not before it.
        let releaseNamespace!: () => void;
        let namespaceReady!: () => void;
        const namespaceGate = new Promise<void>((resolve) => {
          releaseNamespace = resolve;
        });
        const namespaceHeld = new Promise<void>((resolve) => {
          namespaceReady = resolve;
        });
        const holdingNamespace = observer
          .$transaction(async (tx) => {
            await tx.$queryRaw`SELECT "id" FROM "CodexOAuthSecretNamespace"
            WHERE "id"=${dispatch.namespaceId} FOR UPDATE`;
            namespaceReady();
            await namespaceGate;
          })
          .then(
            () => null,
            (error) => error,
          );
        let clockReads = 0;
        let waitingRuntime: Promise<unknown> | undefined;
        try {
          await Promise.race([
            namespaceHeld,
            holdingNamespace.then((error) => {
              throw error ?? new Error("namespace_holder_ended_before_hold");
            }),
          ]);
          const clockedRuntime = new PrismaCodexRotatingOAuthRepository(
            writer,
            {
              actionOwnerRepo: "reviewrouter/action",
              databaseRecoveryWitness: "r".repeat(43),
              transactionClock: {
                async now(tx) {
                  clockReads++;
                  const rows = await tx.$queryRaw<
                    Array<{ now: Date }>
                  >`SELECT clock_timestamp() AS now`;
                  return rows[0]!.now;
                },
              },
            },
          );
          waitingRuntime = clockedRuntime
            .acquirePrelease({
              repository: {
                workspaceId: "runtime-ws",
                repositoryId: "runtime-repo",
                githubRepositoryId: "900008",
                githubInstallationId: "789",
                fullName: "local/proof",
                owner: "local",
                selected: true,
                installationStatus: "active",
              },
              providerInstanceId: "codex-rotating:900008",
              githubRunId: "101",
              githubRunAttempt: "1",
              verifiedWorkflowAttestation: attestation,
              newWorkAdmissionBarrier: {
                assertAdmitted() {
                  throw new Error("disposable_clock_probe_closed");
                },
              },
            })
            .then(
              () => null,
              (error) => error,
            );
          let blocked = false;
          for (let i = 0; i < 200; i++) {
            const rows = await reader.$queryRaw<Array<{ blocked: boolean }>>`
              SELECT EXISTS(SELECT 1 FROM pg_stat_activity
                WHERE application_name='provider-root-writer' AND wait_event_type='Lock'
                AND cardinality(pg_blocking_pids(pid))>0) AS blocked`;
            if (rows[0]?.blocked) {
              blocked = true;
              break;
            }
            await delay(20);
          }
          expect(blocked).toBe(true);
          expect(clockReads).toBe(0);
          releaseNamespace();
          expect(await holdingNamespace).toBeNull();
          expect(await waitingRuntime).toMatchObject({
            message: "disposable_clock_probe_closed",
          });
          expect(clockReads).toBe(2);
        } finally {
          releaseNamespace();
          await holdingNamespace;
          if (waitingRuntime) await waitingRuntime;
        }
      } finally {
        release();
        await reading;
        if (writing) await writing;
      }
    });
    const scope = {
      workspaceId: "absent",
      repositoryId: "absent",
      githubRepositoryId: "123456",
      providerInstanceId: "codex-rotating:123456",
    };
    it("rejects the genuine root Prisma client", async () => {
      await expect(
        readLockedCodexRotatingCurrentProvider(reader, scope),
      ).rejects.toThrow("codex_rotating_transaction_required");
    });
    it("accepts a genuine transaction and fails closed on absent provider", async () => {
      await reader.$transaction(async (tx) => {
        await expect(
          readLockedCodexRotatingCurrentProvider(tx, scope),
        ).rejects.toThrow("codex_rotating_provider_not_found");
        const rows = await tx.$queryRaw<
          Array<{ isolation: string }>
        >`SELECT current_setting('transaction_isolation') AS isolation`;
        expect(rows[0]?.isolation).toBe("read committed");
      });
    });
  },
);
