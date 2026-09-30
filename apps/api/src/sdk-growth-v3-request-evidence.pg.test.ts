import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = `sdk_v3_request_${randomUUID().replaceAll("-", "")}`;
const artifactId = "b".repeat(64);
const manifestId = "c".repeat(64);
const scopeKey = JSON.stringify(["t", "r", 1]);
const digest = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const source = (char: string) => ({
  commit: char.repeat(40),
  tree: char.repeat(40),
});
const approval = {
  evidenceId: "owner-1",
  decision: "approved",
  revoked: false,
  operation: "check",
  ownerSubject: "owner",
  issuedAt: 1,
  expiresAt: 9_999_999_999_999,
};
const provenance = { subject: "owner", authorizedSubjects: ["runner"] };
const binding = {
  target: {
    evaluation: source("1"),
    head: source("1"),
    base: source("3"),
    mergeBase: source("5"),
    evaluationKind: "head",
    repository: { repositoryId: "10" },
  },
  verifier: { immutableRevision: "7".repeat(40) },
};
const requestWire = Buffer.from(
  JSON.stringify({ operation: "check", binding }),
);
const manifestWire = Buffer.from(
  JSON.stringify({
    approval,
    provenance,
    scope: {
      tenantId: "t",
      repositoryId: "r",
      pullRequest: 1,
      githubRepositoryId: "10",
      installationId: "20",
    },
    tool: { efToolArtifactId: artifactId },
    ef: { binding },
  }),
);
const protocolDigest = `sha256:${"d".repeat(64)}`;
const validationWire = Buffer.from(
  JSON.stringify({
    schema: "reviewrouter:g1-v3-request-validation-evidence:1",
    requestWireSha256: digest(requestWire),
    requestByteLength: requestWire.length,
    protocolDigest,
    toolArtifactId: artifactId,
    result: "validated",
  }),
);

