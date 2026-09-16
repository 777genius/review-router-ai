import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  composeCertifiedForkEffectProofs,
  type CertifiedForkEffectProofCompositionDependencies as Dependencies,
  type CertifiedForkCompositionCurrent,
} from "./certified-fork-effect-proof-composition.js";
import {
  coldHistoryFixture,
  controlledColdSource,
  copy,
  h,
} from "../../../packages/features/action-control-plane/src/tests/support/certified-fork-cold-history.js";
import { archiveRow } from "../../../packages/features/action-control-plane/src/tests/support/certified-fork-archive-fixture.js";
import {
  canonicalRetainedBytes,
  factSha256,
  factSourceSha256,
  type AnyRetainedFactInput,
} from "../../../packages/features/action-control-plane/src/infrastructure/prisma/certified-fork-proof-fact-types.js";
import type { RetainedFactSql } from "../../../packages/features/action-control-plane/src/infrastructure/prisma/certified-fork-proof-fact-store.js";
import type { ForkHistoryProducers } from "../../../packages/features/action-control-plane/src/infrastructure/prisma/certified-fork-history-loader.js";
import type { RestoredForkHistory } from "../../../packages/features/action-control-plane/src/infrastructure/proofs/restore-certified-fork-checkpoint.js";
import { historicalForkCommandReference } from "../../../packages/features/action-control-plane/src/infrastructure/proofs/restore-certified-fork-checkpoint.js";

let fixture: Awaited<ReturnType<typeof coldHistoryFixture>>;
beforeAll(async () => {
  fixture = await coldHistoryFixture({ refresh: "expiry" });
});
function factRow(fact: AnyRetainedFactInput): Record<string, unknown> {
  const bytes = canonicalRetainedBytes(fact.payload);
  return {
    ...fact,
    ...fact.scope,
    ...fact.provenance,
    formatVersion: 1,
    proofSha256: factSha256(fact.proofId),
    sourceSha256: factSourceSha256(fact),
    canonicalBytes: bytes,
    payloadHash: factSha256(bytes).toString("hex"),
    createdAtMs: "1",
  };
}

