import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SdkGrowthAuthority } from "../application/authority.js";
import {
  EfAuthorityService,
  type AuthenticatedEfExecution,
  type AuthorityCustodyAdmission,
  type AuthorityCustodyCompletion,
  type DecodedEfAdmission,
} from "../application/ef-authority-service.js";
import { PinnedEfAuthorityCodecV1 } from "../application/pinned-ef-authority-codec.js";
import type {
  CanonicalAuthorityMaterial,
  CurrentAuthoritySnapshotPort,
} from "../application/ports.js";
import {
  AuthorityError,
  type Binding,
  type OwnerEvidence,
} from "../domain/contracts.js";
import { canonical } from "../domain/validation.js";
import {
  type AuthorityProvisioningPrismaClient,
  PrismaAuthorityProvisioning,
  PrismaCurrentAuthoritySnapshot,
} from "../infrastructure/prisma/prisma-current-authority.js";
import {
  PrismaAuthorityCustody,
  PrismaEfAuthorityDecisionTransaction,
} from "../infrastructure/prisma/prisma-authority-custody.js";
import { PrismaSdkGrowthPublicationEffect } from "../infrastructure/prisma/prisma-publication-effect.js";
import { runPublicationIntent } from "../application/publication.js";
import { PrismaReceiptRepository } from "../infrastructure/prisma/prisma-receipt-repository.js";
import {
  PrismaSdkGrowthVerifierEvidenceSource,
  SdkGrowthVerifierCustody,
  sdkGrowthVerifierExecutionId,
} from "../../../../../apps/api/src/sdk-growth-verifier-custody.js";

const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = "sdk_growth_lane_a_" + randomUUID().replaceAll("-", "");
const clients: PrismaClient[] = [];
function client() {
  const value = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url!, max: 2, options: "-c search_path=" + schema },
      { schema },
    ),
    transactionOptions: { timeout: 15_000 },
  });
  clients.push(value);
  return value;
}
const digest = (value: Uint8Array) =>
  "sha256:" + createHash("sha256").update(value).digest("hex");
const sri = (value: Uint8Array) =>
  "sha512-" + createHash("sha512").update(value).digest("base64");
const constantDigest = "sha256:" + "a".repeat(64);
const publicationIdentities = {
  async resolve() {
    return {
      appId: "789",
      repositoryId: "123",
      installationId: "456",
      repositoryFullName: "owner/repo",
    };
  },
};

function admissionEnvelope(value: DecodedEfAdmission) {
  const binary = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  const retainedArchive = (item: DecodedEfAdmission["candidateArchive"]) => ({
    bytes: binary(item.bytes),
    sha256: item.sha256,
    sha512Sri: item.sha512Sri,
  });
  return {
    adapterVersion: 1,
    kind: "request",
    requestWire: binary(value.requestWire),
    requestDigest: value.requestDigest,
    request: value.request,
    assertions: value.assertions,
    authorityBinding: value.authorityBinding,
    candidateArchive: retainedArchive(value.candidateArchive),
    releasedArchive: retainedArchive(value.releasedArchive),
    toolArchive: retainedArchive(value.toolArchive),
    installedDistributionWire: binary(value.installedDistributionWire),
    installedDistributionDigest: value.installedDistributionDigest,
  };
}

function fixture() {
  const tenantId = randomUUID();
  const identity = { tenantId, repositoryId: "repo", subject: "runner" };
  const request = {
    version: 1 as const,
    requestId: "request",
    repositoryId: "repo",
    pullRequest: 42,
  };
  const scope = { tenantId, repositoryId: "repo", pullRequest: 42 };
  const binding: Binding = {
    repositoryId: "repo",
    pullRequest: 42,
    head: "1".repeat(40),
    base: "2".repeat(40),
    mergeBase: "3".repeat(40),
    verifierId: "verifier",
    verifierDigest: constantDigest,
    policyDigest: constantDigest,
    toolDigest: constantDigest,
    artifactDigest: constantDigest,
    lockDigest: constantDigest,
    historyDigest: constantDigest,
    scopeDigest: constantDigest,
    scopes: ["public-api"],
  };
  const evidence = (next: Binding): OwnerEvidence => ({
    version: 1,
    evidenceId: "owner-" + next.head,
    tenantId,
    ownerSubject: "owner",
    binding: next,
    scopes: next.scopes,
    decision: "approved",
    sourceDigest: constantDigest,
    issuedAt: 1,
    expiresAt: 100_000,
    revoked: false,
  });
  const state: { material: CanonicalAuthorityMaterial } = {
    material: {
      binding,
      ownerEvidence: evidence(binding),
      provenance: {
        issuer: "trusted",
        subject: "owner",
        authenticationId: "auth",
        installationId: "installation",
        sourceDigest: constantDigest,
        authorizedSubjects: ["runner"],
      },
      installationActive: true,
      verifierActive: true,
    },
  };
  return { identity, request, scope, binding, evidence, state };
}
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function executionFor(
  f: ReturnType<typeof fixture>,
  runId: string,
): AuthenticatedEfExecution {
  return {
    tenantId: f.identity.tenantId,
    repositoryId: f.identity.repositoryId,
    pullRequest: f.scope.pullRequest,
    githubRepositoryId: "123",
    installationId: "456",
    subject: f.identity.subject,
    runId,
    runAttempt: "1",
    verifierRevision: "8".repeat(40),
    sourceCommit: f.binding.head,
    sourceTree: "9".repeat(40),
  };
}

