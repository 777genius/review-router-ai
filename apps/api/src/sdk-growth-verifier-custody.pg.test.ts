import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PinnedEfAuthorityCodecV1,
  SdkGrowthVerifierAuthorityPolicy,
  type AuthenticatedEfExecution,
} from "@reviewrouter/features-sdk-growth-authority";
import { PrismaSdkGrowthVerifierEvidenceCustody } from "./sdk-growth-verifier-custody.js";

const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = `sdk_growth_verifier_writer_${randomUUID().replaceAll("-", "")}`;
const clients: PrismaClient[] = [];
function client() {
  const value = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url!, max: 2, options: `-c search_path=${schema}` },
      { schema },
    ),
    transactionOptions: { timeout: 15_000 },
  });
  clients.push(value);
  return value;
}

const sha256 = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const digest = `sha256:${"a".repeat(64)}`;
let db: PrismaClient;
let peer: PrismaClient;

function fixture(suffix: string) {
  const execution: AuthenticatedEfExecution = {
    tenantId: `tenant-${suffix}`,
    repositoryId: "repo",
    pullRequest: 42,
    githubRepositoryId: "123",
    installationId: "456",
    subject: "runner",
    runId: `run-${suffix}`,
    runAttempt: "1",
    verifierRevision: "1".repeat(40),
    sourceCommit: "2".repeat(40),
    sourceTree: "3".repeat(40),
  };
  const binding = {
    repositoryId: execution.repositoryId,
    pullRequest: execution.pullRequest,
    head: execution.sourceCommit,
    base: "4".repeat(40),
    mergeBase: "5".repeat(40),
    verifierId: "verifier",
    verifierDigest: digest,
    policyDigest: digest,
    toolDigest: digest,
    artifactDigest: digest,
    lockDigest: digest,
    historyDigest: digest,
    scopeDigest: digest,
    scopes: ["public-api"],
  };
  const ownerEvidence = {
    version: 1 as const,
    evidenceId: `owner-${suffix}`,
    tenantId: execution.tenantId,
    ownerSubject: "owner",
    binding,
    scopes: binding.scopes,
    decision: "approved" as const,
    sourceDigest: digest,
    issuedAt: 1,
    expiresAt: 10_000,
    revoked: false,
  };
  const requestDigest = sha256(Buffer.from(`request-${suffix}`));
  const grant = {
    version: 1 as const,
    grantId: `grant-${suffix}`,
    identity: {
      tenantId: execution.tenantId,
      repositoryId: execution.repositoryId,
      subject: execution.subject,
    },
    request: {
      version: 1 as const,
      requestId: `request-${suffix}`,
      repositoryId: execution.repositoryId,
      pullRequest: execution.pullRequest,
    },
    binding,
    ownerEvidence,
    fence: 1,
    authorityEpoch: 1,
    issuedAt: 100,
    expiresAt: 1_000,
  };
  const grantWire = new PinnedEfAuthorityCodecV1().encodeGrant({
    requestDigest,
    grant,
  });
  const grantDigest = sha256(grantWire);
  const authenticator = {
    async authenticate(credential: unknown) {
      if (credential !== "verifier-credential") throw new Error("unauthorized");
      return {
        producer: "reviewrouter-verifier" as const,
        issuer: "workload-identity",
        subject: "verifier-service",
        authenticationId: `job-${suffix}`,
        execution,
      };
    },
  };
  const policy = new SdkGrowthVerifierAuthorityPolicy(() => 100);
  const evidenceInput = {
    expectedAuthorityEpoch: 1,
    candidateArchive: Buffer.from(`candidate-${suffix}`),
    releasedArchive: Buffer.from(`released-${suffix}`),
    toolArchive: Buffer.from(`tool-${suffix}`),
    installedDistributionWire: Buffer.from(`distribution-${suffix}`),
  };
  return {
    execution,
    binding,
    ownerEvidence,
    requestDigest,
    grant,
    grantWire,
    grantDigest,
    authenticator,
    policy,
    evidenceInput,
  };
}

