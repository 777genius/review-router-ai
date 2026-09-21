import { SdkGrowthAuthority } from "../application/authority.js";
import { PrismaReceiptRepository } from "../infrastructure/prisma/prisma-receipt-repository.js";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PrismaAuthorityProvisioning,
  PrismaCurrentAuthoritySnapshot,
} from "../infrastructure/prisma/prisma-current-authority.js";
import type {
  AuthorityProvisioningPrismaClient,
  AuthorityReadTransaction,
  AuthoritySnapshotPrismaClient,
  AuthorityWriteTransaction,
} from "../infrastructure/prisma/prisma-current-authority.js";
import type {
  AuthorityChange,
  CanonicalAuthorityMaterial,
} from "../application/ports.js";

const budget = { signal: new AbortController().signal, assertActive() {} };
const unexpectedProvisioningDatabase: AuthorityProvisioningPrismaClient = {
  async $transaction<T>(): Promise<T> {
    throw new Error("unexpected transaction");
  },
};
const unexpectedSnapshotDatabase: AuthoritySnapshotPrismaClient = {
  async $transaction<T>(): Promise<T> {
    throw new Error("unexpected transaction");
  },
};
const url = process.env.SDK_GROWTH_TEST_DATABASE_URL;
const schema = `snapshot_${randomUUID().replaceAll("-", "")}`;
const clients: PrismaClient[] = [];
function client() {
  const db = new PrismaClient({
    adapter: new PrismaPg(
      { connectionString: url!, max: 2, options: `-c search_path=${schema}` },
      { schema },
    ),
    transactionOptions: { timeout: 10000 },
  });
  clients.push(db);
  return db;
}
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
    repositoryId: "repo",
    requestId: "request",
    pullRequest: 42,
  };
  const scope = {
    tenantId: identity.tenantId,
    repositoryId: "repo",
    pullRequest: 42,
  };
  const binding = {
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
    scopes: ["api"],
  };
  const state: CanonicalAuthorityMaterial = {
    binding,
    ownerEvidence: {
      version: 1,
      evidenceId: "owner-1",
      tenantId: identity.tenantId,
      ownerSubject: "owner",
      binding,
      scopes: binding.scopes,
      decision: "approved",
      sourceDigest: digest,
      issuedAt: 1,
      expiresAt: 2000,
      revoked: false,
    },
    provenance: {
      issuer: "trusted-owner-login",
      subject: "owner",
      authenticationId: "login-1",
      installationId: "installation-1",
      sourceDigest: digest,
      authorizedSubjects: ["runner"],
    },
    installationActive: true,
    verifierActive: true,
  };
  const writer = (
    connection: AuthorityProvisioningPrismaClient = db,
    load = async () => state,
  ) =>
    new PrismaAuthorityProvisioning(connection, {
      authenticateAndLoad: async (credential) => {
        if (credential !== "trusted-operator") throw new Error("unauthorized");
        return load();
      },
    });
  const reader = (connection: AuthoritySnapshotPrismaClient = db, now = 100) =>
    new PrismaCurrentAuthoritySnapshot(connection, () => now);
  return {
    identity,
    request,
    scope,
    state,
    writer,
    reader,
    key: JSON.stringify([identity.tenantId, "repo", 42]),
  };
}
function changeState(f: ReturnType<typeof fixture>, change: AuthorityChange) {
  if (change === "owner-revocation")
    Object.assign(f.state.ownerEvidence, { revoked: true });
  if (change === "owner-replacement")
    Object.assign(f.state.ownerEvidence, { evidenceId: "owner-2" });
  if (change === "binding-replacement")
    Object.assign(f.state.binding, { head: "4".repeat(40) });
  if (change === "installation-invalidation")
    Object.assign(f.state, { installationActive: false });
  if (change === "verifier-withdrawal")
    Object.assign(f.state, { verifierActive: false });
}
function persistenceRow(
  state: CanonicalAuthorityMaterial,
  epoch = 1n,
): Record<string, unknown> {
  return {
    epoch,
    binding: state.binding,
    evidence: state.ownerEvidence,
    provenance: state.provenance,
    installationActive: state.installationActive,
    verifierActive: state.verifierActive,
  };
}

