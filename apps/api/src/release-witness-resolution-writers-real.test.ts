import { createHash, generateKeyPairSync } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { createPrismaClient } from "@reviewrouter/platform-db";
import { createPrismaResolutionWriterQualification } from "@reviewrouter/features-review-publishing/v2/composition";
import { controlledRetiredWriterProof } from "../../../packages/features/review-publishing/src/v2/tests/resolution-history-fixtures";
import { Ed25519ReleaseWitnessSignerAdapter } from "./release-witness-adapters";
import { AttestResolutionWriterQualification } from "./release-witness-resolution-writers";
import { registerReleaseWitnessRoutes } from "./release-witness-routes";
import type { ObserveRunnerCleanup } from "./release-witness-application";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const databaseTests = databaseUrl ? describe : describe.skip;

databaseTests(
  "resolution writer witness with PostgreSQL and loopback HTTP",
  () => {
    it("verifies the independently observed database generation and rejects missing, revoked and recovered observations", async () => {
      const url = new URL(databaseUrl!);
      if (
        !(
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          /_test$/u.test(url.pathname)
        )
      )
        throw new Error(
          "resolution_witness_requires_disposable_loopback_test_database",
        );
      const prisma = createPrismaClient({
        databaseUrl: databaseUrl!,
        poolMax: 4,
      });
      const app = Fastify();
      const keys = generateKeyPairSync("ed25519");
      const token = "synthetic-loopback-witness-token";
      const keyId = "synthetic-loopback-witness-key";
      const recovery = "d".repeat(64);
      const identity = await prisma.$queryRaw<
        {
          serverIdentity: string;
          databaseIdentity: string;
          databaseName: string;
          databaseComment: string | null;
        }[]
      >`SELECT (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) AS "serverIdentity", oid::text AS "databaseIdentity", datname AS "databaseName", pg_catalog.shobj_description(oid,'pg_database') AS "databaseComment" FROM pg_catalog.pg_database WHERE datname=current_database()`;
      const row = identity[0]!;
      const databaseIdentifier = `"${row.databaseName.replaceAll('"', '""')}"`;
      const commentLiteral = (value: string | null) =>
        value === null ? "NULL" : `'${value.replaceAll("'", "''")}'`;
      const changeGeneration = async (value: string | null) => {
        await prisma.$executeRawUnsafe(
          `COMMENT ON DATABASE ${databaseIdentifier} IS ${commentLiteral(value)}`,
        );
      };
      let qualified = true;
      let observations = 0;
      const proof = controlledRetiredWriterProof();
      const binding = {
        environmentId: "isolated-loopback-fixture",
        deploymentRevision: "a".repeat(40),
        artifactDigest: `sha256:${"b".repeat(64)}`,
        fleetDigest: "c".repeat(64),
        database: {
          serverIdentity: row.serverIdentity,
          databaseIdentity: row.databaseIdentity,
          databaseName: row.databaseName,
          recoveryWitnessSha256: recovery,
        },
      };
      try {
        await changeGeneration(
          JSON.stringify({ recoveryWitnessSha256: recovery }),
        );
        await registerReleaseWitnessRoutes(app, {
          observeCleanup: {} as ObserveRunnerCleanup,
          triggerTokenSha256: createHash("sha256").update(token).digest("hex"),
          attestResolutionWriters: new AttestResolutionWriterQualification(
            {
              async observe() {
                observations++;
                if (!qualified) throw new Error("synthetic_fleet_revoked");
                return {
                  ...binding,
                  proof,
                  observedAt: new Date().toISOString(),
                };
              },
            },
            new Ed25519ReleaseWitnessSignerAdapter(
              keyId,
              keys.privateKey
                .export({ type: "pkcs8", format: "pem" })
                .toString(),
            ),
            { assertOrdinary: async () => {}, assertForceNew: async () => {} },
          ),
        });
        const origin = await app.listen({ host: "127.0.0.1", port: 0 });
        const env = {
          REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_URL: origin,
          REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_KEY_ID: keyId,
          REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_PUBLIC_KEY_PEM: keys.publicKey
            .export({ type: "spki", format: "pem" })
            .toString(),
          REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_TOKEN: token,
          REVIEW_ROUTER_RESOLUTION_WRITER_ENVIRONMENT_ID: binding.environmentId,
          REVIEW_ROUTER_RESOLUTION_WRITER_DEPLOYMENT_REVISION:
            binding.deploymentRevision,
          REVIEW_ROUTER_RESOLUTION_WRITER_ARTIFACT_DIGEST:
            binding.artifactDigest,
          REVIEW_ROUTER_RESOLUTION_WRITER_FLEET_DIGEST: binding.fleetDigest,
        };
        const scope = {
          workspaceId: "fixture",
          repositoryConnectionId: "fixture",
          scmRepositoryIdentityId: "fixture",
          pullRequestNumber: 1,
        };
        const writers = createPrismaResolutionWriterQualification({
          prisma,
          env,
        });
        await expect(writers.qualify(scope)).resolves.toMatchObject({
          status: "qualified",
          proof,
        });
        expect(observations).toBe(1);

        qualified = false;
        await expect(writers.qualify(scope)).resolves.toMatchObject({
          status: "unqualified",
        });
        expect(observations).toBe(2);
        qualified = true;
        await changeGeneration(
          JSON.stringify({ recoveryWitnessSha256: "e".repeat(64) }),
        );
        await expect(writers.qualify(scope)).resolves.toMatchObject({
          status: "unqualified",
        });
        const prior = observations;
        await expect(
          createPrismaResolutionWriterQualification({
            prisma,
            env: {},
          }).qualify(scope),
        ).resolves.toMatchObject({ status: "unqualified" });
        expect(observations).toBe(prior);
        await expect(
          createPrismaResolutionWriterQualification({
            prisma,
            env: {
              ...env,
              REVIEW_ROUTER_RESOLUTION_WRITER_WITNESS_TOKEN: "wrong",
            },
          }).qualify(scope),
        ).resolves.toMatchObject({ status: "unqualified" });
        expect(observations).toBe(prior);
      } finally {
        await app.close();
        await changeGeneration(row.databaseComment);
        await prisma.$disconnect();
      }
    });
  },
);