async function seedAuthorityAndAdmission(
  connection: PrismaClient,
  f: ReturnType<typeof fixture>,
) {
  const scopeKey = JSON.stringify([
    f.execution.tenantId,
    f.execution.repositoryId,
    f.execution.pullRequest,
  ]);
  const provenance = {
    issuer: "control-plane",
    subject: f.ownerEvidence.ownerSubject,
    authenticationId: "approval-login",
    installationId: f.execution.installationId,
    sourceDigest: f.ownerEvidence.sourceDigest,
    authorizedSubjects: [f.execution.subject],
  };
  await connection.$executeRaw`
    INSERT INTO "SdkGrowthCurrentAuthority" ("scopeKey", "epoch") VALUES (${scopeKey}, 0)`;
  await connection.$executeRaw`
    INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding")
    VALUES (${scopeKey}, 1, ${JSON.stringify(f.binding)}::jsonb)`;
  await connection.$executeRaw`
    INSERT INTO "SdkGrowthOwnerVersion" (
      "scopeKey", "epoch", "evidence", "provenance", "installationActive", "verifierActive", "reason"
    ) VALUES (
      ${scopeKey}, 1, ${JSON.stringify(f.ownerEvidence)}::jsonb,
      ${JSON.stringify(provenance)}::jsonb, TRUE, TRUE, 'provision'
    )`;
  await connection.$executeRaw`
    UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = 1 WHERE "scopeKey" = ${scopeKey}`;
  const archive = Buffer.from("admission-archive");
  const archiveSri = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
  const distribution = Buffer.from("admission-distribution");
  const requestWire = Buffer.from(`request-${f.grant.grantId}`);
  await connection.$executeRaw`
    INSERT INTO "SdkGrowthAuthorityCustody" (
      "custodyId", "tenantId", "repositoryId", "pullRequest", "githubRepositoryId", "installationId", "subject",
      "runId", "runAttempt", "verifierRevision", "sourceCommit", "sourceTree", "requestDigest", "requestWire",
      "grantDigest", "grantWire", "candidateArchive", "candidateArchiveSha256", "candidateArchiveSha512Sri",
      "releasedArchive", "releasedArchiveSha256", "releasedArchiveSha512Sri", "toolArchive", "toolArchiveSha256",
      "toolArchiveSha512Sri", "installedDistributionWire", "installedDistributionDigest"
    ) VALUES (
      ${randomUUID()}, ${f.execution.tenantId}, ${f.execution.repositoryId}, ${f.execution.pullRequest},
      ${f.execution.githubRepositoryId}, ${f.execution.installationId}, ${f.execution.subject}, ${f.execution.runId},
      ${f.execution.runAttempt}, ${f.execution.verifierRevision}, ${f.execution.sourceCommit}, ${f.execution.sourceTree},
      ${f.requestDigest}, ${requestWire}, ${f.grantDigest}, ${f.grantWire}, ${archive}, ${sha256(archive)}, ${archiveSri},
      ${archive}, ${sha256(archive)}, ${archiveSri}, ${archive}, ${sha256(archive)}, ${archiveSri},
      ${distribution}, ${sha256(distribution)}
    )`;
}

function reportInput(
  f: ReturnType<typeof fixture>,
  body: string,
  outcome: "passed" | "failed",
) {
  return {
    expectedAuthorityEpoch: 1,
    requestDigest: f.requestDigest,
    grantDigest: f.grantDigest,
    finalizedReport: Buffer.from(body),
    decision: {
      outcome,
      coverage: "complete" as const,
      coveredScopes: ["public-api"],
      phases: ["authority", "decision"],
    },
  };
}