describe.skipIf(!url)("canonical authority epochs / real PostgreSQL", () => {
  beforeAll(async () => {
    db = client();
    peer = client();
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
      await connection.query(
        `CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"; CREATE TABLE preserved (id integer); INSERT INTO preserved VALUES (7)`,
      );
      await connection.query(
        readFileSync(
          new URL(
            "../../../../platform/db/prisma/migrations/000101_sdk_growth_authority/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      await connection.query(
        readFileSync(
          new URL(
            "../../../../platform/db/prisma/migrations/000102_sdk_growth_current_authority/migration.sql",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      expect(await connection.query("SELECT * FROM preserved")).toMatchObject({
        rows: [{ id: 7 }],
      });
    } finally {
      await connection.end();
    }
  });
  afterAll(async () => {
    if (db)
      await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await Promise.all(clients.map((c) => c.$disconnect()));
  });
  it("persists a detached complete epoch across connections and authenticates readers", async () => {
    const f = fixture();
    expect(await f.reader().resolve(f.identity, f.request, budget)).toBeNull();
    expect(
      await f.writer().advance("trusted-operator", f.scope, 0n, "provision"),
    ).toBe(1n);
    const snapshot = await f
      .reader(peer)
      .resolve(f.identity, f.request, budget);
    expect(snapshot).toEqual({
      epoch: 1,
      binding: f.state.binding,
      ownerEvidence: f.state.ownerEvidence,
    });
    Object.assign(snapshot!.binding, { head: "9".repeat(40) });
    expect(
      (await f.reader().resolve(f.identity, f.request, budget))!.binding.head,
    ).toBe("1".repeat(40));
    for (const identity of [
      { ...f.identity, subject: "candidate" },
      { ...f.identity, tenantId: "other" },
      { ...f.identity, repositoryId: "other" },
    ])
      expect(await f.reader().resolve(identity, f.request, budget)).toBeNull();
    await expect(
      f.reader(db, 2000).resolve(f.identity, f.request, budget),
    ).rejects.toMatchObject({ code: "owner-evidence" });
    await expect(
      f.reader(db, 0).resolve(f.identity, f.request, budget),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });
  it("round-trips maximum bounded binding and owner scope metadata", async () => {
    const f = fixture();
    const scopes = Array.from(
      { length: 1024 },
      (_, i) => String(i).padStart(4, "0") + "s".repeat(252),
    );
    Object.assign(f.state.binding, { scopes });
    Object.assign(f.state.ownerEvidence, { scopes });
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    expect(await f.reader(peer).resolve(f.identity, f.request, budget)).toEqual(
      {
        epoch: 1,
        binding: f.state.binding,
        ownerEvidence: f.state.ownerEvidence,
      },
    );
  });
  it("rejects candidate material and unauthenticated ingestion without creating authority", async () => {
    const f = fixture();
    await expect(
      f.writer().advance(f.state, f.scope, 0n, "provision"),
    ).rejects.toThrow("unauthorized");
    await expect(
      f.reader().resolve(
        f.identity,
        {
          ...f.request,
          binding: f.state.binding,
        } as typeof f.request,
        budget,
      ),
    ).rejects.toThrow();
    expect(await f.reader().resolve(f.identity, f.request, budget)).toBeNull();
    Object.assign(f.state.provenance, { subject: "forged" });
    await expect(
      f.writer().advance("trusted-operator", f.scope, 0n, "provision"),
    ).rejects.toThrow();
  });
  it.each([
    "binding-replacement",
    "owner-replacement",
    "owner-revocation",
    "installation-invalidation",
    "verifier-withdrawal",
  ] as const)(
    "%s advances one shared epoch and fences a controlled in-flight read",
    async (change) => {
      const f = fixture();
      await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
      let release!: () => void;
      let entered!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const read = new Promise<void>((resolve) => {
        entered = resolve;
      });
      // Pause after the real atomic epoch read, before its final PostgreSQL fence.
      const instrumented = new Proxy(peer, {
        get(target, property) {
          if (property !== "$transaction") return Reflect.get(target, property);
          return (
            operation: (tx: unknown) => Promise<unknown>,
            options: unknown,
          ) =>
            target.$transaction(
              async (tx) => {
                let first = true;
                return operation(
                  new Proxy(tx, {
                    get(t, p) {
                      const value = Reflect.get(t, p);
                      if (p !== "$queryRaw")
                        return typeof value === "function"
                          ? value.bind(t)
                          : value;
                      return async (...args: unknown[]) => {
                        const result: unknown = await value.apply(t, args);
                        if (first) {
                          first = false;
                          entered();
                          await held;
                        }
                        return result;
                      };
                    },
                  }),
                );
              },
              options as { isolationLevel: "ReadCommitted" },
            );
        },
      });
      const resolving = f
        .reader(instrumented)
        .resolve(f.identity, f.request, budget);
      await read;
      try {
        changeState(f, change);
        expect(
          await f.writer().advance("trusted-operator", f.scope, 1n, change),
        ).toBe(2n);
      } finally {
        release();
      }
      expect(await resolving).toBeNull();
      const rows = await db.$queryRaw<
        Array<{ epoch: bigint }>
      >`SELECT "epoch" FROM "SdkGrowthOwnerVersion" WHERE "scopeKey" = ${f.key} ORDER BY "epoch"`;
      expect(rows.map((r) => r.epoch)).toEqual([1n, 2n]);
      if (change === "owner-revocation")
        await expect(
          f.reader().resolve(f.identity, f.request, budget),
        ).rejects.toThrow();
      else if (
        change === "installation-invalidation" ||
        change === "verifier-withdrawal"
      )
        expect(
          await f.reader().resolve(f.identity, f.request, budget),
        ).toBeNull();
      else
        expect(await f.reader().resolve(f.identity, f.request, budget)).toEqual(
          {
            epoch: 2,
            binding: f.state.binding,
            ownerEvidence: f.state.ownerEvidence,
          },
        );
    },
  );
  it.each([
    "binding-replacement",
    "owner-replacement",
    "owner-revocation",
    "installation-invalidation",
    "verifier-withdrawal",
  ] as const)(
    "application completion rejects authority after %s",
    async (change) => {
      const f = fixture();
      await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
      const authority = new SdkGrowthAuthority(
        {
          currentAuthority: f.reader(),
          receipts: new PrismaReceiptRepository(peer),
          clock: { now: () => 100 },
          publication: {
            enqueue: async () => {
              throw new Error("publication out of scope");
            },
          },
        },
        1000,
      );
      const grant = await authority.request(f.identity, f.request);
      changeState(f, change);
      await f.writer().advance("trusted-operator", f.scope, 1n, change);
      await expect(
        authority.complete(f.identity, {
          version: 1,
          grantId: grant.grantId,
          fence: grant.fence,
          binding: grant.binding,
          coveredScopes: grant.binding.scopes,
          coverage: "complete",
          outcome: "passed",
          reportDigest: digest,
        }),
      ).rejects.toThrow();
      // Historical replay does not restore authority or replace its immutable grant.
      expect(await authority.request(f.identity, f.request)).toEqual(grant);
    },
  );
  it("CAS prevents delayed ingestion and concurrent replacement from overwriting newer authority", async () => {
    const f = fixture();
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    changeState(f, "owner-replacement");
    const results = await Promise.allSettled([
      f.writer().advance("trusted-operator", f.scope, 1n, "owner-replacement"),
      f
        .writer(peer)
        .advance("trusted-operator", f.scope, 1n, "owner-replacement"),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "conflict" },
    });
    expect(
      await db.$queryRaw`SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${f.key}`,
    ).toEqual([{ epoch: 2n }]);
  });
  it("rejects a controlled delayed authenticated load after invalidation commits", async () => {
    const f = fixture();
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    const stale = structuredClone(f.state);
    let release!: () => void;
    let entered!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const loading = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const delayed = f
      .writer(peer, async () => {
        entered();
        await held;
        return stale;
      })
      .advance("trusted-operator", f.scope, 1n, "owner-replacement")
      .then(
        () => null,
        (error: unknown) => error,
      );
    await loading;
    try {
      changeState(f, "installation-invalidation");
      await f
        .writer()
        .advance("trusted-operator", f.scope, 1n, "installation-invalidation");
    } finally {
      release();
    }
    expect(await delayed).toMatchObject({ code: "conflict" });
    expect(await f.reader().resolve(f.identity, f.request, budget)).toBeNull();
  });
  it.each([
    "verifierDigest",
    "policyDigest",
    "toolDigest",
    "artifactDigest",
    "lockDigest",
    "historyDigest",
    "scopeDigest",
  ] as const)(
    "retains canonical %s custody through replacement",
    async (field) => {
      const f = fixture();
      await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
      Object.assign(f.state.binding, { [field]: `sha256:${"b".repeat(64)}` });
      await f
        .writer()
        .advance("trusted-operator", f.scope, 1n, "binding-replacement");
      expect(
        (await f.reader().resolve(f.identity, f.request, budget))!.binding[
          field
        ],
      ).toBe(`sha256:${"b".repeat(64)}`);
    },
  );
  it("retains rejected owner decisions but never resolves them as authority", async () => {
    const f = fixture();
    Object.assign(f.state.ownerEvidence, { decision: "rejected" });
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    await expect(
      f.reader().resolve(f.identity, f.request, budget),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });
  it("rejects malformed, cross-scope and mismatched custody without creating a pointer", async () => {
    const mutations = [
      (f: ReturnType<typeof fixture>) =>
        Object.assign(f.state.binding, { policyDigest: "untrusted" }),
      (f: ReturnType<typeof fixture>) =>
        Object.assign(f.state.binding, { repositoryId: "other" }),
      (f: ReturnType<typeof fixture>) =>
        Object.assign(f.state.ownerEvidence, { tenantId: "other" }),
      (f: ReturnType<typeof fixture>) =>
        Object.assign(f.state.ownerEvidence, { scopes: ["other"] }),
      (f: ReturnType<typeof fixture>) =>
        Object.assign(f.state.ownerEvidence, {
          binding: { ...f.state.binding, head: "9".repeat(40) },
        }),
      (f: ReturnType<typeof fixture>) =>
        Object.assign(f.state.provenance, {
          sourceDigest: `sha256:${"b".repeat(64)}`,
        }),
    ];
    for (const mutate of mutations) {
      const f = fixture();
      mutate(f);
      await expect(
        f.writer().advance("trusted-operator", f.scope, 0n, "provision"),
      ).rejects.toThrow();
      expect(
        await f.reader().resolve(f.identity, f.request, budget),
      ).toBeNull();
    }
  });
  it("rolls back partial inserts on a database failure without advancing the pointer", async () => {
    const f = fixture();
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    changeState(f, "owner-replacement");
    // Occupy a future immutable key to force the version insert to fail.
    await db.$executeRaw`INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding") VALUES (${f.key}, 2, ${JSON.stringify(f.state.binding)}::jsonb)`;
    await expect(
      f.writer().advance("trusted-operator", f.scope, 1n, "owner-replacement"),
    ).rejects.toThrow();
    expect(
      await db.$queryRaw`SELECT "epoch" FROM "SdkGrowthCurrentAuthority" WHERE "scopeKey" = ${f.key}`,
    ).toEqual([{ epoch: 1n }]);
    expect(
      await f.reader().resolve(f.identity, f.request, budget),
    ).not.toBeNull();
  });
  it("database guards immutable versions, complete pointers and monotonic epochs", async () => {
    const f = fixture();
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    await expect(
      db.$executeRaw`UPDATE "SdkGrowthBindingVersion" SET "binding" = '{}' WHERE "scopeKey" = ${f.key}`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`DELETE FROM "SdkGrowthOwnerVersion" WHERE "scopeKey" = ${f.key}`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = 0 WHERE "scopeKey" = ${f.key}`,
    ).rejects.toThrow();
    await expect(
      db.$executeRaw`UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = 2 WHERE "scopeKey" = ${f.key}`,
    ).rejects.toThrow();
    await expect(
      db.$executeRawUnsafe('TRUNCATE "SdkGrowthCurrentAuthority" CASCADE'),
    ).rejects.toThrow();
    expect(
      await f.reader().resolve(f.identity, f.request, budget),
    ).not.toBeNull();
  });
  it("database rejects a reason that does not describe an actual transition", async () => {
    const f = fixture();
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    await db.$executeRaw`INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding") VALUES (${f.key}, 2, ${JSON.stringify(f.state.binding)}::jsonb)`;
    await db.$executeRaw`INSERT INTO "SdkGrowthOwnerVersion" ("scopeKey", "epoch", "evidence", "provenance", "installationActive", "verifierActive", "reason") VALUES (${f.key}, 2, ${JSON.stringify(f.state.ownerEvidence)}::jsonb, ${JSON.stringify(f.state.provenance)}::jsonb, true, true, 'binding-replacement')`;
    await expect(
      db.$executeRaw`UPDATE "SdkGrowthCurrentAuthority" SET "epoch" = 2 WHERE "scopeKey" = ${f.key}`,
    ).rejects.toThrow("authority reason does not match transition");
  });
  it("resolves completeness in the trigger table schema, not the caller search path", async () => {
    const f = fixture();
    await f.writer().advance("trusted-operator", f.scope, 0n, "provision");
    await db.$executeRaw`INSERT INTO "SdkGrowthBindingVersion" ("scopeKey", "epoch", "binding") VALUES (${f.key}, 2, ${JSON.stringify({ ...f.state.binding, head: "4".repeat(40) })}::jsonb)`;
    const hostile = `${schema}_hostile`;
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
      await connection.query(
        `CREATE SCHEMA "${hostile}"; CREATE TABLE "${hostile}"."SdkGrowthOwnerVersion" ("scopeKey" text, "epoch" bigint, "evidence" jsonb, "provenance" jsonb, "installationActive" boolean, "verifierActive" boolean, "reason" text); INSERT INTO "${hostile}"."SdkGrowthOwnerVersion" VALUES ('${f.key.replaceAll("'", "''")}', 2, '{}', '{}', true, true, 'binding-replacement'); SET search_path TO "${hostile}"`,
      );
      await expect(
        connection.query(
          `UPDATE "${schema}"."SdkGrowthCurrentAuthority" SET "epoch" = 2 WHERE "scopeKey" = '${f.key.replaceAll("'", "''")}'`,
        ),
      ).rejects.toThrow("incomplete authority epoch");
    } finally {
      await connection.query(`DROP SCHEMA "${hostile}" CASCADE`);
      await connection.end();
    }
  });
});

describe("snapshot trust boundary", () => {
  it.each(["material", "provenance", "subjects", "binding", "owner"])(
    "rejects accessors at %s without executing them",
    async (location) => {
      const f = fixture();
      const targets: Record<string, object> = {
        material: f.state,
        provenance: f.state.provenance,
        subjects: f.state.provenance.authorizedSubjects,
        binding: f.state.binding,
        owner: f.state.ownerEvidence,
      };
      let reads = 0;
      Object.defineProperty(targets[location]!, "unexpected", {
        enumerable: true,
        get() {
          reads++;
          throw new Error("executed");
        },
      });
      await expect(
        f
          .writer(unexpectedProvisioningDatabase)
          .advance("trusted-operator", f.scope, 0n, "provision"),
      ).rejects.toMatchObject({ code: "invalid-contract" });
      expect(reads).toBe(0);
    },
  );
  it.each([
    ["material", "symbol"],
    ["binding", "symbol"],
    ["owner", "symbol"],
    ["provenance", "symbol"],
    ["subjects", "symbol"],
    ["material", "prototype"],
    ["binding", "prototype"],
    ["owner", "prototype"],
    ["provenance", "prototype"],
    ["subjects", "prototype"],
    ["provenance", "hidden"],
    ["subjects", "hole"],
  ] as const)("rejects forbidden %s shape %s", async (location, shape) => {
    const f = fixture();
    const targets = {
      material: f.state,
      binding: f.state.binding,
      owner: f.state.ownerEvidence,
      provenance: f.state.provenance,
      subjects: f.state.provenance.authorizedSubjects,
    } as const;
    const target = targets[location];
    if (shape === "symbol")
      Object.defineProperty(target, Symbol("hidden"), {
        value: 1,
      });
    if (shape === "prototype") Object.setPrototypeOf(target, { custom: true });
    if (shape === "hidden")
      Object.defineProperty(target, "hidden", { value: 1 });
    if (shape === "hole") delete (target as string[])[0];
    await expect(
      f
        .writer(unexpectedProvisioningDatabase)
        .advance("trusted-operator", f.scope, 0n, "provision"),
    ).rejects.toMatchObject({ code: "invalid-contract" });
  });
  it("rejects proxies before reflection can execute a trap or replace inspected material", async () => {
    const f = fixture();
    let traps = 0;
    const original = f.state.provenance;
    const proxy = new Proxy(original, {
      ownKeys() {
        traps++;
        Object.assign(f.state, {
          provenance: { ...original, authorizedSubjects: ["intruder"] },
        });
        return Reflect.ownKeys(original);
      },
      getOwnPropertyDescriptor(target, property) {
        traps++;
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      getPrototypeOf(target) {
        traps++;
        return Reflect.getPrototypeOf(target);
      },
    });
    Object.assign(f.state, { provenance: proxy });
    await expect(
      f
        .writer(unexpectedProvisioningDatabase)
        .advance("trusted-operator", f.scope, 0n, "provision"),
    ).rejects.toMatchObject({ code: "invalid-contract" });
    expect(traps).toBe(0);
    expect(f.state.provenance).toBe(proxy);
  });
  it("rejects storage accessors without executing them", async () => {
    const f = fixture();
    let reads = 0;
    const row = {
      epoch: 1n,
      evidence: f.state.ownerEvidence,
      provenance: f.state.provenance,
      installationActive: true,
      verifierActive: true,
    };
    Object.defineProperty(row, "binding", {
      enumerable: true,
      get() {
        reads++;
        return f.state.binding;
      },
    });
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityReadTransaction) => Promise<T>,
      ) => operation({ $queryRaw: async () => [row] }),
    };
    await expect(
      f.reader(fake).resolve(f.identity, f.request, budget),
    ).rejects.toMatchObject({ code: "invalid-contract" });
    expect(reads).toBe(0);
  });
  it("rejects a fence-row accessor without executing it", async () => {
    const f = fixture();
    let reads = 0;
    const fence = {};
    Object.defineProperty(fence, "epoch", {
      enumerable: true,
      get() {
        reads++;
        return 1n;
      },
    });
    const rows = [[persistenceRow(f.state)], [fence]];
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityReadTransaction) => Promise<T>,
      ) =>
        operation({
          $queryRaw: async () => rows.shift() ?? [],
        }),
    };
    await expect(
      f.reader(fake).resolve(f.identity, f.request, budget),
    ).rejects.toMatchObject({ code: "invalid-contract" });
    expect(reads).toBe(0);
  });
  it("rejects a provisioning pointer accessor without executing it", async () => {
    const f = fixture();
    let reads = 0;
    const pointer = {};
    Object.defineProperty(pointer, "epoch", {
      enumerable: true,
      get() {
        reads++;
        return 0n;
      },
    });
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityWriteTransaction) => Promise<T>,
      ) =>
        operation({
          $queryRaw: async () => [pointer],
          $executeRaw: async () => 1,
        }),
    };
    await expect(
      f.writer(fake).advance("trusted-operator", f.scope, 0n, "provision"),
    ).rejects.toMatchObject({ code: "invalid-contract" });
    expect(reads).toBe(0);
  });
  it.each([
    ["null", null],
    ["object", { runner: true }],
    ["scalar", "runner"],
    ["mixed array", ["runner", 1]],
    ["empty array", []],
  ])(
    "rejects malformed persisted authorized subjects: %s",
    async (_, subjects) => {
      const f = fixture();
      const row = {
        epoch: 1n,
        binding: f.state.binding,
        evidence: f.state.ownerEvidence,
        provenance: {
          ...f.state.provenance,
          authorizedSubjects: subjects,
        },
        installationActive: true,
        verifierActive: true,
      };
      const fake = {
        $transaction: async <T>(
          operation: (tx: AuthorityReadTransaction) => Promise<T>,
        ) => operation({ $queryRaw: async () => [row] }),
      };
      await expect(
        f.reader(fake).resolve(f.identity, f.request, budget),
      ).rejects.toMatchObject({ code: "invalid-contract" });
    },
  );
  it.each([
    ["runner", "runner"],
    ["runner", "candidate"],
  ])(
    "rejects noncanonical authorized subject custody %j",
    async (...subjects) => {
      const f = fixture();
      Object.assign(f.state.provenance, { authorizedSubjects: subjects });
      await expect(
        f
          .writer(unexpectedProvisioningDatabase)
          .advance("trusted-operator", f.scope, 0n, "provision"),
      ).rejects.toMatchObject({ code: "invalid-contract" });
    },
  );
  it("preserves an aborted read as io-timeout with no effect", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(
      f.reader(unexpectedSnapshotDatabase).resolve(f.identity, f.request, {
        signal: controller.signal,
        assertActive() {},
      }),
    ).rejects.toMatchObject({ code: "io-timeout", effect: "none" });
  });
});