// Controlled SQL and fixed, separately held test producers. No live credentials,
// DB, provider, HMAC or production source authentication is claimed by this suite.
async function setup() {
  const disk = copy(fixture.disk);
  disk.versions = disk.versions.slice(0, Number(fixture.duplicateVersion));
  const target = disk.versions.pop()!;
  const tip = disk.versions.at(-1)!;
  const source = await controlledColdSource(fixture.disk).open(
    fixture.familyKey,
  );
  const events: string[] = [];
  const state = {
    principal: tip.receipt.ownerHash,
    revoked: false,
    at: target.committedAt,
    rollback: false,
    denyRetention: false,
    wrongCommand: false,
    asyncGuard: false,
    repositoryTip: tip,
    facts: Object.values(disk.facts).map(factRow),
    retained: [] as AnyRetainedFactInput[],
    captured: undefined as RestoredForkHistory | undefined,
  };
  const rows = (v: typeof tip) => ({
    ...archiveRow(v),
    proofSha256: factSha256(v.snapshot.checkpoint!.proof),
  });
  const reader: RetainedFactSql = {
    async query(sql, values) {
      events.push("committed-read");
      if (sql.includes('FROM public."CertifiedForkFamily"'))
        return { rows: [{ tipVersion: tip.snapshot.version }] };
      if (sql.includes('FROM public."CertifiedForkVersion"'))
        return { rows: disk.versions.map(rows) };
      if (sql.includes('FROM public."CertifiedForkProofFact"'))
        return {
          rows: state.facts.filter((r) =>
            Buffer.from(r.proofSha256 as Uint8Array).equals(
              values[0] as Buffer,
            ),
          ),
        };
      throw new Error("unexpected_reader_sql");
    },
  };
  const writer: RetainedFactSql = {
    async query(sql, values) {
      events.push("repository-sql");
      if (sql.startsWith('SELECT "tipVersion"'))
        return { rows: [{ tipVersion: state.repositoryTip.snapshot.version }] };
      if (sql.includes('FROM public."CertifiedForkReceipt"')) {
        const original = disk.versions.find(
          (v) => v.receipt.commandId === values[1],
        );
        return {
          rows: original ? [{ version: original.snapshot.version }] : [],
        };
      }
      if (sql.includes('FROM public."CertifiedForkVersion"')) {
        const v =
          values[1] === state.repositoryTip.snapshot.version
            ? state.repositoryTip
            : disk.versions.find((v) => v.snapshot.version === values[1]);
        return { rows: v ? [rows(v)] : [] };
      }
      if (sql.includes("clock_timestamp()"))
        return { rows: [{ at: String(state.at) }] };
      if (sql.startsWith('INSERT INTO public."CertifiedForkProofFact"')) {
        events.push("fact-insert");
        const fact = state.retained.find((f) => f.proofId === values[2]);
        if (!fact) throw new Error("unendorsed_insert");
        return { rows: [factRow(fact)] };
      }
      if (sql.startsWith('INSERT INTO public."CertifiedForkVersion"'))
        events.push("archive-insert");
      return { rows: [] };
    },
  };
  const producers: ForkHistoryProducers = {
    admission: (_history, r) => source.admission(r.fact.scope, r.fact.proofId),
    command: (_history, r) => source.command(r.fact.scope, r.fact.proofId),
    authority: (_history, r) => source.authority(r.fact.scope, r.fact.proofId),
    evidence: (_history, r, origin) =>
      source.evidence(r.fact.scope, r.fact.proofId, origin),
    inventory: (_history, r, event) =>
      source.inventory(r.fact.scope, r.fact.proofId, event),
    output: (_history, r, command) =>
      source.output(r.fact.scope, r.fact.proofId, command),
  };
  const unavailable = () => {
    throw new Error("unused_test_current_method");
  };
  const current: CertifiedForkCompositionCurrent = {
    proofs: {
      issueCheckpoint(snapshot, checkpoint, position) {
        events.push("checkpoint");
        expect(snapshot.version).toBe(target.snapshot.version);
        expect(checkpoint).toEqual(target.snapshot.checkpoint!.state);
        expect(position).toEqual(target.snapshot.checkpoint!.position);
        return target.snapshot.checkpoint!;
      },
      ownership: unavailable,
      admission: unavailable,
      authorize: unavailable,
      authority: unavailable,
      evidence: unavailable,
      inventory: unavailable,
      durability: unavailable,
      retainedOutput: unavailable,
      mutation: unavailable,
    },
    async lockScope(sql, family) {
      expect(sql).toBe(writer);
      expect(family).toBe(fixture.familyKey);
      events.push("lock");
      return {
        assertRead(_at, owner) {
          events.push("read-principal");
          if (state.revoked || (owner !== null && state.principal !== owner))
            throw new Error("principal_mismatch");
        },
        close() {
          events.push("close");
        },
        async prepareCommand(connection, command, previous, operation) {
          expect(connection).toBe(writer);
          expect(previous).toEqual(tip);
          expect(operation).toBe(target.operation);
          expect(command.commandId).toBe(target.receipt.commandId);
          events.push("prepare-command");
          return {
            run(_at, work) {
              events.push("bind");
              try {
                return work();
              } finally {
                events.push("unbind");
              }
            },
            assertStorage(at) {
              events.push("storage-guard");
              if (state.asyncGuard) return Promise.resolve() as unknown as void;
              if (
                state.revoked ||
                state.principal !== tip.snapshot.claim!.ownerHash
              )
                throw new Error("current_denied");
              if (at >= tip.snapshot.claim!.expiresAt)
                throw new Error("lease_expired");
            },
            async authenticateRetention(version) {
              events.push("authenticate-retention");
              if (state.denyRetention) throw new Error("source_custody_denied");
              expect(version).toEqual(target);
              const proof = historicalForkCommandReference(
                fixture.familyKey,
                target.snapshot.version,
                target.receipt.commandId,
              );
              // Fixed controlled producer endorses exact immutable fixture command.
              state.retained = [copy(fixture.disk.facts[proof]!)];
              if (state.wrongCommand)
                Object.assign(state.retained[0]!.payload, {
                  commandId: "substituted-command",
                });
              return state.retained;
            },
          };
        },
      };
    },
  };
  const dependencies: Dependencies = {
    async withCommittedReader(work) {
      events.push("reader-open");
      try {
        return await work(reader);
      } finally {
        events.push("reader-close");
      }
    },
    async assertCurrentRead() {
      if (state.revoked) throw new Error("read_denied");
      events.push("read-guard");
    },
    producers,
    transactions: {
      async run(mode, work) {
        events.push(`transaction-${mode}`);
        try {
          const result = await work(writer);
          if (state.rollback) throw new Error("rollback");
          events.push("commit");
          return result;
        } catch (error) {
          events.push("rollback");
          throw error;
        }
      },
    },
    current(history) {
      events.push("restored");
      state.captured = history;
      return current;
    },
  };
  const command = {
    familyKey: fixture.familyKey,
    commandId: target.receipt.commandId,
    commandHash: target.receipt.commandHash,
    expected: tip.comparison,
  };
  const build = vi.fn((proofs, snapshot) => {
    events.push("build");
    const restored = proofs.restoreCheckpoint(snapshot.checkpoint, snapshot);
    return { snapshot: target.snapshot, state: restored };
  });
  return {
    dependencies,
    state,
    events,
    current,
    reader,
    tip,
    target,
    command,
    build,
    facade: () => composeCertifiedForkEffectProofs(dependencies),
  };
}