async function waitForAdvisoryWaiter(observer: PrismaClient) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [row] = await observer.$queryRawUnsafe<Array<{ count: bigint }>>(
      "SELECT count(*)::bigint AS count FROM pg_locks WHERE locktype = 'advisory' AND NOT granted",
    );
    if (row && row.count > 0n) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("advisory_waiter_not_observed");
}

let db: PrismaClient;
let peer: PrismaClient;
describe.skipIf(!url)(
  "Lane A custody and decision fencing / real PostgreSQL",
  () => {
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
          'CREATE SCHEMA "' + schema + '"; SET search_path TO "' + schema + '"',
        );
        await connection.query(`
          CREATE TABLE "OutboxEvent" (
            "id" TEXT PRIMARY KEY, "type" TEXT NOT NULL, "version" INTEGER NOT NULL,
            "idempotencyKey" TEXT NOT NULL UNIQUE, "payload" JSONB NOT NULL,
            "status" TEXT NOT NULL, "claimId" TEXT, "claimVersion" BIGINT,
            "claimOwnerHash" TEXT
          )`);
        for (const name of [
          "000101_sdk_growth_authority",
          "000102_sdk_growth_current_authority",
          "000103_sdk_growth_authority_custody",
          "000105_sdk_growth_publication_effect",
        ])
          await connection.query(
            readFileSync(
              new URL(
                "../../../../platform/db/prisma/migrations/" +
                  name +
                  "/migration.sql",
                import.meta.url,
              ),
              "utf8",
            ),
          );
      } finally {
        await connection.end();
      }
      await db.$executeRawUnsafe('SET search_path TO "' + schema + '"');
      await peer.$executeRawUnsafe('SET search_path TO "' + schema + '"');
    });
    afterAll(async () => {
      if (db)
        await db.$executeRawUnsafe(
          'DROP SCHEMA IF EXISTS "' + schema + '" CASCADE',
        );
      await Promise.all(clients.map((value) => value.$disconnect()));
    });

    it("retains maximum supported scope bindings in verifier custody with a bounded SQL limit", async () => {
      const f = fixture();
      const scopes = Array.from(
        { length: 1024 },
        (_, i) => String(i).padStart(4, "0") + "s".repeat(252),
      );
      Object.assign(f.binding, { scopes });
      Object.assign(f.state.material.ownerEvidence, { scopes });
      const writer = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      await writer.advance("operator", f.scope, 0n, "provision");
      const bytes = Buffer.from("archive");
      const insert = (binding: string) => db.$executeRaw`
        INSERT INTO "SdkGrowthVerifierEvidence" (
          "evidenceId", "tenantId", "repositoryId", "pullRequest", "githubRepositoryId", "installationId", "subject",
          "runId", "runAttempt", "verifierRevision", "sourceCommit", "sourceTree", "producer", "authorityBinding",
          "candidateArchive", "candidateArchiveSha256", "candidateArchiveSha512Sri",
          "releasedArchive", "releasedArchiveSha256", "releasedArchiveSha512Sri",
          "toolArchive", "toolArchiveSha256", "toolArchiveSha512Sri", "installedDistributionWire", "installedDistributionDigest"
        ) VALUES (${randomUUID()}, ${f.identity.tenantId}, 'repo', 42, '123', '456', 'runner', 'max-scopes', '1',
          ${"8".repeat(40)}, ${f.binding.head}, ${"9".repeat(40)}, 'reviewrouter-verifier', ${binding}::jsonb,
          ${bytes}, ${digest(bytes)}, ${sri(bytes)}, ${bytes}, ${digest(bytes)}, ${sri(bytes)},
          ${bytes}, ${digest(bytes)}, ${sri(bytes)}, ${bytes}, ${digest(bytes)})`;
      await insert(JSON.stringify(f.binding));
      const [row] = await db.$queryRaw<{ binding: Binding; bytes: number }[]>`
        SELECT "authorityBinding" AS binding, octet_length("authorityBinding"::text) AS bytes
        FROM "SdkGrowthVerifierEvidence" WHERE "tenantId" = ${f.identity.tenantId}`;
      expect(row!.binding).toEqual(f.binding);
      expect(row!.bytes).toBeGreaterThan(266_000);
      expect(row!.bytes).toBeLessThanOrEqual(400_000);
      await expect(
        insert(JSON.stringify({ padding: "x".repeat(400_000) })),
      ).rejects.toThrow();
    });

    it("keeps production verifier reads and finalized reports isolated for two PRs in one execution", async () => {
      const f = fixture();
      const archiveBytes = Buffer.from("archive");
      const distribution = Buffer.from("distribution");
      const archive = {
        bytes: archiveBytes,
        sha256: digest(archiveBytes),
        sha512Sri: sri(archiveBytes),
      };
      const execution42 = executionFor(f, "shared-run");
      const execution99 = { ...execution42, pullRequest: 99 };
      const binding42 = f.binding;
      const binding99 = { ...f.binding, pullRequest: 99 };

      const insertEvidence = async (
        execution: AuthenticatedEfExecution,
        binding: Binding,
      ) => {
        await db.$executeRaw`
          INSERT INTO "SdkGrowthVerifierEvidence" (
            "evidenceId", "tenantId", "repositoryId", "pullRequest", "githubRepositoryId", "installationId", "subject",
            "runId", "runAttempt", "verifierRevision", "sourceCommit", "sourceTree", "producer", "authorityBinding",
            "candidateArchive", "candidateArchiveSha256", "candidateArchiveSha512Sri",
            "releasedArchive", "releasedArchiveSha256", "releasedArchiveSha512Sri",
            "toolArchive", "toolArchiveSha256", "toolArchiveSha512Sri", "installedDistributionWire", "installedDistributionDigest"
          ) VALUES (
            ${sdkGrowthVerifierExecutionId(execution)}, ${execution.tenantId}, ${execution.repositoryId}, ${execution.pullRequest},
            ${execution.githubRepositoryId}, ${execution.installationId}, ${execution.subject}, ${execution.runId},
            ${execution.runAttempt}, ${execution.verifierRevision}, ${execution.sourceCommit}, ${execution.sourceTree},
            'reviewrouter-verifier', ${JSON.stringify(binding)}::jsonb, ${archiveBytes}, ${archive.sha256}, ${archive.sha512Sri},
            ${archiveBytes}, ${archive.sha256}, ${archive.sha512Sri}, ${archiveBytes}, ${archive.sha256}, ${archive.sha512Sri},
            ${distribution}, ${digest(distribution)})`;
      };
      await insertEvidence(execution42, binding42);
      await insertEvidence(execution99, binding99);

      const source = new PrismaSdkGrowthVerifierEvidenceSource(db);
      const verifier = new SdkGrowthVerifierCustody(source);
      const transactions = {
        async transact(
          execution: AuthenticatedEfExecution,
          scope: typeof f.scope,
          operation: (context: never) => Promise<unknown>,
        ) {
          const binding = scope.pullRequest === 42 ? binding42 : binding99;
          const authority = {
            async request(
              identity: typeof f.identity,
              request: typeof f.request,
            ) {
              return {
                version: 1,
                grantId: `grant-${scope.pullRequest}`,
                identity,
                request,
                binding,
                ownerEvidence: f.evidence(binding),
                fence: 1,
                authorityEpoch: 1,
                issuedAt: 100,
                expiresAt: 1_000,
              };
            },
          };
          const custody = {
            async readExecution() {
              return null;
            },
            async retainAdmission(
              _scope: typeof f.scope,
              value: AuthorityCustodyAdmission,
            ) {
              return {
                requestDigest: value.requestDigest,
                grantDigest: value.grantDigest,
                grantWire: value.grantWire,
                completionDigest: null,
                receiptDigest: null,
                receiptWire: null,
                publicationState: "absent" as const,
              };
            },
          };
          expect(execution.pullRequest).toBe(scope.pullRequest);
          return operation({ authority, custody } as never);
        },
      };
      const service = new EfAuthorityService(
        transactions as never,
        new PinnedEfAuthorityCodecV1(),
        verifier,
      );
      const admission = (
        execution: AuthenticatedEfExecution,
        binding: Binding,
      ): DecodedEfAdmission => {
        const assertions = {
          repositoryId: execution.githubRepositoryId,
          installationId: execution.installationId,
          runId: execution.runId,
          runAttempt: execution.runAttempt,
          verifierRevision: execution.verifierRevision,
          sourceCommit: execution.sourceCommit,
          sourceTree: execution.sourceTree,
        };
        const request = {
          version: 1 as const,
          repositoryId: execution.repositoryId,
          pullRequest: execution.pullRequest,
        };
        const installedDistributionDigest = digest(distribution);
        const requestWire = Buffer.from(
          canonical({
            ...request,
            assertions,
            authorityBinding: binding,
            candidateArchive: {
              sha256: archive.sha256,
              sha512Sri: archive.sha512Sri,
            },
            releasedArchive: {
              sha256: archive.sha256,
              sha512Sri: archive.sha512Sri,
            },
            toolArchive: {
              sha256: archive.sha256,
              sha512Sri: archive.sha512Sri,
            },
            installedDistributionDigest,
          }),
        );
        return {
          adapterVersion: 1,
          requestWire,
          requestDigest: digest(requestWire),
          request,
          assertions,
          authorityBinding: binding,
          candidateArchive: archive,
          releasedArchive: archive,
          toolArchive: archive,
          installedDistributionWire: distribution,
          installedDistributionDigest,
        };
      };

      for (const [execution, binding] of [
        [execution42, binding42],
        [execution99, binding99],
      ] as const) {
        const value = admission(execution, binding);
        const wire = await service.admit(
          execution,
          execution.repositoryId,
          execution.pullRequest,
          admissionEnvelope(value),
        );
        expect(JSON.parse(Buffer.from(wire).toString()).grant.binding).toEqual(
          binding,
        );
      }
      expect(await source.load({ ...execution42, pullRequest: 77 })).toBeNull();

      const finalizedReport = Buffer.from("finalized-report");
      const reportDigest = digest(finalizedReport);
      for (const execution of [execution42, execution99]) {
        await db.$executeRaw`
          INSERT INTO "SdkGrowthFinalizedReportEvidence" (
            "reportEvidenceId", "evidenceId", "repositoryId", "runId", "runAttempt", "verifierRevision",
            "producer", "reportDigest", "finalizedReport", "grantId", "outcome", "coverage", "coveredScopes", "phases"
          ) VALUES (
            ${randomUUID()}, ${sdkGrowthVerifierExecutionId(execution)}, ${execution.repositoryId}, ${execution.runId},
            ${execution.runAttempt}, ${execution.verifierRevision}, 'reviewrouter-verifier', ${reportDigest},
            ${finalizedReport}, ${`grant-${execution.pullRequest}`}, 'passed', 'complete', '["public-api"]'::jsonb,
            '["authority","decision"]'::jsonb)`;
        await expect(
          verifier.verifyFinalizedReport({
            execution,
            report: finalizedReport,
            completion: {
              version: 1,
              grantId: `grant-${execution.pullRequest}`,
              fence: 1,
              binding: execution.pullRequest === 42 ? binding42 : binding99,
              coveredScopes: ["public-api"],
              coverage: "complete",
              outcome: "passed",
              reportDigest,
            },
            reportDecision: {
              outcome: "passed",
              coverage: "complete",
              coveredScopes: ["public-api"],
              phases: ["authority", "decision"],
            },
          }),
        ).resolves.toBeUndefined();
      }
      await expect(
        verifier.verifyFinalizedReport({
          execution: { ...execution42, pullRequest: 77 },
          report: finalizedReport,
          completion: {
            version: 1,
            grantId: "grant-42",
            fence: 1,
            binding: binding42,
            coveredScopes: ["public-api"],
            coverage: "complete",
            outcome: "passed",
            reportDigest,
          },
          reportDecision: {
            outcome: "passed",
            coverage: "complete",
            coveredScopes: ["public-api"],
            phases: ["authority", "decision"],
          },
        }),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    });

    it("holds replacement through grant commit and never revives epoch one", async () => {
      const f = fixture();
      const writer = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      expect(await writer.advance("operator", f.scope, 0n, "provision")).toBe(
        1n,
      );
      const entered = deferred();
      const release = deferred();
      const current = new PrismaCurrentAuthoritySnapshot(db, () => 100);
      const paused: CurrentAuthoritySnapshotPort = {
        async resolve(identity, request, budget) {
          const result = await current.resolve(identity, request, budget);
          entered.resolve();
          await release.promise;
          return result;
        },
      };
      const authority = new SdkGrowthAuthority(
        {
          currentAuthority: paused,
          receipts: new PrismaReceiptRepository(db),
          clock: { now: () => 100 },
          publication: { enqueue: async () => {} },
        },
        1_000,
      );
      const pendingGrant = authority.request(f.identity, f.request);
      await entered.promise;
      const bindingB = { ...f.binding, head: "4".repeat(40) };
      f.state.material = {
        ...f.state.material,
        binding: bindingB,
        ownerEvidence: f.evidence(bindingB),
      };
      const replacement = writer.advance(
        "operator",
        f.scope,
        1n,
        "binding-replacement",
      );
      await Promise.resolve();
      const rows = await db.$queryRawUnsafe<Array<{ epoch: bigint }>>(
        'SELECT "epoch" FROM "SdkGrowthCurrentAuthority"',
      );
      expect(rows[0]?.epoch).toBe(1n);
      release.resolve();
      const grant = await pendingGrant;
      expect(grant.authorityEpoch).toBe(1);
      expect(await replacement).toBe(2n);
      f.state.material = {
        ...f.state.material,
        binding: f.binding,
        ownerEvidence: f.evidence(f.binding),
      };
      expect(
        await writer.advance("operator", f.scope, 2n, "binding-replacement"),
      ).toBe(3n);
      await expect(
        authority.complete(f.identity, {
          version: 1,
          grantId: grant.grantId,
          fence: grant.fence,
          binding: grant.binding,
          coveredScopes: grant.binding.scopes,
          coverage: "complete",
          outcome: "passed",
          reportDigest: constantDigest,
        }),
      ).rejects.toMatchObject({ code: "fenced" });
    });

    it("retains concurrent retries and scopes exact historical readback", async () => {
      const execution: AuthenticatedEfExecution = {
        tenantId: randomUUID(),
        repositoryId: "repo",
        pullRequest: 42,
        githubRepositoryId: "123",
        installationId: "456",
        subject: "runner",
        runId: "789",
        runAttempt: "1",
        verifierRevision: "1".repeat(40),
        sourceCommit: "2".repeat(40),
        sourceTree: "3".repeat(40),
      };
      const archive = (text: string) => {
        const bytes = Buffer.from(text);
        return { bytes, sha256: digest(bytes), sha512Sri: sri(bytes) };
      };
      const requestWire = Buffer.from("request");
      const grantWire = Buffer.from("grant");
      const admission: AuthorityCustodyAdmission = {
        execution,
        requestDigest: digest(requestWire),
        requestWire,
        grantDigest: digest(grantWire),
        grantWire,
        candidateArchive: archive("candidate"),
        releasedArchive: archive("released"),
        toolArchive: archive("tool"),
        installedDistributionWire: Buffer.from("distribution"),
        installedDistributionDigest: digest(Buffer.from("distribution")),
      };
      const scope42 = {
        tenantId: execution.tenantId,
        repositoryId: execution.repositoryId,
        pullRequest: 42,
      };
      const scope99 = { ...scope42, pullRequest: 99 };
      const execution99 = { ...execution, pullRequest: 99 };
      const first = new PrismaAuthorityCustody(
        db,
        false,
        publicationIdentities,
      );
      const second = new PrismaAuthorityCustody(
        peer,
        false,
        publicationIdentities,
      );
      const retained = await Promise.all([
        first.retainAdmission(scope42, admission),
        second.retainAdmission(scope42, structuredClone(admission)),
      ]);
      expect(retained[0]).toEqual(retained[1]);
      await expect(
        first.retainAdmission(scope42, {
          ...admission,
          candidateArchive: archive("changed-candidate"),
        }),
      ).rejects.toMatchObject({ code: "conflict" });
      const completionWire = Buffer.from("completion");
      const report = Buffer.from("finalized-report");
      const receiptWire = Buffer.from("receipt");
      const binding = {
        ...fixture().binding,
        head: execution.sourceCommit,
      };
      const completion: AuthorityCustodyCompletion = {
        execution,
        requestDigest: admission.requestDigest,
        grantDigest: admission.grantDigest,
        completionDigest: digest(completionWire),
        completionWire,
        reportDigest: digest(report),
        finalizedReport: report,
        receiptDigest: digest(receiptWire),
        receiptWire,
        receipt: {
          version: 1,
          receiptId: "receipt-42",
          grantId: "grant-42",
          identity: {
            tenantId: execution.tenantId,
            repositoryId: execution.repositoryId,
            subject: execution.subject,
          },
          binding,
          fence: 1,
          authorityEpoch: 1,
          completedAt: 100,
          reportDigest: digest(report),
          admitted: true,
          reason: "admitted",
        },
      };
      const receipt = await second.retainCompletion(scope42, completion);
      expect(receipt.publicationState).toBe("ready");
      expect(
        await first.readCompletion(
          scope42,
          execution,
          admission.requestDigest,
          completion.completionDigest,
        ),
      ).toEqual(receipt);
      await expect(
        first.readAdmission(
          scope42,
          { ...execution, tenantId: "other" },
          admission.requestDigest,
        ),
      ).rejects.toMatchObject({ code: "wrong-identity" });
      expect(
        await first.readAdmission(
          scope42,
          { ...execution, runAttempt: "2" },
          admission.requestDigest,
        ),
      ).toBeNull();
      expect(
        await first.readAdmission(
          scope99,
          execution99,
          admission.requestDigest,
        ),
      ).toBeNull();
      expect(await first.readExecution(scope99, execution99)).toBeNull();
      expect(
        await first.readCompletion(
          scope99,
          execution99,
          admission.requestDigest,
          completion.completionDigest,
        ),
      ).toBeNull();

      await expect(
        first.retainAdmission(scope99, {
          ...structuredClone(admission),
          execution: execution99,
        }),
      ).resolves.toMatchObject({ requestDigest: admission.requestDigest });
      await expect(
        first.readExecution(scope99, execution99),
      ).resolves.toMatchObject({
        requestDigest: admission.requestDigest,
        publicationState: "absent",
      });
      expect(
        await db.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT count(*)::bigint AS count FROM "SdkGrowthAuthorityCustody" WHERE "tenantId" = $1 AND "repositoryId" = $2 AND "requestDigest" = $3',
          execution.tenantId,
          execution.repositoryId,
          admission.requestDigest,
        ),
      ).toEqual([{ count: 2n }]);
      await expect(
        db.$executeRawUnsafe(
          'UPDATE "SdkGrowthAuthorityCustody" SET "pullRequest" = 100 WHERE "tenantId" = $1 AND "pullRequest" = 99',
          execution.tenantId,
        ),
      ).rejects.toThrow(/admission custody is immutable/);
    });

    it("rolls ledger, exact custody and completion effect back together across crash retries", async () => {
      const f = fixture();
      const testNow = Date.now();
      f.state.material = {
        ...f.state.material,
        ownerEvidence: {
          ...f.state.material.ownerEvidence,
          issuedAt: testNow - 1_000,
          expiresAt: testNow + 60_000,
        },
      };
      const archive = (text: string) => {
        const bytes = Buffer.from(text);
        return { bytes, sha256: digest(bytes), sha512Sri: sri(bytes) };
      };
      const writer = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      await writer.advance("operator", f.scope, 0n, "provision");
      const transactions = new PrismaEfAuthorityDecisionTransaction(
        db,
        { now: () => testNow },
        { enqueue: async () => {} },
        1_000,
        publicationIdentities,
      );
      const execution: AuthenticatedEfExecution = {
        tenantId: f.identity.tenantId,
        repositoryId: f.identity.repositoryId,
        pullRequest: f.scope.pullRequest,
        githubRepositoryId: "123",
        installationId: "456",
        subject: f.identity.subject,
        runId: "789",
        runAttempt: "1",
        verifierRevision: "4".repeat(40),
        sourceCommit: f.binding.head,
        sourceTree: "5".repeat(40),
      };
      const requestWire = Buffer.from("exact-request");
      const requestDigest = digest(requestWire);
      const candidateArchive = archive("candidate");
      const releasedArchive = archive("released");
      const toolArchive = archive("tool");
      const installedDistributionWire = Buffer.from("distribution");

      const admit = (crash: boolean) =>
        transactions.transact(
          execution,
          f.scope,
          async ({ authority, custody }) => {
            const grant = await authority.request(f.identity, {
              ...f.request,
              requestId: requestDigest,
            });
            const grantWire = Buffer.from(canonical(grant));
            await custody.retainAdmission(f.scope, {
              execution,
              requestDigest,
              requestWire,
              grantDigest: digest(grantWire),
              grantWire,
              candidateArchive,
              releasedArchive,
              toolArchive,
              installedDistributionWire,
              installedDistributionDigest: digest(installedDistributionWire),
            });
            if (crash) throw new Error("crash-after-admission-custody");
            return grant;
          },
        );

      await expect(admit(true)).rejects.toThrow(
        "crash-after-admission-custody",
      );
      expect(
        await db.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT count(*) AS count FROM "SdkGrowthAuthorityRecord" WHERE "tenantId" = $1',
          f.identity.tenantId,
        ),
      ).toEqual([{ count: 0n }]);
      expect(
        await db.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT count(*) AS count FROM "SdkGrowthAuthorityCustody" WHERE "tenantId" = $1',
          f.identity.tenantId,
        ),
      ).toEqual([{ count: 0n }]);

      const grant = await admit(false);
      expect(grant).toMatchObject({ fence: 1, authorityEpoch: 1 });
      const completionWire = Buffer.from("exact-completion");
      const report = Buffer.from("finalized-report");
      const completion = {
        version: 1 as const,
        grantId: grant.grantId,
        fence: grant.fence,
        binding: grant.binding,
        coveredScopes: grant.binding.scopes,
        coverage: "complete" as const,
        outcome: "passed" as const,
        reportDigest: digest(report),
      };
      const complete = (crash: boolean) =>
        transactions.transact(
          execution,
          f.scope,
          async ({ authority, custody }) => {
            const receipt = await authority.complete(f.identity, completion);
            const receiptWire = Buffer.from(canonical(receipt));
            await custody.retainCompletion(f.scope, {
              execution,
              requestDigest,
              grantDigest: digest(Buffer.from(canonical(grant))),
              completionDigest: digest(completionWire),
              completionWire,
              reportDigest: digest(report),
              finalizedReport: report,
              receiptDigest: digest(receiptWire),
              receiptWire,
              receipt,
            });
            if (crash) throw new Error("crash-after-completion-effect");
            return receipt;
          },
        );

      await expect(complete(true)).rejects.toThrow(
        "crash-after-completion-effect",
      );
      const [rolledBack] = await db.$queryRawUnsafe<
        Array<{
          metadata: { completion: unknown };
          completionDigest: string | null;
        }>
      >(
        'SELECT r."metadata", c."completionDigest" FROM "SdkGrowthAuthorityRecord" r JOIN "SdkGrowthAuthorityCustody" c ON c."tenantId" = r."tenantId" WHERE r."tenantId" = $1',
        f.identity.tenantId,
      );
      expect(rolledBack).toMatchObject({
        metadata: { completion: null },
        completionDigest: null,
      });
      expect(
        await db.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT count(*) AS count FROM "SdkGrowthPublicationEffect" p JOIN "SdkGrowthAuthorityCustody" c ON c."custodyId" = p."custodyId" WHERE c."tenantId" = $1',
          f.identity.tenantId,
        ),
      ).toEqual([{ count: 0n }]);

      const [receipt, replay] = await Promise.all([
        complete(false),
        complete(false),
      ]);
      expect(replay).toEqual(receipt);
      expect(
        await db.$queryRawUnsafe<Array<{ count: bigint }>>(
          'SELECT count(*) AS count FROM "SdkGrowthPublicationEffect" p JOIN "SdkGrowthAuthorityCustody" c ON c."custodyId" = p."custodyId" WHERE c."tenantId" = $1',
          f.identity.tenantId,
        ),
      ).toEqual([{ count: 1n }]);

      const firstProcess = new PrismaSdkGrowthPublicationEffect(db);
      const publication = await firstProcess.load(receipt.receiptId);
      expect(publication).toMatchObject({
        intentId: receipt.receiptId,
        authority: {
          receiptFence: BigInt(receipt.fence),
          authorityEpoch: BigInt(receipt.authorityEpoch),
        },
        check: {
          repositoryId: "123",
          installationId: "456",
          appId: "789",
          repositoryFullName: "owner/repo",
          headSha: execution.sourceCommit,
        },
      });
      const eventId = "event-" + randomUUID();
      await db.$executeRaw`
        INSERT INTO "OutboxEvent" ("id", "type", "version", "idempotencyKey", "payload", "status")
        VALUES (${eventId}, 'sdk_growth.publication_requested', 1,
          ${publication!.intentId},
          ${JSON.stringify({ intentId: publication!.intentId, envelopeDigest: publication!.envelopeDigest })}::jsonb,
          'pending')`;
      await expect(
        firstProcess.link(
          publication!.intentId,
          publication!.envelopeDigest,
          eventId,
        ),
      ).resolves.toBe("linked");
      await db.$executeRaw`
        UPDATE "OutboxEvent" SET "status" = 'processing', "claimId" = 'claim-7',
          "claimVersion" = 7, "claimOwnerHash" = 'worker-new' WHERE "id" = ${eventId}`;
      const restarted = new PrismaSdkGrowthPublicationEffect(peer);
      let mutations = 0;
      let replacement: Promise<bigint> | null = null;
      await expect(
        runPublicationIntent({
          intentId: publication!.intentId,
          claim: {
            eventId,
            claimId: "claim-7",
            claimVersion: 7n,
            claimOwnerHash: "worker-new",
          },
          effects: restarted,
          gateway: {
            async create() {
              mutations += 1;
              f.state.material = {
                ...f.state.material,
                ownerEvidence: {
                  ...f.state.material.ownerEvidence,
                  evidenceId: "replacement-owner",
                },
              };
              replacement = writer.advance(
                "operator",
                f.scope,
                1n,
                "owner-replacement",
              );
              await expect(
                Promise.race([
                  replacement.then(() => "advanced" as const),
                  new Promise<"blocked">((resolve) =>
                    setTimeout(() => resolve("blocked"), 50),
                  ),
                ]),
              ).resolves.toBe("blocked");
              return { kind: "acknowledged", checkRunId: "900" };
            },
            async inspect() {
              return {
                kind: "exact",
                checkRunId: "900",
                observedDigest: "b".repeat(64),
                at: testNow + 1,
              };
            },
          },
          newAttemptId: () => "attempt-one",
          signal: new AbortController().signal,
        }),
      ).resolves.toBe("applied");
      await expect(replacement).resolves.toBe(2n);
      expect(mutations).toBe(1);
      await expect(
        restarted.withMutationPermit(
          publication!.intentId,
          {
            eventId,
            claimId: "claim-old",
            claimVersion: 6n,
            claimOwnerHash: "worker-old",
          },
          "attempt-one",
          async () => {
            mutations += 1;
          },
        ),
      ).resolves.toEqual({ kind: "stale-claim" });
      expect(mutations).toBe(1);
    });

    it("serializes a changed execution request before advancing the winner fence", async () => {
      const f = fixture();
      const writer = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      await writer.advance("operator", f.scope, 0n, "provision");
      const transactions = new PrismaEfAuthorityDecisionTransaction(
        db,
        { now: () => 100 },
        { enqueue: async () => {} },
        1_000,
        publicationIdentities,
      );
      const execution: AuthenticatedEfExecution = {
        tenantId: f.identity.tenantId,
        repositoryId: f.identity.repositoryId,
        pullRequest: f.scope.pullRequest,
        githubRepositoryId: "123",
        installationId: "456",
        subject: f.identity.subject,
        runId: "changed-race",
        runAttempt: "1",
        verifierRevision: "6".repeat(40),
        sourceCommit: f.binding.head,
        sourceTree: "7".repeat(40),
      };
      const archive = (text: string) => {
        const bytes = Buffer.from(text);
        return { bytes, sha256: digest(bytes), sha512Sri: sri(bytes) };
      };
      const candidateArchive = archive("candidate");
      const releasedArchive = archive("released");
      const toolArchive = archive("tool");
      const installedDistributionWire = Buffer.from("distribution");
      const admit = (label: string) => {
        const requestWire = Buffer.from("request-" + label);
        const requestDigest = digest(requestWire);
        return transactions.transact(
          execution,
          f.scope,
          async ({ authority, custody }) => {
            const retained = await custody.readExecution(f.scope, execution);
            if (retained && retained.requestDigest !== requestDigest)
              throw new AuthorityError("conflict");
            const grant = await authority.request(f.identity, {
              ...f.request,
              requestId: requestDigest,
            });
            const grantWire = Buffer.from(canonical(grant));
            await custody.retainAdmission(f.scope, {
              execution,
              requestDigest,
              requestWire,
              grantDigest: digest(grantWire),
              grantWire,
              candidateArchive,
              releasedArchive,
              toolArchive,
              installedDistributionWire,
              installedDistributionDigest: digest(installedDistributionWire),
            });
            return { requestDigest, grant };
          },
        );
      };

      const raced = await Promise.allSettled([admit("a"), admit("b")]);
      const winner = raced.find(
        (
          result,
        ): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof admit>>
        > => result.status === "fulfilled",
      );
      const loser = raced.find(
        (result): result is PromiseRejectedResult =>
          result.status === "rejected",
      );
      expect(winner?.value.grant.fence).toBe(1);
      expect(loser?.reason).toMatchObject({ code: "conflict" });
      await expect(
        transactions.transact(execution, f.scope, ({ authority }) =>
          authority.currentGrant(f.identity, {
            ...f.request,
            requestId: winner!.value.requestDigest,
          }),
        ),
      ).resolves.toEqual(winner!.value.grant);
      expect(
        await db.$queryRawUnsafe<Array<{ fence: bigint; records: bigint }>>(
          'SELECT s."fence", count(r.*) AS records FROM "SdkGrowthAuthorityScope" s LEFT JOIN "SdkGrowthAuthorityRecord" r ON r."tenantId" = s."tenantId" AND r."repositoryId" = s."repositoryId" AND r."pullRequest" = s."pullRequest" WHERE s."tenantId" = $1 GROUP BY s."fence"',
          f.identity.tenantId,
        ),
      ).toEqual([{ fence: 1n, records: 1n }]);
    });

    it("makes completion wait for revocation and then rejects the historical grant", async () => {
      const f = fixture();
      const initialWriter = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      await initialWriter.advance("operator", f.scope, 0n, "provision");
      const execution = executionFor(f, "revocation-wait");
      const transactions = new PrismaEfAuthorityDecisionTransaction(
        db,
        { now: () => 100 },
        { enqueue: async () => {} },
        1_000,
        publicationIdentities,
      );
      const grant = await transactions.transact(
        execution,
        f.scope,
        ({ authority }) => authority.request(f.identity, f.request),
      );
      f.state.material = {
        ...f.state.material,
        ownerEvidence: { ...f.state.material.ownerEvidence, revoked: true },
      };
      const lockEntered = deferred();
      const releaseWriter = deferred();
      let firstQuery = true;
      const pausedClient: AuthorityProvisioningPrismaClient = {
        async $transaction(operation, options) {
          return peer.$transaction(
            (tx) =>
              operation({
                $executeRaw: (strings, ...values) =>
                  tx.$executeRaw(strings, ...values),
                async $queryRaw(strings, ...values) {
                  const result = await tx.$queryRaw(strings, ...values);
                  if (firstQuery) {
                    firstQuery = false;
                    lockEntered.resolve();
                    await releaseWriter.promise;
                  }
                  return result as unknown[];
                },
              }),
            options,
          );
        },
      };
      const revocation = new PrismaAuthorityProvisioning(pausedClient, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      }).advance("operator", f.scope, 1n, "owner-revocation");
      await lockEntered.promise;
      const completion = transactions.transact(
        execution,
        f.scope,
        ({ authority }) =>
          authority.complete(f.identity, {
            version: 1,
            grantId: grant.grantId,
            fence: grant.fence,
            binding: grant.binding,
            coveredScopes: grant.binding.scopes,
            coverage: "complete",
            outcome: "passed",
            reportDigest: constantDigest,
          }),
      );
      const observer = client();
      await waitForAdvisoryWaiter(observer);
      releaseWriter.resolve();
      await expect(revocation).resolves.toBe(2n);
      await expect(completion).rejects.toMatchObject({
        code: "owner-evidence",
      });
      const [record] = await db.$queryRawUnsafe<
        Array<{ metadata: { completion: unknown } }>
      >(
        'SELECT "metadata" FROM "SdkGrowthAuthorityRecord" WHERE "tenantId" = $1',
        f.identity.tenantId,
      );
      expect(record?.metadata.completion).toBeNull();
    });

    it("rolls back completion custody when authority expires after its final writes", async () => {
      const f = fixture();
      const writer = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      await writer.advance("operator", f.scope, 0n, "provision");
      const time = { now: 100 };
      const execution = executionFor(f, "expiry-after-custody");
      const transactions = new PrismaEfAuthorityDecisionTransaction(
        db,
        { now: () => time.now },
        { enqueue: async () => {} },
        1_000,
        publicationIdentities,
      );
      const requestWire = Buffer.from("expiry-request");
      const requestDigest = digest(requestWire);
      const request = { ...f.request, requestId: requestDigest };
      const archive = (text: string) => {
        const bytes = Buffer.from(text);
        return { bytes, sha256: digest(bytes), sha512Sri: sri(bytes) };
      };
      const grant = await transactions.transact(
        execution,
        f.scope,
        async ({ authority, custody }) => {
          const value = await authority.request(f.identity, request);
          const grantWire = Buffer.from(canonical(value));
          await custody.retainAdmission(f.scope, {
            execution,
            requestDigest,
            requestWire,
            grantDigest: digest(grantWire),
            grantWire,
            candidateArchive: archive("candidate"),
            releasedArchive: archive("released"),
            toolArchive: archive("tool"),
            installedDistributionWire: Buffer.from("distribution"),
            installedDistributionDigest: digest(Buffer.from("distribution")),
          });
          return value;
        },
      );
      const completionWire = Buffer.from("expiry-completion");
      const report = Buffer.from("expiry-report");
      const completion = {
        version: 1 as const,
        grantId: grant.grantId,
        fence: grant.fence,
        binding: grant.binding,
        coveredScopes: grant.binding.scopes,
        coverage: "complete" as const,
        outcome: "passed" as const,
        reportDigest: digest(report),
      };

      await expect(
        transactions.transact(
          execution,
          f.scope,
          async ({ authority, custody }) => {
            const receipt = await authority.complete(f.identity, completion);
            const receiptWire = Buffer.from(canonical(receipt));
            await custody.retainCompletion(f.scope, {
              execution,
              requestDigest,
              grantDigest: digest(Buffer.from(canonical(grant))),
              completionDigest: digest(completionWire),
              completionWire,
              reportDigest: digest(report),
              finalizedReport: report,
              receiptDigest: digest(receiptWire),
              receiptWire,
              receipt,
            });
            time.now = grant.expiresAt;
            return receipt;
          },
        ),
      ).rejects.toMatchObject({ code: "expired" });

      const [persisted] = await db.$queryRawUnsafe<
        Array<{
          metadata: { completion: unknown };
          completionDigest: string | null;
          effects: bigint;
        }>
      >(
        'SELECT r."metadata", c."completionDigest", (SELECT count(*) FROM "SdkGrowthPublicationEffect" p WHERE p."custodyId" = c."custodyId") AS effects FROM "SdkGrowthAuthorityRecord" r JOIN "SdkGrowthAuthorityCustody" c ON c."tenantId" = r."tenantId" WHERE r."tenantId" = $1',
        f.identity.tenantId,
      );
      expect(persisted).toMatchObject({
        metadata: { completion: null },
        completionDigest: null,
        effects: 0n,
      });
    });

    it("rechecks expiry after waiting for the transaction-held authority fence", async () => {
      const f = fixture();
      const writer = new PrismaAuthorityProvisioning(peer, {
        async authenticateAndLoad() {
          return structuredClone(f.state.material);
        },
      });
      await writer.advance("operator", f.scope, 0n, "provision");
      const time = { now: 100 };
      const execution = executionFor(f, "expiry-wait");
      const transactions = new PrismaEfAuthorityDecisionTransaction(
        db,
        { now: () => time.now },
        { enqueue: async () => {} },
        1_000,
        publicationIdentities,
      );
      const grant = await transactions.transact(
        execution,
        f.scope,
        ({ authority }) => authority.request(f.identity, f.request),
      );
      const lockEntered = deferred();
      const releaseLock = deferred();
      const scopeKey = JSON.stringify([
        f.scope.tenantId,
        f.scope.repositoryId,
        f.scope.pullRequest,
      ]);
      const held = peer.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${scopeKey}, 0))`;
        lockEntered.resolve();
        await releaseLock.promise;
      });
      await lockEntered.promise;
      const completion = transactions.transact(
        execution,
        f.scope,
        ({ authority }) =>
          authority.complete(f.identity, {
            version: 1,
            grantId: grant.grantId,
            fence: grant.fence,
            binding: grant.binding,
            coveredScopes: grant.binding.scopes,
            coverage: "complete",
            outcome: "passed",
            reportDigest: constantDigest,
          }),
      );
      const observer = client();
      await waitForAdvisoryWaiter(observer);
      time.now = grant.expiresAt;
      releaseLock.resolve();
      await held;
      await expect(completion).rejects.toMatchObject({ code: "expired" });
    });
  },
);
