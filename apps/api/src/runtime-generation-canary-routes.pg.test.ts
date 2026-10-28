import { createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPrismaClient,
  type PrismaClient,
} from "@reviewrouter/platform-db";
import { registerRuntimeGenerationCanaryRoute } from "./runtime-generation-canary-routes.js";

const databaseUrl = process.env.REVIEW_ROUTER_TEST_DATABASE_URL;
const schema = `runtime_canary_${randomUUID().replaceAll("-", "")}`;

// Qualify the real Prisma/PostgreSQL result-decoding boundary. Private fixture
// functions implement the route's SQL signatures; runtime-role authority and
// generation fencing remain covered by their existing database contracts.
describe.skipIf(!databaseUrl)(
  "runtime canary Prisma/PostgreSQL boundary",
  () => {
    let db: PrismaClient;
    beforeAll(async () => {
      const url = new URL(databaseUrl!);
      if (
        !["127.0.0.1", "localhost"].includes(url.hostname) ||
        !url.pathname.endsWith("_test")
      )
        throw new Error(
          "runtime_canary_requires_disposable_loopback_test_database",
        );
      db = createPrismaClient({ databaseUrl: databaseUrl!, poolMax: 1 });
      await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      await db.$executeRawUnsafe(
        `CREATE TABLE "${schema}".challenge (nonce TEXT NOT NULL)`,
      );
      await db.$executeRawUnsafe(`CREATE TABLE "${schema}".proof (
      nonce TEXT, "rolloutId" TEXT, "requestedAt" TIMESTAMPTZ,
      "runtimeRole" TEXT, "databaseRole" TEXT, "systemIdentifier" TEXT,
      "recoveryWitnessSha256" TEXT, "releaseCommitSha" TEXT, "provedAt" TIMESTAMPTZ,
      "serviceId" TEXT, "deployId" TEXT, "deploymentProvenance" TEXT,
      "servicePostconditionSha256" TEXT
    )`);
      await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reviewrouter_request_runtime_canary_challenge(TEXT,TEXT,TIMESTAMPTZ,TEXT,TEXT,TEXT,JSONB)
      RETURNS VOID LANGUAGE SQL AS $$ INSERT INTO "${schema}".challenge VALUES ($2) $$`);
      await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reviewrouter_read_runtime_canary_challenge_proofs(TEXT)
      RETURNS SETOF "${schema}".proof LANGUAGE SQL AS $$ SELECT * FROM "${schema}".proof WHERE nonce=$1 ORDER BY "runtimeRole" $$`);
      await db.$executeRawUnsafe(`CREATE FUNCTION "${schema}".reviewrouter_runtime_generation_write_read_canary(TEXT,TEXT)
      RETURNS TEXT LANGUAGE SQL AS $$ SELECT nonce FROM "${schema}".challenge WHERE nonce=$2 $$`);
    });
    afterAll(async () => {
      if (db) {
        try {
          await db.$executeRawUnsafe(
            `DROP SCHEMA IF EXISTS "${schema}" CASCADE`,
          );
        } finally {
          await db.$disconnect();
        }
      }
    });

    it("completes after the VOID challenge commits without decoding a result row", async () => {
      const now = new Date();
      const token = "private-canary-fixture";
      const commit = "a".repeat(40);
      const witnessSha256 = "b".repeat(64);
      const [identity] = await db.$queryRawUnsafe<
        Array<{ systemIdentifier: string }>
      >(
        'SELECT system_identifier::text AS "systemIdentifier" FROM pg_control_system()',
      );
      const body = {
        rolloutId: "runtime-canary-driver-test",
        nonce: randomBytes(24).toString("hex"),
        requestedAt: now.toISOString(),
        expectedGeneration: {
          systemIdentifier: identity!.systemIdentifier,
          recoveryWitnessSha256: witnessSha256,
        },
        serviceFacts: ["api", "web", "worker"].map((runtimeRole, index) => ({
          runtimeRole,
          serviceId: `service-${runtimeRole}`,
          deployId: `deploy-${runtimeRole}`,
          deploymentProvenance: String(index + 1).repeat(64),
          servicePostconditionSha256: `sha256:${String(index + 4).repeat(64)}`,
        })),
      };
      const proofs = body.serviceFacts.map((fact) => ({
        ...fact,
        nonce: body.nonce,
        rolloutId: body.rolloutId,
        requestedAt: body.requestedAt,
        databaseRole: `reviewrouter_${fact.runtimeRole}`,
        systemIdentifier: identity!.systemIdentifier,
        recoveryWitnessSha256: witnessSha256,
        releaseCommitSha: commit,
        provedAt: now.toISOString(),
      }));
      await db.$executeRawUnsafe(
        `INSERT INTO "${schema}".proof SELECT * FROM jsonb_populate_recordset(NULL::"${schema}".proof,$1::jsonb)`,
        JSON.stringify(proofs),
      );
      // Keep production SQL signatures while isolating every fixture object. Both
      // methods delegate to the real production Prisma client; no query is mocked.
      const scoped = {
        $queryRawUnsafe: (sql: string, ...values: unknown[]) =>
          db.$queryRawUnsafe(
            sql.replaceAll("public.", `"${schema}".`),
            ...values,
          ),
        $executeRawUnsafe: (sql: string, ...values: unknown[]) =>
          db.$executeRawUnsafe(
            sql.replaceAll("public.", `"${schema}".`),
            ...values,
          ),
      } as unknown as PrismaClient;
      const app = Fastify();
      try {
        await registerRuntimeGenerationCanaryRoute(app, {
          prisma: scoped,
          tokenSha256: createHash("sha256").update(token).digest("hex"),
          releaseCommitSha: commit,
          expectedRecoveryWitnessSha256: witnessSha256,
          rolloutStartedAt: new Date(now.getTime() - 1000),
          now: () => now,
        });
        const response = await app.inject({
          method: "POST",
          url: "/internal/release-canary",
          headers: { authorization: `Bearer ${token}` },
          payload: body,
        });
        expect(response.statusCode, response.body).toBe(200);
        expect(response.json()).toMatchObject({
          nonce: body.nonce,
          serviceFacts: body.serviceFacts,
          runtimeWitnessProofs: proofs.map(
            ({ rolloutId: _rolloutId, ...proof }) => proof,
          ),
          writeReadRoundTrip: true,
        });
        expect(
          await db.$queryRawUnsafe(`SELECT nonce FROM "${schema}".challenge`),
        ).toEqual([{ nonce: body.nonce }]);
      } finally {
        await app.close();
      }
    });
  },
);