type Client = {
  connect(): Promise<void>;
  query(sql: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  end(): Promise<void>;
};

function slotId(assignmentId: string) {
  return createHash("sha256")
    .update("reviewrouter:g1-v3-request-slot:1\0")
    .update(JSON.stringify([assignmentId, "check", "request-validation"]))
    .digest("hex");
}

describe.skipIf(!url)("v3 request evidence / disposable PostgreSQL", () => {
  let db: Client;
  let created = false;

  beforeAll(async () => {
    const pg = createRequire(import.meta.url)("pg") as {
      Client: new (options: { connectionString: string }) => Client;
    };
    db = new pg.Client({ connectionString: url! });
    await db.connect();
    await db.query(`CREATE SCHEMA "${schema}"`);
    created = true;
    await db.query(`SET search_path TO "${schema}"`);
    await db.query(`
      CREATE TABLE "SdkGrowthVerifierAssignment" ("assignmentId" text PRIMARY KEY, "execution" jsonb NOT NULL, "createdAt" timestamptz NOT NULL, "expiresAt" timestamptz NOT NULL, "revokedAt" timestamptz, "efToolArtifactId" varchar(64));
      CREATE TABLE "SdkGrowthCurrentAuthority" ("scopeKey" text PRIMARY KEY, "epoch" bigint NOT NULL);
      CREATE TABLE "SdkGrowthOwnerVersion" ("scopeKey" text NOT NULL, "epoch" bigint NOT NULL, "evidence" jsonb NOT NULL, "provenance" jsonb NOT NULL, "installationActive" boolean NOT NULL, "verifierActive" boolean NOT NULL, PRIMARY KEY ("scopeKey", "epoch"));
      CREATE TABLE "SdkGrowthApprovalFact" ("scopeKey" text NOT NULL, "epoch" bigint NOT NULL, "action" text NOT NULL, "v3ManifestId" varchar(64), PRIMARY KEY ("scopeKey", "epoch"));
      CREATE TABLE "SdkGrowthV3ApprovedManifest" ("manifestId" varchar(64) PRIMARY KEY, "scopeKey" text NOT NULL, "epoch" bigint NOT NULL, "toolArtifactId" varchar(64) NOT NULL, "requestWire" bytea NOT NULL, "manifestWire" bytea NOT NULL);
      CREATE TABLE "SdkGrowthV3ToolArtifact" ("artifactId" varchar(64) PRIMARY KEY);
      CREATE FUNCTION sdk_growth_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable'; END; $$;
    `);
    const migration = readFileSync(
      new URL(
        "../../../packages/platform/db/prisma/migrations/000116_sdk_growth_v3_request_evidence/migration.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.query(migration.replaceAll("public.", `"${schema}".`));
    await db.query(`INSERT INTO "SdkGrowthV3ToolArtifact" VALUES ($1)`, [
      artifactId,
    ]);
    await db.query(`INSERT INTO "SdkGrowthCurrentAuthority" VALUES ($1, 1)`, [
      scopeKey,
    ]);
    await db.query(
      `INSERT INTO "SdkGrowthOwnerVersion" VALUES ($1, 1, $2::jsonb, $3::jsonb, true, true)`,
      [scopeKey, JSON.stringify(approval), JSON.stringify(provenance)],
    );
    await db.query(
      `INSERT INTO "SdkGrowthV3ApprovedManifest" VALUES ($1, $2, 1, $3, $4, $5)`,
      [manifestId, scopeKey, artifactId, requestWire, manifestWire],
    );
    await db.query(
      `INSERT INTO "SdkGrowthApprovalFact" VALUES ($1, 1, 'approve', $2)`,
      [scopeKey, manifestId],
    );
  });

  afterAll(async () => {
    if (created) await db.query(`DROP SCHEMA "${schema}" CASCADE`);
    await db?.end();
  });

  async function insert(
    assignmentId: string,
    changes: Record<string, unknown> = {},
    write = true,
  ) {
    const execution = {
      tenantId: "t",
      repositoryId: "r",
      pullRequest: 1,
      githubRepositoryId: "10",
      installationId: "20",
      subject: "runner",
      sourceCommit: "1".repeat(40),
      sourceTree: "1".repeat(40),
      verifierRevision: "7".repeat(40),
      sourceBinding: {
        headRepositoryId: "10",
        baseRepositoryId: "10",
        baseCommit: "3".repeat(40),
        baseTree: "3".repeat(40),
        mergeBaseCommit: "5".repeat(40),
        mergeBaseTree: "5".repeat(40),
      },
    };
    await db.query(
      `INSERT INTO "SdkGrowthVerifierAssignment" VALUES ($1, $2::jsonb, clock_timestamp() - interval '1 second', clock_timestamp() + interval '10 minutes', NULL, $3)`,
      [assignmentId, JSON.stringify(execution), artifactId],
    );
    const now = Math.floor(Date.now() / 1000) * 1000;
    const row = {
      evidenceId: slotId(assignmentId),
      assignmentId,
      operation: "check",
      stage: "request-validation",
      scopeKey,
      approvalEpoch: 1,
      manifestId,
      ownerEvidenceId: "owner-1",
      efToolArtifactId: artifactId,
      firstJti: randomUUID(),
      tokenIssuedAtMs: now - 1000,
      tokenExpiresAtMs: now + 180000,
      requestWire,
      requestByteLength: requestWire.length,
      requestWireSha256: digest(requestWire),
      efRequestDigest: protocolDigest,
      validationEvidenceWire: validationWire,
      validationEvidenceByteLength: validationWire.length,
      validationEvidenceSha256: digest(validationWire),
      ...changes,
    };
    if (write) await writeEvidence(row);
    return row;
  }

  async function writeEvidence(row: Record<string, unknown>, client = db) {
    await client.query(
      `INSERT INTO "SdkGrowthV3RequestEvidence" ("evidenceId", "assignmentId", "operation", "stage", "scopeKey", "approvalEpoch", "manifestId", "ownerEvidenceId", "efToolArtifactId", "firstJti", "tokenIssuedAtMs", "tokenExpiresAtMs", "requestWire", "requestByteLength", "requestWireSha256", "efRequestDigest", "validationEvidenceWire", "validationEvidenceByteLength", "validationEvidenceSha256") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      Object.values(row),
    );
  }

  it("accepts one exact current request and rejects replay or mutation", async () => {
    const id = randomUUID();
    const row = await insert(id);
    const changed = Buffer.from("{}");
    await expect(
      writeEvidence({
        ...row,
        firstJti: randomUUID(),
        requestWire: changed,
        requestByteLength: changed.length,
        requestWireSha256: digest(changed),
      }),
    ).rejects.toThrow();
    await expect(
      db.query(
        `UPDATE "SdkGrowthV3RequestEvidence" SET "firstJti" = 'other' WHERE "assignmentId" = $1`,
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(
        `DELETE FROM "SdkGrowthV3RequestEvidence" WHERE "assignmentId" = $1`,
        [id],
      ),
    ).rejects.toThrow();
    await expect(
      db.query(`TRUNCATE "SdkGrowthV3RequestEvidence"`),
    ).rejects.toThrow();
  });

  it("rejects changed bytes, evidence digest, deadline, and stale approval", async () => {
    await expect(
      insert(randomUUID(), {
        requestWire: Buffer.from("{}"),
        requestByteLength: 2,
        requestWireSha256: digest(Buffer.from("{}")),
      }),
    ).rejects.toThrow();
    await expect(
      insert(randomUUID(), { efRequestDigest: `sha256:${"e".repeat(64)}` }),
    ).rejects.toThrow();
    await expect(
      insert(randomUUID(), { tokenExpiresAtMs: 1 }),
    ).rejects.toThrow();
    await db.query(
      `UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = 2 WHERE "scopeKey" = $1`,
      [scopeKey],
    );
    await expect(insert(randomUUID())).rejects.toThrow();
    await db.query(
      `UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = 1 WHERE "scopeKey" = $1`,
      [scopeKey],
    );
  });

  it("waits for an assignment lock, then rejects the committed revocation", async () => {
    const id = randomUUID();
    const row = await insert(id, {}, false);
    const pg = createRequire(import.meta.url)("pg") as {
      Client: new (options: { connectionString: string }) => Client;
    };
    const peer = new pg.Client({ connectionString: url! });
    await peer.connect();
    try {
      await peer.query(`SET search_path TO "${schema}"`);
      const pid = (await peer.query("SELECT pg_backend_pid() AS pid"))
        .rows[0] as { pid: number };
      await db.query("BEGIN");
      try {
        await db.query(
          `SELECT 1 FROM "SdkGrowthVerifierAssignment" WHERE "assignmentId" = $1 FOR UPDATE`,
          [id],
        );
        const attempted = writeEvidence(row, peer);
        let waiting = false;
        for (let i = 0; i < 100 && !waiting; i++) {
          const state = await db.query(
            "SELECT wait_event_type AS wait FROM pg_stat_activity WHERE pid = $1",
            [pid.pid],
          );
          waiting =
            (state.rows[0] as { wait?: string } | undefined)?.wait === "Lock";
          if (!waiting) await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await db.query(
          `UPDATE "SdkGrowthVerifierAssignment" SET "revokedAt" = clock_timestamp() WHERE "assignmentId" = $1`,
          [id],
        );
        await db.query("COMMIT");
        await expect(attempted).rejects.toThrow();
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
    } finally {
      await peer.end();
    }
  });
});
