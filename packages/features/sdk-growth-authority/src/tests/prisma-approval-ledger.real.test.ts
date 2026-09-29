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
import {
  PrismaG1ApprovalLedgerCommand,
  PrismaG1ApprovalLedgerSource,
} from "../infrastructure/prisma/prisma-approval-ledger.js";
import { PrismaAuthorityProvisioning } from "../infrastructure/prisma/prisma-current-authority.js";
import type { TrustedAuthorityRecord } from "../application/ports.js";

const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = `g1_ledger_${randomUUID().replaceAll("-", "")}`;
const credentialId = "test_ledger_owner_01";
const token = `g1.${credentialId}.${Buffer.alloc(32, 9).toString("base64url")}`;
const digest = `sha256:${"a".repeat(64)}`;
const scope = {
  tenantId: "test-tenant",
  repositoryId: "test-repo",
  pullRequest: 42,
};
const scopeKey = JSON.stringify([
  scope.tenantId,
  scope.repositoryId,
  scope.pullRequest,
]);
const principal = {
  issuer: "test-control-plane",
  subject: "test-owner",
  authenticationId: `g1:${credentialId}:1`,
  tenantId: scope.tenantId,
  repositoryId: scope.repositoryId,
  githubRepositoryId: "123",
  installationId: "456",
};

function proposal(evidenceId: string): TrustedAuthorityRecord {
  const now = Date.now();
  return {
    ...scope,
    githubRepositoryId: "123",
    installationId: "456",
    binding: {
      repositoryId: scope.repositoryId,
      pullRequest: scope.pullRequest,
      head: "1".repeat(40),
      base: "2".repeat(40),
      mergeBase: "3".repeat(40),
      verifierId: "verifier",
      verifierDigest: digest,
      policyDigest: digest,
      toolDigest: digest,
      artifactDigest: digest,
      lockDigest: digest,
      historyDigest: digest,
      scopeDigest: digest,
      scopes: ["api"],
    },
    approval: {
      version: 1,
      evidenceId,
      tenantId: scope.tenantId,
      ownerSubject: "owner",
      scopes: ["api"],
      decision: "approved",
      sourceDigest: digest,
      issuedAt: now - 1000,
      expiresAt: now + 3_600_000,
      revoked: false,
    },
    approvalProvenance: {
      issuer: "trusted-owner-login",
      subject: "owner",
      authenticationId: "original-login",
      installationId: "456",
      sourceDigest: digest,
      authorizedSubjects: ["runner"],
    },
    installationActive: true,
    verifierActive: true,
  };
}

let db: PrismaClient | undefined;
let setup:
  | {
      connect(): Promise<void>;
      query(sql: string): Promise<unknown>;
      end(): Promise<void>;
    }
  | undefined;