describe("disabled internal certified fork durable proof composition", () => {
  it("constructs without I/O; restores before transactions, rechecks storage and authenticates before retention", async () => {
    const t = await setup(),
      facade = t.facade();
    expect(t.events).toEqual([]);
    const result = await facade.transact(
      t.target.operation,
      t.command,
      t.build,
    );
    expect(result.snapshot).toEqual(t.target.snapshot);
    expect(t.build).toHaveBeenCalledTimes(1);
    for (const [a, b] of [
      ["reader-close", "restored"],
      ["restored", "transaction-write"],
      ["lock", "prepare-command"],
      ["storage-guard", "build"],
      ["build", "checkpoint"],
      ["unbind", "authenticate-retention"],
      ["authenticate-retention", "fact-insert"],
      ["fact-insert", "archive-insert"],
      ["archive-insert", "commit"],
      ["commit", "close"],
    ]) {
      expect(t.events.indexOf(a!)).toBeGreaterThanOrEqual(0);
      expect(t.events.indexOf(a!)).toBeLessThan(t.events.indexOf(b!));
    }
    expect(() =>
      t.state.captured!.proofs.verifyLedger(t.target.snapshot),
    ).toThrow();
  });

  it("restores with every class producer bound to its original receiver", async () => {
    const t = await setup();
    class Producers implements ForkHistoryProducers {
      readonly #delegate = t.dependencies.producers;
      readonly calls = new Set<keyof ForkHistoryProducers>();
      admission(...args: Parameters<ForkHistoryProducers["admission"]>) {
        expect(this).toBe(producers);
        this.calls.add("admission");
        return this.#delegate.admission(...args);
      }
      authority(...args: Parameters<ForkHistoryProducers["authority"]>) {
        expect(this).toBe(producers);
        this.calls.add("authority");
        return this.#delegate.authority(...args);
      }
      evidence(...args: Parameters<ForkHistoryProducers["evidence"]>) {
        expect(this).toBe(producers);
        this.calls.add("evidence");
        return this.#delegate.evidence(...args);
      }
      inventory(...args: Parameters<ForkHistoryProducers["inventory"]>) {
        expect(this).toBe(producers);
        this.calls.add("inventory");
        return this.#delegate.inventory(...args);
      }
      output(...args: Parameters<ForkHistoryProducers["output"]>) {
        expect(this).toBe(producers);
        this.calls.add("output");
        return this.#delegate.output(...args);
      }
      command(...args: Parameters<ForkHistoryProducers["command"]>) {
        expect(this).toBe(producers);
        this.calls.add("command");
        return this.#delegate.command(...args);
      }
    }
    const producers = new Producers();
    t.dependencies.producers = producers;
    const facade = t.facade();
    expect(t.events).toEqual([]);
    // Replacing the instance's methods must not change the captured bindings.
    for (const kind of [
      "admission",
      "authority",
      "evidence",
      "inventory",
      "output",
      "command",
    ] as const) {
      expect(Object.hasOwn(producers, kind)).toBe(false);
      producers[kind] = () => {
        throw new Error("replaced_producer");
      };
    }
    const result = await facade.loadReview(fixture.familyKey);
    expect(result.snapshot).toEqual(t.tip.snapshot);
    expect(t.state.captured).toBeDefined();
    expect([...producers.calls].sort()).toEqual([
      "admission",
      "authority",
      "command",
      "evidence",
      "inventory",
      "output",
    ]);
    expect(t.events.indexOf("restored")).toBeLessThan(
      t.events.indexOf("transaction-read"),
    );
  });

  it("recovers the ORIGINAL receipt owner after current lease expiry", async () => {
    const t = await setup();
    const original = fixture.disk.versions[0]!;
    expect(original.receipt.ownerHash).not.toBe(t.tip.receipt.ownerHash);
    t.state.principal = original.receipt.ownerHash;
    t.state.at = Number.MAX_SAFE_INTEGER;
    const result = await t
      .facade()
      .loadReview(fixture.familyKey, original.receipt.commandId);
    expect(result.receipt).toEqual(original.receipt);
    expect(result.snapshot).toEqual(t.tip.snapshot);
    expect(t.events).not.toContain("storage-guard");
    expect(t.events).not.toContain("fact-insert");
  });

  it("rejects a current principal who knows the historical receipt hash but is not its owner", async () => {
    const t = await setup();
    t.state.principal = h(999);
    await expect(
      t
        .facade()
        .loadReview(
          fixture.familyKey,
          fixture.disk.versions[0]!.receipt.commandId,
        ),
    ).rejects.toThrow("principal_mismatch");
    expect(t.events).not.toContain("commit");
  });

  it.each(["principal", "expired", "async"])(
    "fails closed at storage for %s before build",
    async (fault) => {
      const t = await setup();
      if (fault === "principal") t.state.principal = h(999);
      if (fault === "expired") t.state.at = Number.MAX_SAFE_INTEGER;
      if (fault === "async") t.state.asyncGuard = true;
      await expect(
        t.facade().transact(t.target.operation, t.command, t.build),
      ).rejects.toThrow();
      expect(t.build).not.toHaveBeenCalled();
      expect(t.events).not.toContain("fact-insert");
    },
  );

  it.each(["rollback", "siblings", "owner", "advance"])(
    "rejects changed committed %s before build",
    async (fault) => {
      const t = await setup();
      const changed = copy(t.tip);
      if (fault === "rollback")
        t.state.repositoryTip = fixture.disk.versions[0]!;
      if (fault === "advance") t.state.repositoryTip = t.target;
      if (fault === "siblings") {
        Object.assign(changed.comparison, { revisions: [] });
        t.state.repositoryTip = changed;
      }
      if (fault === "owner") {
        Object.assign(changed.receipt, { ownerHash: h(999) });
        t.state.repositoryTip = changed;
      }
      await expect(
        t.facade().transact(t.target.operation, t.command, t.build),
      ).rejects.toThrow();
      expect(t.build).not.toHaveBeenCalled();
    },
  );

  it("never promotes staged facts after rollback and cold-reads the next operation", async () => {
    const t = await setup(),
      facade = t.facade();
    t.state.rollback = true;
    await expect(
      facade.transact(t.target.operation, t.command, t.build),
    ).rejects.toThrow("rollback");
    expect(t.events).toContain("fact-insert");
    expect(() =>
      t.state.captured!.proofs.verifyLedger(t.target.snapshot),
    ).toThrow();
    t.state.rollback = false;
    const result = await facade.loadReview(
      fixture.familyKey,
      t.target.receipt.commandId,
    );
    expect(result.receipt).toBeNull();
    expect(result.snapshot).toEqual(t.tip.snapshot);
    expect(t.events.filter((e) => e === "reader-open")).toHaveLength(2);
  });

  it("does not retain unauthenticated source facts", async () => {
    const t = await setup();
    t.state.denyRetention = true;
    await expect(
      t.facade().transact(t.target.operation, t.command, t.build),
    ).rejects.toThrow("source_custody_denied");
    expect(t.events).not.toContain("fact-insert");
    expect(t.events).not.toContain("archive-insert");
  });

  it("cannot resolve a staged/missing fact through the committed reader even when the producer knows it", async () => {
    const t = await setup();
    t.state.facts = [];
    await expect(t.facade().loadReview(fixture.familyKey)).rejects.toThrow();
    expect(t.events).not.toContain("transaction-read");
  });

  it("rejects producer provenance even when SQL hashes are valid", async () => {
    const t = await setup();
    t.dependencies.producers.command = async () => {
      throw new Error("unknown_source_version");
    };
    await expect(t.facade().loadReview(fixture.familyKey)).rejects.toThrow(
      "unknown_source_version",
    );
    expect(t.events).not.toContain("transaction-read");
  });

  it.each([
    "withCommittedReader",
    "assertCurrentRead",
    "current",
    "transactions",
    ...[
      "admission",
      "authority",
      "command",
      "output",
      "evidence",
      "inventory",
    ].map((k) => `producer:${k}`),
  ])("rejects missing construction dependency %s", async (key) => {
    const t = await setup();
    if (key.startsWith("producer:"))
      delete (t.dependencies.producers as unknown as Record<string, unknown>)[
        key.slice(9)
      ];
    else delete (t.dependencies as unknown as Record<string, unknown>)[key];
    expect(() => t.facade()).toThrow();
    expect(t.events).toEqual([]);
  });

  it("rejects incomplete current proof ports before entering the repository", async () => {
    const t = await setup();
    delete (t.current.proofs as unknown as Record<string, unknown>).ownership;
    await expect(t.facade().loadReview(fixture.familyKey)).rejects.toThrow();
    expect(t.events).not.toContain("transaction-read");
  });

  it("rejects a substituted command fact before any fact INSERT", async () => {
    const t = await setup();
    t.state.wrongCommand = true;
    await expect(
      t.facade().transact(t.target.operation, t.command, t.build),
    ).rejects.toThrow();
    expect(t.events).toContain("authenticate-retention");
    expect(t.events).not.toContain("fact-insert");
  });

  it("checks revocation after preparation, at the actual synchronous storage boundary", async () => {
    const t = await setup();
    const lock = t.current.lockScope.bind(t.current);
    t.current.lockScope = async (...args) => {
      const scope = await lock(...args);
      return {
        ...scope,
        async prepareCommand(...args) {
          const binding = await scope.prepareCommand(...args);
          t.state.revoked = true;
          return binding;
        },
      };
    };
    await expect(
      t.facade().transact(t.target.operation, t.command, t.build),
    ).rejects.toThrow("current_denied");
    expect(t.events).toContain("storage-guard");
    expect(t.build).not.toHaveBeenCalled();
  });

  it.each(["run", "assertStorage", "authenticateRetention"])(
    "rejects incomplete transaction binding %s before build",
    async (key) => {
      const t = await setup();
      const lock = t.current.lockScope.bind(t.current);
      t.current.lockScope = async (...args) => {
        const scope = await lock(...args);
        return {
          ...scope,
          async prepareCommand(...args) {
            const binding = await scope.prepareCommand(...args);
            delete (binding as unknown as Record<string, unknown>)[key];
            return binding;
          },
        };
      };
      await expect(
        t.facade().transact(t.target.operation, t.command, t.build),
      ).rejects.toThrow();
      expect(t.build).not.toHaveBeenCalled();
      expect(t.events).not.toContain("fact-insert");
    },
  );

  it("rejects reuse of the committed reader as the storage connection", async () => {
    const t = await setup();
    t.dependencies.transactions = { run: (_mode, work) => work(t.reader) };
    await expect(t.facade().loadReview(fixture.familyKey)).rejects.toThrow();
    expect(t.events).not.toContain("lock");
  });
});