describe("cooperative snapshot read budget", () => {
  it("rejects an abort during a database read before returning missing authority", async () => {
    const f = fixture();
    const controller = new AbortController();
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityReadTransaction) => Promise<T>,
      ) =>
        operation({
          $queryRaw: async () => {
            controller.abort();
            return [];
          },
        }),
    };
    await expect(
      f.reader(fake).resolve(f.identity, f.request, {
        signal: controller.signal,
        assertActive() {},
      }),
    ).rejects.toMatchObject({ code: "io-timeout", effect: "none" });
  });
  it("detaches ingestion material before the transaction can mutate its source", async () => {
    const f = fixture();
    const originalHead = f.state.binding.head;
    const values: unknown[][] = [];
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityWriteTransaction) => Promise<T>,
      ) => {
        Object.assign(f.state.binding, { head: "9".repeat(40) });
        (f.state.provenance.authorizedSubjects as string[]).push("intruder");
        return operation({
          $queryRaw: async () => [{ epoch: 0n }],
          $executeRaw: async (_sql: unknown, ...params: unknown[]) => {
            values.push(params);
            return 1;
          },
        });
      },
    };
    await f.writer(fake).advance("trusted-operator", f.scope, 0n, "provision");
    expect(JSON.parse(values[1]![2] as string).head).toBe(originalHead);
    expect(JSON.parse(values[2]![3] as string).authorizedSubjects).toEqual([
      "runner",
    ]);
  });
});

