import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SdkGrowthAuthority } from "../application/authority.js";
import type { AuthorityLedger } from "../application/ports.js";
import type { Binding, Completion, Grant } from "../domain/contracts.js";
import { PrismaReceiptRepository } from "../infrastructure/prisma/prisma-receipt-repository.js";

// Explicit disposable database only; each run owns and removes an isolated schema.
const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = `sdk_growth_${randomUUID().replaceAll("-", "")}`;
const clients: PrismaClient[] = [];
function client() {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url!, max: 1, options: `-c search_path=${schema}` },
      { schema },
    ),
    transactionOptions: { timeout: 10_000 },
  });
  clients.push(prisma);
  return prisma;
}
const migration = readFileSync(
  new URL(
    "../../../../platform/db/prisma/migrations/000101_sdk_growth_authority/migration.sql",
    import.meta.url,
  ),
  "utf8",
);
let db: PrismaClient;
let peer: PrismaClient;
const digest = `sha256:${"a".repeat(64)}`;
function fixture() {
  const identity = {
    tenantId: randomUUID(),
    repositoryId: "repo",
    subject: "runner",
  };
  const request = {
    version: 1 as const,
    requestId: "request",
    repositoryId: "repo",
    pullRequest: 42,
  };
  const scope = {
    tenantId: identity.tenantId,
    repositoryId: "repo",
    pullRequest: 42,
  };
  const binding: Binding = {
    repositoryId: "repo",
    pullRequest: 42,
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
    scopes: ["public-api"],
  };
  const repository = (connection = db) =>
    new PrismaReceiptRepository(connection);
  const authority = (connection = db) =>
    new SdkGrowthAuthority(
      {
        receipts: repository(connection),
        currentAuthority: {
          resolve: async () => ({
            binding,
            ownerEvidence: {
              version: 1,
              evidenceId: "owner",
              tenantId: identity.tenantId,
              ownerSubject: "owner",
              binding,
              scopes: binding.scopes,
              decision: "approved",
              sourceDigest: digest,
              issuedAt: 0,
              expiresAt: 2000,
              revoked: false,
            },
          }),
        },
        clock: { now: () => 100 },
        publication: { enqueue: async () => {} },
      },
      1000,
    );
  const completion = (grant: Grant): Completion => ({
    version: 1,
    grantId: grant.grantId,
    fence: grant.fence,
    binding,
    coveredScopes: binding.scopes,
    coverage: "complete",
    outcome: "passed",
    reportDigest: digest,
  });
  return {
    identity,
    request,
    scope,
    binding,
    repository,
    authority,
    completion,
  };
}
// Prisma raw SQL does not inherit adapter.schema; set search_path per connection.
async function configure(connection: PrismaClient) {
  await connection.$executeRawUnsafe(`SET search_path TO "${schema}"`);
}