describe.skipIf(!url)("G1 approval ledger / disposable PostgreSQL", () => {
  beforeAll(async () => {
    const pg = createRequire(import.meta.url)("pg") as {
      Client: new (options: {
        connectionString: string;
      }) => NonNullable<typeof setup>;
    };
    setup = new pg.Client({ connectionString: url! });
    await setup.connect();
    await setup.query(`CREATE SCHEMA "${schema}"`);
    await setup.query(`SET search_path TO "${schema}"`);
    for (const migration of [
      "000101_sdk_growth_authority",
      "000102_sdk_growth_current_authority",
      "000112_sdk_growth_operator_credential",
      "000113_sdk_growth_approval_ledger",
    ]) {
      if (migration === "000113_sdk_growth_approval_ledger")
        await setup.query(`INSERT INTO "SdkGrowthCurrentAuthority" ("scopeKey", "epoch")
          VALUES ('["test-tenant","test-repo",46]', 0)`);
      await setup.query(
        readFileSync(
          new URL(
            `../../../../platform/db/prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          "utf8",
        ),
      );
    }
    db = new PrismaClient({
      adapter: new PrismaPg(
        { connectionString: url!, max: 4, options: `-c search_path=${schema}` },
        { schema },
      ),
      transactionOptions: { timeout: 20_000 },
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
    if (setup) {
      await setup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await setup.end();
    }
  });

  async function activateCredential() {
    const database = db!;
    await database.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
        "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
        "installationId", "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${credentialId}, 1, ${hashG1OperatorCredential(token).verifierSha256},
        FALSE, ${BigInt(Date.now() + 3_600_000)}, ${scope.tenantId},
        ${scope.repositoryId}, ${scope.pullRequest}, '123', '456',
        ${principal.issuer}, ${principal.subject},
        ARRAY['provision','owner-replacement','owner-revocation']::text[]
      )`;
  }

  it("keeps original approval provenance through replacement and revocation; prevents reactivation", async () => {
    await activateCredential();
    const database = db!;
    const original = proposal("owner-1");
    let selected = original;
    const writer = new PrismaG1ApprovalLedgerCommand(
      database,
      new G1OperatorCredentialAuthenticator(
        new PrismaG1OperatorCredentialReader(database),
      ),
      { load: async () => selected },
    );
    expect(await writer.approve(token, scope, 0n, "proposal-1")).toBe(1n);
    const firstPointer = await database.$queryRaw<
      Array<{ lastWriteXid: bigint }>
    >`
      SELECT "lastWriteXid" FROM "SdkGrowthCurrentAuthority"
      WHERE "scopeKey" = ${scopeKey}`;
    expect(firstPointer[0]?.lastWriteXid).toBeGreaterThan(0n);
    const replacement = proposal("owner-2");
    selected = replacement;
    expect(await writer.approve(token, scope, 1n, "proposal-2")).toBe(2n);
    const secondPointer = await database.$queryRaw<
      Array<{ lastWriteXid: bigint }>
    >`
      SELECT "lastWriteXid" FROM "SdkGrowthCurrentAuthority"
      WHERE "scopeKey" = ${scopeKey}`;
    expect(secondPointer[0]?.lastWriteXid).toBeGreaterThan(
      firstPointer[0]!.lastWriteXid,
    );
    expect(await writer.revoke(token, scope, 2n)).toBe(3n);
    const source = new PrismaG1ApprovalLedgerSource(database);
    const loaded = await source.load({
      principal,
      scope,
      change: "owner-revocation",
    });
    expect(loaded?.approval).toMatchObject({
      evidenceId: "owner-2",
      revoked: true,
      sourceDigest: digest,
    });
    expect(loaded?.approvalProvenance).toEqual(replacement.approvalProvenance);
    expect(loaded?.approvalProvenance).not.toEqual({
      ...replacement.approvalProvenance,
      authenticationId: principal.authenticationId,
    });
    await expect(
      writer.approve(token, scope, 3n, "proposal-2"),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(writer.revoke(token, scope, 2n)).rejects.toMatchObject({
      code: "conflict",
    });
    const facts = await database.$queryRaw<
      Array<{ epoch: bigint; action: string }>
    >`
      SELECT "epoch", "action" FROM "SdkGrowthApprovalFact"
      WHERE "scopeKey" = ${scopeKey} ORDER BY "epoch"`;
    expect(facts).toEqual([
      { epoch: 1n, action: "approve" },
      { epoch: 2n, action: "approve" },
      { epoch: 3n, action: "revoke" },
    ]);
    await expect(database.$executeRaw`
      UPDATE "SdkGrowthApprovalFact" SET "action" = 'approve'
      WHERE "scopeKey" = ${scopeKey} AND "epoch" = 3`).rejects.toThrow();
  });

  it("rejects rotation after authentication and rolls back both fact and epoch", async () => {
    const database = db!;
    // A separate scope and credential isolate this race from prior history.
    const raceScope = { ...scope, pullRequest: 43 };
    const raceId = "test_ledger_race_01";
    const raceToken = `g1.${raceId}.${Buffer.alloc(32, 10).toString("base64url")}`;
    await database.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
        "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
        "installationId", "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${raceId}, 1, ${hashG1OperatorCredential(raceToken).verifierSha256},
        FALSE, ${BigInt(Date.now() + 3_600_000)}, ${scope.tenantId},
        ${scope.repositoryId}, 43, '123', '456',
        ${principal.issuer}, ${principal.subject}, ARRAY['provision']::text[]
      )`;
    let entered!: () => void;
    let release!: () => void;
    const loading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const writer = new PrismaG1ApprovalLedgerCommand(
      database,
      new G1OperatorCredentialAuthenticator(
        new PrismaG1OperatorCredentialReader(database),
      ),
      {
        load: async () => {
          entered();
          await resume;
          return {
            ...proposal("race-owner"),
            pullRequest: 43,
            binding: { ...proposal("race-owner").binding, pullRequest: 43 },
          };
        },
      },
    );
    const pending = writer.approve(raceToken, raceScope, 0n, "race-proposal");
    await loading;
    await database.$executeRaw`
      UPDATE "SdkGrowthOperatorCredential"
      SET "generation" = 2, "disabled" = TRUE
      WHERE "credentialId" = ${raceId}`;
    release();
    await expect(pending).rejects.toMatchObject({ code: "owner-evidence" });
    const key = JSON.stringify([
      raceScope.tenantId,
      raceScope.repositoryId,
      43,
    ]);
    expect(
      await database.$queryRaw`
      SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${key}`,
    ).toEqual([]);
    expect(
      await database.$queryRaw`
      SELECT "epoch" FROM "SdkGrowthApprovalFact" WHERE "scopeKey" = ${key}`,
    ).toEqual([]);
  });

  it("rejects a standalone fact after a separately committed authority epoch", async () => {
    const database = db!;
    const isolatedScope = { ...scope, pullRequest: 44 };
    const selected = proposal("standalone-owner");
    const record: TrustedAuthorityRecord = {
      ...selected,
      pullRequest: 44,
      binding: { ...selected.binding, pullRequest: 44 },
    };
    const material = {
      binding: record.binding,
      ownerEvidence: { ...record.approval, binding: record.binding },
      provenance: record.approvalProvenance,
      installationActive: record.installationActive,
      verifierActive: record.verifierActive,
    };
    const authority = new PrismaAuthorityProvisioning(database, {
      authenticateAndLoad: async () => material,
    });
    expect(
      await authority.advance("trusted", isolatedScope, 0n, "provision"),
    ).toBe(1n);
    const isolatedId = "test_standalone_01";
    const isolatedToken = `g1.${isolatedId}.${Buffer.alloc(32, 11).toString("base64url")}`;
    await database.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
        "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
        "installationId", "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${isolatedId}, 1, ${hashG1OperatorCredential(isolatedToken).verifierSha256},
        FALSE, ${BigInt(Date.now() + 3_600_000)}, ${scope.tenantId},
        ${scope.repositoryId}, 44, '123', '456',
        ${principal.issuer}, ${principal.subject}, ARRAY['provision']::text[]
      )`;
    const key = JSON.stringify([
      isolatedScope.tenantId,
      isolatedScope.repositoryId,
      isolatedScope.pullRequest,
    ]);
    const stamped = await database.$queryRaw<Array<{ lastWriteXid: bigint }>>`
      SELECT "lastWriteXid" FROM "SdkGrowthCurrentAuthority"
      WHERE "scopeKey" = ${key}`;
    expect(stamped[0]?.lastWriteXid).toBeGreaterThan(0n);
    await expect(database.$executeRaw`
      INSERT INTO "SdkGrowthApprovalFact" (
        "scopeKey", "epoch", "action", "proposalReference", "credentialId",
        "credentialGeneration", "bindingDigest", "decisionDigest", "record"
      ) VALUES (
        ${key}, 1, 'approve', 'trusted-proposal', ${isolatedId}, 1,
        ${digest}, ${digest}, ${JSON.stringify(record)}::jsonb
      )`).rejects.toThrow("approval fact requires authority epoch advance");
    expect(
      await database.$queryRaw`
      SELECT "epoch" FROM "SdkGrowthApprovalFact" WHERE "scopeKey" = ${key}`,
    ).toEqual([]);
    expect(
      await database.$queryRaw<Array<{ epoch: bigint }>>`
      SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${key}`,
    ).toEqual([{ epoch: 1n }]);
  });

  it("stamps the first ledger advance of a historical null pointer", async () => {
    const database = db!;
    const historicalScope = { ...scope, pullRequest: 46 };
    const key = JSON.stringify([
      historicalScope.tenantId,
      historicalScope.repositoryId,
      historicalScope.pullRequest,
    ]);
    expect(
      await database.$queryRaw<Array<{ lastWriteXid: bigint | null }>>`
      SELECT "lastWriteXid" FROM "SdkGrowthCurrentAuthority"
      WHERE "scopeKey" = ${key}`,
    ).toEqual([{ lastWriteXid: null }]);
    const historicalId = "test_historical_01";
    const historicalToken = `g1.${historicalId}.${Buffer.alloc(32, 13).toString("base64url")}`;
    await database.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
        "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
        "installationId", "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${historicalId}, 1, ${hashG1OperatorCredential(historicalToken).verifierSha256},
        FALSE, ${BigInt(Date.now() + 3_600_000)}, ${scope.tenantId},
        ${scope.repositoryId}, 46, '123', '456',
        ${principal.issuer}, ${principal.subject}, ARRAY['provision']::text[]
      )`;
    const selected = proposal("historical-owner");
    const record = {
      ...selected,
      pullRequest: 46,
      binding: { ...selected.binding, pullRequest: 46 },
    };
    const writer = new PrismaG1ApprovalLedgerCommand(
      database,
      new G1OperatorCredentialAuthenticator(
        new PrismaG1OperatorCredentialReader(database),
      ),
      { load: async () => record },
    );
    expect(
      await writer.approve(
        historicalToken,
        historicalScope,
        0n,
        "historical-proposal",
      ),
    ).toBe(1n);
    const current = await database.$queryRaw<
      Array<{ epoch: bigint; lastWriteXid: bigint }>
    >`
      SELECT "epoch", "lastWriteXid" FROM "SdkGrowthCurrentAuthority"
      WHERE "scopeKey" = ${key}`;
    expect(current[0]?.epoch).toBe(1n);
    expect(current[0]?.lastWriteXid).toBeGreaterThan(0n);
  });

  it("holds credential FOR SHARE through commit and makes concurrent rotation wait", async () => {
    const database = db!;
    const raceScope = { ...scope, pullRequest: 45 };
    const raceId = "test_locked_race_01";
    const raceToken = `g1.${raceId}.${Buffer.alloc(32, 12).toString("base64url")}`;
    await database.$executeRaw`
      INSERT INTO "SdkGrowthOperatorCredential" (
        "credentialId", "generation", "verifierSha256", "disabled", "expiresAtMs",
        "tenantId", "repositoryId", "pullRequest", "githubRepositoryId",
        "installationId", "issuer", "subject", "allowedOperations"
      ) VALUES (
        ${raceId}, 1, ${hashG1OperatorCredential(raceToken).verifierSha256},
        FALSE, ${BigInt(Date.now() + 3_600_000)}, ${scope.tenantId},
        ${scope.repositoryId}, 45, '123', '456',
        ${principal.issuer}, ${principal.subject}, ARRAY['provision']::text[]
      )`;
    // Disposable-schema trigger pauses at the binding insert, which is after
    // the writer's credential FOR SHARE. Production schema has no pause hook.
    await setup!.query(`
      CREATE FUNCTION g1_test_pause_binding() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN PERFORM pg_advisory_xact_lock(787, 113); RETURN NEW; END;
      $$;
      CREATE TRIGGER g1_test_pause_binding BEFORE INSERT ON "SdkGrowthBindingVersion"
      FOR EACH ROW EXECUTE FUNCTION g1_test_pause_binding();`);

    let signalHeld!: () => void;
    let releaseHold!: () => void;
    const held = new Promise<void>((resolve) => {
      signalHeld = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const blocker = database.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(787, 113)`;
        signalHeld();
        await hold;
      },
      { timeout: 20_000 },
    );
    await held;
    const selected = proposal("locked-owner");
    const record = {
      ...selected,
      pullRequest: 45,
      binding: { ...selected.binding, pullRequest: 45 },
    };
    const writer = new PrismaG1ApprovalLedgerCommand(
      database,
      new G1OperatorCredentialAuthenticator(
        new PrismaG1OperatorCredentialReader(database),
      ),
      { load: async () => record },
    );
    const writing = writer
      .approve(raceToken, raceScope, 0n, "locked-proposal")
      .then(
        (value) => ({ value, error: null }),
        (error: unknown) => ({ value: null, error }),
      );
    const waitFor = async (sql: string) => {
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const observation = (await setup!.query(sql)) as {
          rows: Array<{ waiting: string }>;
        };
        if (Number(observation.rows[0]?.waiting) > 0) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      throw new Error("expected PostgreSQL lock wait was not observed");
    };
    let rotating: Promise<{ value: number | null; error: unknown }> | null =
      null;
    try {
      await waitFor(`SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'
          AND query LIKE '%SdkGrowthBindingVersion%'`);
      let rotationSettled = false;
      rotating = database.$executeRaw`
        UPDATE "SdkGrowthOperatorCredential"
        SET "generation" = 2, "disabled" = TRUE
        WHERE "credentialId" = ${raceId}`.then(
        (value) => {
          rotationSettled = true;
          return { value, error: null };
        },
        (error: unknown) => {
          rotationSettled = true;
          return { value: null, error };
        },
      );
      await waitFor(`SELECT count(*) AS waiting FROM pg_stat_activity
        WHERE wait_event_type = 'Lock'
          AND query LIKE '%UPDATE "SdkGrowthOperatorCredential"%'`);
      expect(rotationSettled).toBe(false);
      releaseHold();
      await blocker;
      expect(await writing).toEqual({ value: 1n, error: null });
      expect(await rotating).toEqual({ value: 1, error: null });
      const key = JSON.stringify([
        raceScope.tenantId,
        raceScope.repositoryId,
        45,
      ]);
      expect(
        await database.$queryRaw<Array<{ epoch: bigint }>>`
        SELECT "epoch" FROM "SdkGrowthApprovalFact" WHERE "scopeKey" = ${key}`,
      ).toEqual([{ epoch: 1n }]);
      expect(
        await database.$queryRaw<
          Array<{ generation: bigint; disabled: boolean }>
        >`
        SELECT "generation", "disabled" FROM "SdkGrowthOperatorCredential"
        WHERE "credentialId" = ${raceId}`,
      ).toEqual([{ generation: 2n, disabled: true }]);
    } finally {
      releaseHold();
      await blocker;
      await writing;
      if (rotating) await rotating;
      await setup!
        .query(`DROP TRIGGER g1_test_pause_binding ON "SdkGrowthBindingVersion";
        DROP FUNCTION g1_test_pause_binding();`);
    }
  });
});