describe("authority transition policy", () => {
  it.each([
    ["provision", () => {}],
    ["binding-replacement", () => {}],
    ["owner-replacement", () => {}],
    [
      "owner-revocation",
      (state: CanonicalAuthorityMaterial) =>
        Object.assign(state.ownerEvidence, {
          evidenceId: "unrelated",
          revoked: true,
        }),
    ],
    [
      "installation-invalidation",
      (state: CanonicalAuthorityMaterial) => {
        Object.assign(state, { installationActive: false });
        Object.assign(state.ownerEvidence, { evidenceId: "unrelated" });
      },
    ],
    [
      "verifier-withdrawal",
      (state: CanonicalAuthorityMaterial) =>
        Object.assign(state, {
          installationActive: false,
          verifierActive: false,
        }),
    ],
  ] as const)("rejects an inaccurate %s reason", async (change, mutate) => {
    const f = fixture();
    const previous = structuredClone(f.state);
    mutate(f.state);
    const queryRows = [[{ epoch: 1n }], [persistenceRow(previous)]];
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityWriteTransaction) => Promise<T>,
      ) =>
        operation({
          $queryRaw: async () => queryRows.shift() ?? [],
          $executeRaw: async () => 1,
        }),
    };
    await expect(
      f.writer(fake).advance("trusted-operator", f.scope, 1n, change),
    ).rejects.toMatchObject({ code: "invalid-contract" });
  });
  it("rejects a non-provision reason for an empty authority", async () => {
    const f = fixture();
    const fake = {
      $transaction: async <T>(
        operation: (tx: AuthorityWriteTransaction) => Promise<T>,
      ) =>
        operation({
          $queryRaw: async () => [{ epoch: 0n }],
          $executeRaw: async () => 1,
        }),
    };
    await expect(
      f
        .writer(fake)
        .advance("trusted-operator", f.scope, 0n, "owner-replacement"),
    ).rejects.toMatchObject({ code: "invalid-contract" });
  });
  it.each(["binding-replacement", "owner-replacement"] as const)(
    "rejects revocation hidden inside %s",
    async (change) => {
      const f = fixture();
      const previous = structuredClone(f.state);
      if (change === "binding-replacement")
        Object.assign(f.state.binding, { head: "4".repeat(40) });
      else Object.assign(f.state.ownerEvidence, { evidenceId: "owner-2" });
      Object.assign(f.state.ownerEvidence, { revoked: true });
      const queryRows = [[{ epoch: 1n }], [persistenceRow(previous)]];
      const fake = {
        $transaction: async <T>(
          operation: (tx: AuthorityWriteTransaction) => Promise<T>,
        ) =>
          operation({
            $queryRaw: async () => queryRows.shift() ?? [],
            $executeRaw: async () => 1,
          }),
      };
      await expect(
        f.writer(fake).advance("trusted-operator", f.scope, 1n, change),
      ).rejects.toMatchObject({ code: "invalid-contract" });
    },
  );
});