describe.skipIf(!url)("verifier custody writer / real PostgreSQL 17", () => {
  beforeAll(async () => {
    db = client();
    peer = client();
    const pg = createRequire(import.meta.url)("pg") as {
      Client: new (options: { connectionString?: string }) => {
        connect(): Promise<void>;
        query(sql: string): Promise<unknown>;
        end(): Promise<void>;
      };
    };
    const connection = new pg.Client({ connectionString: url! });
    await connection.connect();
    try {
      await connection.query(
        `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`,
      );
      for (const name of [
        "000101_sdk_growth_authority",
        "000102_sdk_growth_current_authority",
        "000103_sdk_growth_authority_custody",
        "000106_sdk_growth_finalized_report_logical_identity",
      ])
        await connection.query(
          readFileSync(
            new URL(
              `../../../packages/platform/db/prisma/migrations/${name}/migration.sql`,
              import.meta.url,
            ),
            "utf8",
          ),
        );
    } finally {
      await connection.end();
    }
    await db.$executeRawUnsafe(`SET search_path TO "${schema}"`);
    await peer.$executeRawUnsafe(`SET search_path TO "${schema}"`);
  });

  afterAll(async () => {
    if (db)
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all(clients.map((value) => value.$disconnect()));
  });

  it("serializes competing identical retries and retains one logical report", async () => {
    const f = fixture("identical");
    await seedAuthorityAndAdmission(db, f);
    const first = new PrismaSdkGrowthVerifierEvidenceCustody(
      db,
      f.authenticator,
      f.policy,
    );
    const second = new PrismaSdkGrowthVerifierEvidenceCustody(
      peer,
      f.authenticator,
      f.policy,
    );
    await first.retainEvidence("verifier-credential", f.evidenceInput);
    const input = reportInput(f, "same-report", "passed");
    const retained = await Promise.all([
      first.retainFinalizedReport("verifier-credential", input),
      second.retainFinalizedReport("verifier-credential", input),
    ]);
    expect(retained[0]).toEqual(retained[1]);
    const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "SdkGrowthFinalizedReportEvidence"
      WHERE "grantId" = ${f.grant.grantId}`;
    expect(row?.count).toBe(1n);
  });

  it("allows only one of two competing changed reports for a logical grant", async () => {
    const f = fixture("conflict");
    await seedAuthorityAndAdmission(db, f);
    const first = new PrismaSdkGrowthVerifierEvidenceCustody(
      db,
      f.authenticator,
      f.policy,
    );
    const second = new PrismaSdkGrowthVerifierEvidenceCustody(
      peer,
      f.authenticator,
      f.policy,
    );
    await first.retainEvidence("verifier-credential", f.evidenceInput);
    const settled = await Promise.allSettled([
      first.retainFinalizedReport(
        "verifier-credential",
        reportInput(f, "passed-report", "passed"),
      ),
      second.retainFinalizedReport(
        "verifier-credential",
        reportInput(f, "failed-report", "failed"),
      ),
    ]);
    expect(
      settled.filter((value) => value.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = settled.find((value) => value.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: { code: "conflict" },
    });
    const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "SdkGrowthFinalizedReportEvidence"
      WHERE "grantId" = ${f.grant.grantId}`;
    expect(row?.count).toBe(1n);
  });

  it("rolls back a report insert when post-insert custody validation fails", async () => {
    const f = fixture("rollback");
    await seedAuthorityAndAdmission(db, f);
    const ordinary = new PrismaSdkGrowthVerifierEvidenceCustody(
      db,
      f.authenticator,
      f.policy,
    );
    await ordinary.retainEvidence("verifier-credential", f.evidenceInput);
    const corruptingDatabase = {
      async $transaction<T>(
        operation: (transaction: object) => Promise<T>,
        options: { isolationLevel: "ReadCommitted" },
      ) {
        return db.$transaction(
          async (transaction) =>
            operation(
              new Proxy(transaction, {
                get(target, property) {
                  const value = Reflect.get(target, property);
                  if (property !== "$queryRaw")
                    return typeof value === "function"
                      ? value.bind(target)
                      : value;
                  return async (...args: unknown[]) => {
                    const rows = (await value.apply(target, args)) as unknown[];
                    const strings = args[0] as TemplateStringsArray;
                    if (
                      strings.join("?").includes('r."reportEvidenceId"') &&
                      rows[0]
                    )
                      return [{ ...(rows[0] as object), outcome: "failed" }];
                    return rows;
                  };
                },
              }),
            ),
          options,
        );
      },
    };
    const writer = new PrismaSdkGrowthVerifierEvidenceCustody(
      corruptingDatabase as never,
      f.authenticator,
      f.policy,
    );
    await expect(
      writer.retainFinalizedReport(
        "verifier-credential",
        reportInput(f, "rollback-report", "passed"),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "SdkGrowthFinalizedReportEvidence"
      WHERE "grantId" = ${f.grant.grantId}`;
    expect(row?.count).toBe(0n);
  });
});
