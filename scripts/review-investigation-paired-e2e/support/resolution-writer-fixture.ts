import { createHash, generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { Ed25519ReleaseWitnessSignerAdapter } from "../../../apps/api/src/release-witness-adapters.js";
import { AttestResolutionWriterQualification } from "../../../apps/api/src/release-witness-resolution-writers.js";
import { PrismaReviewThreadResolutionHistory } from "../../../packages/features/review-publishing/src/v2/infrastructure/prisma/prisma-review-thread-resolution-history.js";
import { activateReviewResolutionHistory } from "../../../packages/features/review-publishing/src/v2/application/use-cases/activate-review-resolution-history.js";
import { createPrismaResolutionWriterQualification } from "../../../packages/features/review-publishing/src/v2/infrastructure/prisma/prisma-resolution-writer-qualification.js";
import type { ReviewActionV2E2EHarness } from "../../review-action-v2-production-e2e/support/review-action-v2-e2e-harness.js";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Synthetic writer observation, signed through the production witness adapter.
 * Bind the actual disposable database before activation; restore its recovery
 * comment before closing Prisma. This never qualifies a deployed writer fleet. */
export async function createPairedResolutionWriterFixture() {
  const keys = generateKeyPairSync("ed25519");
  const keyId = "paired-writer-witness";
  const token = "paired-control-token";
  const binding = {
    environmentId: "paired-lifecycle-disposable",
    deploymentRevision: "a".repeat(40),
    artifactDigest: `sha256:${hash("paired-test-executor")}`,
    fleetDigest: hash("paired-owned-handler-settled"),
  };
  let attestation: AttestResolutionWriterQualification | undefined;
  let restoreComment: (() => Promise<void>) | undefined;
  const server = createServer((request, response) => {
    void (async () => {
      if (
        request.url !== "/v1/resolution-writer-qualification" ||
        request.headers.authorization !== `Bearer ${token}`
      ) {
        response.writeHead(403).end();
        return;
      }
      if (!attestation) throw new Error("paired_writer_not_bound");
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(await attestation.execute()));
    })().catch((error: unknown) => {
      response.writeHead(500).end(JSON.stringify({ error: String(error) }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const environment = {
    REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_URL: origin,
    REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_KEY_ID: keyId,
    REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_PUBLIC_KEY_PEM: keys.publicKey
      .export({ type: "spki", format: "pem" })
      .toString(),
    REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_TOKEN: token,
    REVIEW_ROUTER_RESOLUTION_WRITER_ENVIRONMENT_ID: binding.environmentId,
    REVIEW_ROUTER_RESOLUTION_WRITER_DEPLOYMENT_REVISION:
      binding.deploymentRevision,
    REVIEW_ROUTER_RESOLUTION_WRITER_ARTIFACT_DIGEST: binding.artifactDigest,
    REVIEW_ROUTER_RESOLUTION_WRITER_FLEET_DIGEST: binding.fleetDigest,
  };
  return {
    environment,
    async bind(prisma: ReviewActionV2E2EHarness["prisma"]) {
      const rows = await prisma.$queryRaw<
        {
          serverIdentity: string;
          databaseIdentity: string;
          databaseName: string;
          databaseComment: string | null;
        }[]
      >`SELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "serverIdentity", oid::text AS "databaseIdentity", datname AS "databaseName", pg_catalog.shobj_description(oid, 'pg_database') AS "databaseComment" FROM pg_catalog.pg_database WHERE datname = current_database()`;
      const row = rows[0];
      if (rows.length !== 1 || !row || !/(?:test|ci)/.test(row.databaseName))
        throw new Error("paired_writer_disposable_database_required");
      const recoveryWitnessSha256 = hash(
        `paired-generation:${row.databaseIdentity}`,
      );
      const identifier = `"${row.databaseName.replaceAll('"', '""')}"`;
      const setComment = (comment: string | null) =>
        prisma.$executeRawUnsafe(
          `COMMENT ON DATABASE ${identifier} IS ${comment === null ? "NULL" : `'${comment.replaceAll("'", "''")}'`}`,
        );
      restoreComment = async () => {
        await setComment(row.databaseComment);
      };
      await setComment(JSON.stringify({ recoveryWitnessSha256 }));
      attestation = new AttestResolutionWriterQualification(
        {
          async observe() {
            return {
              ...binding,
              database: {
                serverIdentity: row.serverIdentity,
                databaseIdentity: row.databaseIdentity,
                databaseName: row.databaseName,
                recoveryWitnessSha256,
              },
              proof: {
                writerDigest: binding.fleetDigest,
                qualificationSource: "managed_executor_handler_settlement.v1",
                executors: [
                  {
                    executorId: "paired-owned-app-adapter",
                    binaryDigest: hash("paired-test-executor"),
                    acceptsNewRequests: false,
                    handlerSettlement: "terminal_or_exact_durable_pending",
                  },
                ],
              },
              observedAt: new Date().toISOString(),
            };
          },
        },
        new Ed25519ReleaseWitnessSignerAdapter(
          keyId,
          keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        ),
        { assertOrdinary: async () => {}, assertForceNew: async () => {} },
      );
    },
    activate(fixture: ReviewActionV2E2EHarness) {
      return activateReviewResolutionHistory(
        {
          workspaceId: fixture.workspaceId,
          repositoryConnectionId: fixture.repositoryConnectionId,
          scmRepositoryIdentityId: fixture.scmRepositoryIdentityId,
          pullRequestNumber: 42,
        },
        {
          activation: new PrismaReviewThreadResolutionHistory(fixture.prisma),
          writers: createPrismaResolutionWriterQualification({
            prisma: fixture.prisma,
            env: fixture.env,
          }),
        },
      );
    },
    async close() {
      try {
        await restoreComment?.();
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        });
      }
    },
  };
}