describe.skipIf(!url)(
  "Prisma receipt custody / real PostgreSQL migration",
  () => {
    beforeAll(async () => {
      db = client();
      peer = client();
      await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
      // Execute migration as a single PostgreSQL simple-query batch using a dedicated pg connection.
      const pg = createRequire(import.meta.url)("pg") as {
        Client: new (options: { connectionString: string | undefined }) => {
          connect(): Promise<void>;
          query(sql: string): Promise<unknown>;
          end(): Promise<void>;
        };
      };
      const connection = new pg.Client({ connectionString: url });
      await connection.connect();
      try {
        await connection.query(`SET search_path TO "${schema}"`);
        await connection.query(
          'CREATE TABLE "existing_data" (id integer PRIMARY KEY); INSERT INTO "existing_data" VALUES (7)',
        );
        await connection.query(migration);
        const preserved = await connection.query(
          'SELECT id FROM "existing_data"',
        );
        expect(preserved).toMatchObject({ rows: [{ id: 7 }] });
      } finally {
        await connection.end();
      }
      await configure(db);
      await configure(peer);
    });
    afterAll(async () => {
      if (db)
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await Promise.all(clients.map((connection) => connection.$disconnect()));
    });

    it("persists maximum scope metadata through completion, replay and dispatch", async () => {
      const f = fixture();
      Object.assign(f.binding, {
        verifierId: "v".repeat(256),
        scopes: Array.from(
          { length: 1024 },
          (_, i) => String(i).padStart(4, "0") + "s".repeat(252),
        ),
      });
      const grant = await f.authority().request(f.identity, f.request);
      const [pending] = await db.$queryRaw<
        { bytes: number }[]
      >`SELECT octet_length("metadata"::text) AS bytes FROM "SdkGrowthAuthorityRecord" WHERE "tenantId" = ${f.identity.tenantId}`;
      expect(pending!.bytes).toBeGreaterThan(790_000);
      const completion = f.completion(grant);
      const receipt = await f.authority(peer).complete(f.identity, completion);
      expect(receipt.admitted).toBe(true);
      const [completed] = await db.$queryRaw<
        { bytes: number }[]
      >`SELECT octet_length("metadata"::text) AS bytes FROM "SdkGrowthAuthorityRecord" WHERE "tenantId" = ${f.identity.tenantId}`;
      expect(completed!.bytes).toBeGreaterThan(1_850_000);
      expect(completed!.bytes).toBeLessThanOrEqual(2_097_152);
      expect(await f.authority().request(f.identity, f.request)).toEqual(grant);
      expect(await f.authority().complete(f.identity, completion)).toEqual(
        receipt,
      );
      expect(await f.authority().currentReceipt(f.identity, f.request)).toEqual(
        receipt,
      );
      await f.authority().dispatch(f.identity, f.request);
    });

    it("uses the request index and never loads unrelated permanent tombstones", async () => {
      const f = fixture();
      const historical = await f.authority().request(f.identity, f.request);
      for (let i = 0; i < 64; i++)
        await f
          .authority()
          .request(f.identity, { ...f.request, requestId: `old-${i}` });
      // Damaged unrelated metadata must not be parsed or cloned by selected operations.
      await db.$executeRaw`UPDATE "SdkGrowthAuthorityRecord" SET "metadata" = jsonb_set("metadata", '{receipt}', '{}') WHERE "tenantId" = ${f.identity.tenantId} AND "requestId" <> ${f.request.requestId}`;
      const request = { ...f.request, requestId: "current" };
      const current = await f.authority().request(f.identity, request);
      expect(current.fence).toBe(66);
      expect(await f.authority(peer).request(f.identity, f.request)).toEqual(
        historical,
      );
      const receipt = await f
        .authority()
        .complete(f.identity, f.completion(current));
      expect(await f.authority().currentReceipt(f.identity, request)).toEqual(
        receipt,
      );
      await f.authority().dispatch(f.identity, request);
      await f.authority().revoke(f.identity, request);
      expect(
        await f.authority(peer).complete(f.identity, f.completion(current)),
      ).toEqual(receipt);
      await expect(
        f.authority().request(f.identity, { ...f.request, requestId: "old-0" }),
      ).rejects.toThrow();
      const plan = await db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL enable_seqscan = off");
        return tx.$queryRaw`EXPLAIN (FORMAT JSON) SELECT "fence", "requestId", "metadata" FROM "SdkGrowthAuthorityRecord"
          WHERE "tenantId" = ${f.scope.tenantId} AND "repositoryId" = ${f.scope.repositoryId}
          AND "pullRequest" = ${BigInt(f.scope.pullRequest)} AND "requestId" = ${request.requestId}`;
      });
      expect(JSON.stringify(plan)).toContain(
        "SdkGrowthAuthorityRecord_request_key",
      );
      expect(JSON.stringify(plan)).toContain("Index Cond");
    });

    it("selects completions by exact grant identity, independently of the supplied fence", async () => {
      const f = fixture();
      const grant = await f.authority().request(f.identity, f.request);
      await expect(
        f.authority().complete(f.identity, {
          ...f.completion(grant),
          fence: grant.fence + 1,
        }),
      ).rejects.toMatchObject({ code: "fenced" });
      for (const grantId of [
        "opaque",
        JSON.stringify([f.scope.tenantId, "other", 42, f.request.requestId]),
        JSON.stringify(
          [f.scope.tenantId, f.scope.repositoryId, 42, f.request.requestId],
          null,
          1,
        ),
        JSON.stringify([f.scope.tenantId, f.scope.repositoryId, 42, "missing"]),
      ]) {
        await expect(
          f.authority().complete(f.identity, {
            ...f.completion(grant),
            grantId,
          }),
        ).rejects.toMatchObject({ code: "not-found" });
      }
      expect(
        await f.authority().complete(f.identity, f.completion(grant)),
      ).toMatchObject({ admitted: true });
    });

    it.each(["revoke", "rollback", "advance"] as const)(
      "observes %s after a controlled scope-lock wait",
      async (action) => {
        const f = fixture();
        const grant = await f.authority().request(f.identity, f.request);
        const observer = client();
        const [backend] = await peer.$queryRaw<
          { pid: number }[]
        >`SELECT pg_backend_pid() AS pid`;
        let release!: () => void;
        let entered!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const acquired = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const holding = f
          .repository()
          .transact(
            f.scope,
            { requestId: action === "advance" ? "next" : f.request.requestId },
            async (ledger) => {
              if (action === "advance") {
                const next = structuredClone(grant);
                Object.assign(next, {
                  fence: ++ledger.fence,
                  request: { ...f.request, requestId: "next" },
                  grantId: JSON.stringify([
                    f.scope.tenantId,
                    f.scope.repositoryId,
                    f.scope.pullRequest,
                    "next",
                  ]),
                });
                ledger.records.push({
                  grant: next,
                  revoked: false,
                  completion: null,
                  receipt: null,
                  intent: null,
                  dispatched: false,
                });
              } else ledger.records[0]!.revoked = true;
              entered();
              await held;
              if (action === "rollback") throw new Error("controlled rollback");
            },
          )
          .then(
            () => null,
            (error: unknown) => error,
          );
        await acquired;
        const waiting = f
          .authority(peer)
          .complete(f.identity, f.completion(grant))
          .then(
            (receipt) => ({ receipt }),
            (error: unknown) => ({ error }),
          );
        try {
          // Observe the actual PostgreSQL lock wait, not elapsed timing.
          await expect
            .poll(async () => {
              const [activity] = await observer.$queryRaw<
                { waiting: boolean }[]
              >`SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = ${backend!.pid}`;
              return activity?.waiting;
            })
            .toBe(true);
        } finally {
          release();
        }
        const heldResult = await holding;
        const result = await waiting;
        if (action === "rollback") {
          expect(heldResult).toBeInstanceOf(Error);
          expect(result).toMatchObject({ receipt: { admitted: true } });
        } else {
          expect(heldResult).toBeNull();
          expect(result).toMatchObject({
            error: { code: action === "advance" ? "fenced" : "revoked" },
          });
        }
        expect(await f.authority().request(f.identity, f.request)).toEqual(
          grant,
        );
        const next = await f
          .authority()
          .request(f.identity, { ...f.request, requestId: "after" });
        expect(next.fence).toBe(action === "advance" ? 3 : 2);
      },
    );

    it("serializes simultaneous first grants across independent connection pools", async () => {
      const f = fixture();
      const grants = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          f
            .authority(i % 2 ? peer : db)
            .request(f.identity, { ...f.request, requestId: `request-${i}` }),
        ),
      );
      expect(grants.map((g) => g.fence).sort((a, b) => a - b)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8,
      ]);
      expect(
        await f
          .repository()
          .transact(
            f.scope,
            { requestId: f.request.requestId },
            async (ledger) => ledger.fence,
          ),
      ).toBe(8);
    });
    it("identical concurrent requests and process-like retries retain one tombstone", async () => {
      const f = fixture();
      const [a, b] = await Promise.all([
        f.authority().request(f.identity, f.request),
        f.authority(peer).request(f.identity, f.request),
      ]);
      expect(a).toEqual(b);
      const restarted = client();
      await configure(restarted);
      expect(
        await f.authority(restarted).request(f.identity, f.request),
      ).toEqual(a);
      expect(
        await f
          .repository()
          .transact(
            f.scope,
            { requestId: f.request.requestId },
            async (ledger) => ledger.records.length,
          ),
      ).toBe(1);
      await expect(
        f
          .authority(peer)
          .request({ ...f.identity, subject: "another" }, f.request),
      ).rejects.toMatchObject({ code: "wrong-identity" });
    });
    it("atomically retains completion/receipt/intent and rejects concurrent conflicting completion", async () => {
      const f = fixture();
      const grant = await f.authority().request(f.identity, f.request);
      const completion = f.completion(grant);
      const [a, b] = await Promise.all([
        f.authority().complete(f.identity, completion),
        f.authority(peer).complete(f.identity, completion),
      ]);
      expect(a).toEqual(b);
      await expect(
        f
          .authority(peer)
          .complete(f.identity, { ...completion, outcome: "failed" }),
      ).rejects.toMatchObject({ code: "conflict" });
      const record = await f
        .repository()
        .transact(
          f.scope,
          { requestId: f.request.requestId },
          async (ledger) => ledger.records[0]!,
        );
      expect(record.intent?.receipt).toEqual(a);
      expect(record.completion).toEqual(completion);
      await expect(
        db.$executeRaw`UPDATE "SdkGrowthAuthorityRecord" SET "metadata" = jsonb_set("metadata", '{completion}', 'null') WHERE "tenantId" = ${f.identity.tenantId}`,
      ).rejects.toThrow();
      await f.authority().revoke(f.identity, f.request);
      expect(await f.authority(peer).complete(f.identity, completion)).toEqual(
        a,
      );
    });
    it("allows only one of simultaneous different completions", async () => {
      const f = fixture();
      const grant = await f.authority().request(f.identity, f.request);
      const results = await Promise.allSettled([
        f.authority().complete(f.identity, f.completion(grant)),
        f
          .authority(peer)
          .complete(f.identity, { ...f.completion(grant), outcome: "failed" }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({
        reason: { code: "conflict" },
      });
    });
    it("rolls back callback throws, including first scope creation and record edits", async () => {
      const f = fixture();
      await expect(
        f
          .repository()
          .transact(
            f.scope,
            { requestId: f.request.requestId },
            async (ledger) => {
              ledger.fence++;
              throw new Error("abort");
            },
          ),
      ).rejects.toThrow("abort");
      expect(
        await db.$queryRaw`SELECT "fence" FROM "SdkGrowthAuthorityScope" WHERE "tenantId" = ${f.identity.tenantId}`,
      ).toEqual([]);
      const grant = await f.authority().request(f.identity, f.request);
      expect(grant.fence).toBe(1);
      await expect(
        f
          .repository()
          .transact(
            f.scope,
            { requestId: f.request.requestId },
            async (ledger) => {
              ledger.records[0]!.revoked = true;
              throw new Error("abort");
            },
          ),
      ).rejects.toThrow("abort");
      expect(
        await f.authority().complete(f.identity, f.completion(grant)),
      ).toMatchObject({ admitted: true });
    });
    it("rejects stale fences and never resets fences after revocation", async () => {
      const f = fixture();
      const a = await f.authority().request(f.identity, f.request);
      const b = await f
        .authority(peer)
        .request(f.identity, { ...f.request, requestId: "next" });
      await expect(
        f.authority().complete(f.identity, f.completion(a)),
      ).rejects.toMatchObject({ code: "fenced" });
      await f
        .authority()
        .revoke(f.identity, { ...f.request, requestId: "next" });
      const c = await f
        .authority()
        .request(f.identity, { ...f.request, requestId: "third" });
      expect(c.fence).toBe(b.fence + 1);
      expect(await f.authority().request(f.identity, f.request)).toEqual(a);
    });
    it("detaches retained drafts and returned objects", async () => {
      const f = fixture();
      await f.authority().request(f.identity, f.request);
      let retained!: AuthorityLedger;
      const output = await f
        .repository()
        .transact(
          f.scope,
          { requestId: f.request.requestId },
          async (ledger) => {
            retained = ledger;
            return ledger;
          },
        );
      retained.records[0]!.revoked = true;
      output.records.length = 0;
      expect(
        await f
          .repository(peer)
          .transact(
            f.scope,
            { requestId: f.request.requestId },
            async (ledger) => ledger.records[0]!.revoked,
          ),
      ).toBe(false);
    });
    it("rejects deletion, changed tombstones, decreasing fences, unknown payloads and cross-scope drafts", async () => {
      const f = fixture();
      await f.authority().request(f.identity, f.request);
      const mutations = [
        (l: AuthorityLedger) => {
          l.records = [];
          l.fence = 0;
        },
        (l: AuthorityLedger) => {
          l.fence++;
        },
        (l: AuthorityLedger) => {
          Object.assign(l.records[0]!.grant, { source: "do not store" });
        },
        (l: AuthorityLedger) => {
          Object.assign(l.records[0]!.grant.identity, { tenantId: "other" });
        },
        (l: AuthorityLedger) => {
          Object.assign(l.records[0]!.grant, { issuedAt: 50 });
        },
      ];
      for (const mutate of mutations)
        await expect(
          f
            .repository()
            .transact(
              f.scope,
              { requestId: f.request.requestId },
              async (ledger) => mutate(ledger),
            ),
        ).rejects.toThrow();
      expect(
        await f
          .repository()
          .transact(
            f.scope,
            { requestId: f.request.requestId },
            async (ledger) => ledger.fence,
          ),
      ).toBe(1);
    });
    it("locks only the exact scope, including tenant, repository and pull request", async () => {
      const f = fixture();
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered!: () => void;
      const acquired = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const first = f
        .repository()
        .transact(f.scope, { requestId: f.request.requestId }, async () => {
          entered();
          await held;
        });
      await acquired;
      try {
        for (const scope of [
          { ...f.scope, tenantId: "other" },
          { ...f.scope, repositoryId: "other" },
          { ...f.scope, pullRequest: 43 },
        ]) {
          expect(
            await f
              .repository(peer)
              .transact(
                scope,
                { requestId: "request" },
                async (ledger) => ledger.fence,
              ),
          ).toBe(0);
        }
      } finally {
        release();
        await first;
      }
    });
    it("migration guards durable tombstones and rejects corrupted persisted state before callback", async () => {
      const f = fixture();
      await f.authority().request(f.identity, f.request);
      await expect(
        db.$executeRaw`DELETE FROM "SdkGrowthAuthorityRecord" WHERE "tenantId" = ${f.identity.tenantId}`,
      ).rejects.toThrow();
      await expect(
        db.$executeRaw`UPDATE "SdkGrowthAuthorityScope" SET "fence" = 0 WHERE "tenantId" = ${f.identity.tenantId}`,
      ).rejects.toThrow();
      await expect(
        db.$executeRaw`UPDATE "SdkGrowthAuthorityRecord" SET "metadata" = jsonb_set("metadata", '{grant,issuedAt}', '50') WHERE "tenantId" = ${f.identity.tenantId}`,
      ).rejects.toThrow();
      await expect(
        db.$executeRawUnsafe(
          'TRUNCATE "SdkGrowthAuthorityRecord", "SdkGrowthAuthorityScope"',
        ),
      ).rejects.toThrow();
      // Simulate damaged data from an older/bypassing writer without changing an immutable grant.
      await db.$executeRaw`UPDATE "SdkGrowthAuthorityRecord" SET "metadata" = jsonb_set("metadata", '{receipt}', '{}') WHERE "tenantId" = ${f.identity.tenantId}`;
      let called = false;
      await expect(
        f
          .repository()
          .transact(f.scope, { requestId: f.request.requestId }, async () => {
            called = true;
          }),
      ).rejects.toThrow();
      expect(called).toBe(false);
    });
  },
);
