import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  G1OperatorCredentialAuthenticator,
  hashG1OperatorCredential,
  PrismaG1OperatorCredentialReader,
} from "../infrastructure/prisma/prisma-operator-credential.js";

const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = `g1_operator_${randomUUID().replaceAll("-", "")}`;
const credentialId = "test_operator_0001";
const oldToken = `g1.${credentialId}.${Buffer.alloc(32, 7).toString("base64url")}`;
const newToken = `g1.${credentialId}.${Buffer.alloc(32, 8).toString("base64url")}`;
const scope = {
  tenantId: "test-tenant",
  repositoryId: "test-repo",
  pullRequest: 42,
};

let db: PrismaClient | undefined;
type PgClient = {
  connect(): Promise<void>;
  query(sql: string): Promise<unknown>;
  end(): Promise<void>;
};
let setup: PgClient | undefined;

describe.skipIf(!url)("G1 operator credential / disposable PostgreSQL", () => {
  beforeAll(async () => {
    const pg = createRequire(import.meta.url)("pg") as {
      Client: new (options: { connectionString: string }) => PgClient;
    };
    setup = new pg.Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}"`);
    await setup.query(
      readFileSync(
        new URL(
          "../../../../platform/db/prisma/migrations/000110_sdk_growth_operator_credential/migration.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: url!, max: 2, options: `-c search_path=${schema}` },
        { schema },
      ),
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
    if (setup) {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await setup.end();
    }
  });

  it("enforces durable identity, generation and deletion guards; reader observes rotation", async () => {
    const database = db!;
    const oldVerifier = hashG1OperatorCredential(oldToken).verifierSha256;
    const newVerifier = hashG1OperatorCredential(newToken).verifierSha256;
    const initialExpiry = BigInt(Date.now() + 3_600_000);
    const rotatedExpiry = initialExpiry + 3_600_000n;
    await database.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "expiresAtMs", "tenantId",
        "repositoryId", "pullRequest", "githubRepositoryId", "installationId",
        "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${credentialId}, 1, ${oldVerifier}, ${initialExpiry}, ${scope.tenantId},
        ${scope.repositoryId}, ${scope.pullRequest}, '123', '456',
        'test-control-plane', 'test-owner', ARRAY['provision']::text[]
      )`;
    const reader = new PrismaG1OperatorCredentialReader(database);
    const authenticator = new G1OperatorCredentialAuthenticator(reader);
    expect(await reader.findCredential(credentialId)).toMatchObject({
      generation: 1n,
      disabled: true,
      expiresAtMs: initialExpiry,
      verifierSha256: oldVerifier,
      allowedOperations: ["provision"],
    });
    await expect(
      authenticator.authenticateWithFence(oldToken, scope, "provision"),
    ).rejects.toMatchObject({ code: "owner-evidence" });

    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential" SET "disabled" = FALSE
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential" SET "verifierSha256" = ${newVerifier}
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential" SET "expiresAtMs" = ${rotatedExpiry}
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential"
      SET "allowedOperations" = ARRAY['owner-revocation']::text[]
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential" SET "repositoryId" = 'other'
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential" SET "pullRequest" = 43
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(database.$executeRaw`
      DELETE FROM "SdkGrowthOperatorCredential" WHERE "credentialId" = ${credentialId}`).rejects.toThrow();
    await expect(
      database.$executeRawUnsafe('TRUNCATE "SdkGrowthOperatorCredential"'),
    ).rejects.toThrow();

    await database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential"
      SET "generation" = 2, "verifierSha256" = ${newVerifier},
          "disabled" = FALSE, "expiresAtMs" = ${rotatedExpiry},
          "allowedOperations" = ARRAY['owner-revocation']::text[]
      WHERE "credentialId" = ${credentialId}`;
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential" SET "generation" = 1
      WHERE "credentialId" = ${credentialId}`).rejects.toThrow();

    const rotated = await reader.findCredential(credentialId);
    expect(rotated).toMatchObject({
      generation: 2n,
      disabled: false,
      expiresAtMs: rotatedExpiry,
      verifierSha256: newVerifier,
      allowedOperations: ["owner-revocation"],
      repositoryId: scope.repositoryId,
    });
    expect(Object.values(rotated!)).not.toContain(oldToken);
    expect(Object.values(rotated!)).not.toContain(newToken);
    await expect(
      authenticator.authenticateWithFence(oldToken, scope, "owner-revocation"),
    ).rejects.toMatchObject({ code: "owner-evidence" });
    await expect(
      authenticator.authenticateWithFence(newToken, scope, "provision"),
    ).rejects.toMatchObject({ code: "owner-evidence" });
    await expect(
      authenticator.authenticateWithFence(newToken, scope, "owner-revocation"),
    ).resolves.toMatchObject({ fence: { credentialId, generation: 2n } });
  });
});
