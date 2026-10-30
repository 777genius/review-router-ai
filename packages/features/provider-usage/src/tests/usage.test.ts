import { describe, it, expect } from "vitest";
import { fact } from "./fixture";
import {
  canonicalJson,
  selectProjection,
  selectReportFacts,
  validateUsageFact,
} from "../domain/usage";
import { IngestUsage } from "../application/ingest-usage";
import { buildUsagePeriodReport } from "../application/report-usage";
const now = new Date("2026-10-21T12:00:00Z");
const context = {
  workspaceId: "workspace-1",
  invocationId: "invocation-1",
  source: "native" as const,
  now,
  replayUntil: new Date("2026-11-01T00:00:00Z"),
};
describe("safe usage invariants", () => {
  it("rejects unknown data instead of persisting request content", () => {
    expect(() =>
      validateUsageFact({ ...fact(), prompt: "secret" } as never),
    ).toThrow("usage_invalid_fact");
    expect(() =>
      validateUsageFact({
        ...fact(),
        tokens: { ...fact().tokens, raw: "secret" },
      } as never),
    ).toThrow("usage_invalid_fact");
  });
  it("rejects malformed enums, numeric buckets and empty/unproven child manifests", () => {
    for (const value of [
      fact({ authority: "spoof" as never }),
      fact({ tokens: { ...fact().tokens, cacheRead: -1 } }),
      fact({ childCallIds: [] }),
      fact({ cost: { ...fact().cost!, amount: "1e8" } }),
    ])
      expect(() => validateUsageFact(value)).toThrow("usage_invalid_fact");
  });
  it("keeps inclusive cache and reasoning subsets and nullable data", () => {
    expect(() => validateUsageFact(fact())).not.toThrow();
    expect(() =>
      validateUsageFact(
        fact({
          tokens: {
            inputTotal: null,
            outputTotal: null,
            cacheRead: null,
            cacheWrite: null,
            reasoning: null,
            total: 100,
          },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      validateUsageFact(fact({ tokens: { ...fact().tokens, total: 165 } })),
    ).toThrow("usage_invalid_fact");
  });
  it("does not add runner snapshot to gateway native usage", () => {
    const native = fact();
    const runner = fact({
      authority: "runner",
      sourceInstance: "runner",
      eventId: "runner",
      tokens: { ...native.tokens, total: null },
    });
    expect(selectProjection([runner, native]).usage?.tokens.total).toBe(130);
  });
  it("keeps highest numeric source revision regardless of arrival order", () => {
    const newer = fact({
      revision: 10,
      correctionReason: "source correction",
      tokens: { ...fact().tokens, total: 200, inputTotal: 170 },
    });
    expect(selectProjection([newer, fact()]).usage?.tokens.total).toBe(200);
  });
  it("rejects tenant mutation and disagreeing authorities", () => {
    expect(() =>
      selectProjection([
        fact(),
        fact({ identity: { ...fact().identity, workspaceId: "other" } }),
      ]),
    ).toThrow("usage_identity_conflict");
    expect(() =>
      selectProjection([
        fact(),
        fact({
          sourceInstance: "native-2",
          tokens: { ...fact().tokens, total: null },
        }),
      ]),
    ).toThrow("usage_authority_conflict");
  });
  it("preserves terminal lifecycle over a late prepared observation", () => {
    expect(
      selectProjection([
        fact({ authority: "lifecycle" }),
        fact({
          authority: "lifecycle",
          eventId: "later",
          revision: 100,
          state: "prepared",
        }),
      ]).lifecycle?.state,
    ).toBe("completed");
  });
  it("rejects runner native impersonation, forged scope, future and expired facts before store I/O", async () => {
    let writes = 0;
    const ingest = new IngestUsage({
      ingest: async () => {
        writes++;
        return { status: "accepted", hash: "x" };
      },
    });
    expect(() =>
      ingest.execute(fact(), { ...context, source: "runner" }),
    ).toThrow("usage_authority_conflict");
    expect(() =>
      ingest.execute(fact(), { ...context, workspaceId: "foreign" }),
    ).toThrow("usage_identity_conflict");
    expect(() =>
      ingest.execute(fact(), { ...context, now: new Date("2026-10-20") }),
    ).toThrow("usage_invalid_fact");
    expect(() =>
      ingest.execute(fact(), { ...context, now: new Date("2026-12-01") }),
    ).toThrow("source_window_expired");
    expect(writes).toBe(0);
  });
  it("uses summary until full exact correlated child coverage, with no subtraction", () => {
    const a = fact({ identity: { ...fact().identity, parentScope: "turn" } });
    const b = fact({ eventId: "b", identity: { ...a.identity, callId: "b" } });
    const summary = fact({
      eventId: "s",
      identity: { ...a.identity, callId: "s", granularity: "turn" },
      childCallIds: ["call-1", "b"],
      tokens: { ...a.tokens, inputTotal: 970, total: 1000 },
    });
    const partial = selectReportFacts([
      selectProjection([a]),
      selectProjection([summary]),
    ]);
    expect(partial.selected.map((p) => p.identity.callId)).toEqual(["s"]);
    expect(partial.partialChildren).toHaveLength(1);
    const complete = selectReportFacts([
      selectProjection([a]),
      selectProjection([b]),
      selectProjection([summary]),
    ]);
    expect(complete.selected.map((p) => p.identity.callId)).toEqual([
      "call-1",
      "b",
    ]);
  });
  it("never counts unbounded or overlapping summaries as added per-call totals", () => {
    const summary = fact({
      identity: { ...fact().identity, callId: "s", granularity: "turn" },
    });
    const selection = selectReportFacts([
      selectProjection([summary]),
      selectProjection([fact()]),
    ]);
    expect(selection.selected).toHaveLength(1);
    expect(selection.unboundedSummaries).toHaveLength(1);
    expect(() =>
      selectReportFacts([
        selectProjection([fact({ ...summary, childCallIds: ["a"] })]),
        selectProjection([
          fact({
            ...summary,
            identity: { ...summary.identity, callId: "s2" },
            childCallIds: ["a"],
          }),
        ]),
      ]),
    ).toThrow("usage_authority_conflict");
  });
  it("preserves duplicate child inputs and their order when a summary remains authoritative", () => {
    const a = selectProjection([
      fact({ identity: { ...fact().identity, parentScope: "turn" } }),
    ]);
    const b = selectProjection([
      fact({ identity: { ...a.identity, callId: "b" } }),
    ]);
    const summary = selectProjection([
      fact({
        identity: { ...a.identity, callId: "summary", granularity: "turn" },
        childCallIds: [a.identity.callId, b.identity.callId],
      }),
    ]);
    // Exact coverage counts input entries; duplicate observations must not be
    // silently collapsed into a complete family or reordered by the manifest.
    const duplicateA = { ...a };
    const duplicate = selectReportFacts([b, summary, a, duplicateA]);
    expect(duplicate.selected).toEqual([summary]);
    expect(duplicate.partialChildren).toEqual([b, a, duplicateA]);
    expect(duplicate.partialChildren[2]).toBe(duplicateA);
    const complete = selectReportFacts([b, summary, a]);
    expect(complete.selected).toEqual([b, a]);
    expect(complete.partialChildren).toEqual([]);
  });
  it("requires both correlation fields and keeps missing or unknown children under the summary", () => {
    const base = { ...fact().identity, parentScope: "turn" };
    const child = selectProjection([fact({ identity: base })]);
    const wrongParent = selectProjection([
      fact({
        identity: { ...base, callId: "wrong-parent", parentScope: "other" },
      }),
    ]);
    const wrongInvocation = selectProjection([
      fact({
        identity: {
          ...base,
          callId: "wrong-invocation",
          invocationId: "other",
        },
      }),
    ]);
    const summary = selectProjection([
      fact({
        identity: { ...base, callId: "summary", granularity: "turn" },
        childCallIds: [
          "missing",
          "wrong-invocation",
          "wrong-parent",
          base.callId,
        ],
      }),
    ]);
    const selection = selectReportFacts([
      wrongInvocation,
      child,
      summary,
      wrongParent,
    ]);
    expect(selection.selected).toEqual([wrongInvocation, wrongParent, summary]);
    expect(selection.partialChildren).toEqual([child]);
    for (const usage of [
      null,
      fact({ ...child.usage!, completeness: "unknown" }),
    ]) {
      const unknown = { ...child, usage };
      const bounded = selectProjection([
        fact({ ...summary.usage!, childCallIds: [base.callId] }),
      ]);
      expect(selectReportFacts([unknown, bounded])).toEqual({
        selected: [bounded],
        partialChildren: [unknown],
        unboundedSummaries: [],
      });
    }
  });
  it("aggregates complete period before page and preserves exact decimal currency/basis", () => {
    const a = fact();
    const b = fact({
      eventId: "b",
      identity: { ...a.identity, callId: "b" },
      cost: { ...a.cost!, amount: "0.2" },
    });
    const report = buildUsagePeriodReport(
      [selectProjection([a]), selectProjection([b])],
      {
        workspaceId: "workspace-1",
        actorId: null,
        access: "admin",
        from: new Date("2026-10-01"),
        to: new Date("2026-11-01"),
        limit: 1,
      },
    );
    expect(report.rows).toHaveLength(1);
    expect(report.totals.tokens.total).toBe(260);
    expect(report.totals.costs).toEqual([
      { currency: "USD", basis: "source_reported", amount: "0.3" },
    ]);
    expect(report.nextCursor).not.toBeNull();
  });
  it("canonicalizes independent of property insertion order", () =>
    expect(canonicalJson({ z: 1, a: null })).toBe('{"a":null,"z":1}'));
  it("does not count prepared or confirmed non-dispatched requests as measured attempts", () => {
    const prepared = fact({
      authority: "lifecycle",
      state: "prepared",
      dispatchEffect: "effect_unknown",
    });
    const nativeNonentry = fact({
      eventId: "nonentry",
      dispatchEffect: "not_dispatched",
      tokens: {
        inputTotal: null,
        outputTotal: null,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
        total: null,
      },
    });
    const report = buildUsagePeriodReport(
      [selectProjection([prepared, nativeNonentry])],
      {
        workspaceId: "workspace-1",
        actorId: null,
        access: "admin",
        from: new Date("2026-10-01"),
        to: new Date("2026-11-01"),
      },
    );
    expect(report.totals.providerAttempts).toBe(0);
    expect(report.totals.tokens.total).toBeNull();
    const onlyPrepared = buildUsagePeriodReport(
      [selectProjection([prepared])],
      {
        workspaceId: "workspace-1",
        actorId: null,
        access: "admin",
        from: new Date("2026-10-01"),
        to: new Date("2026-11-01"),
      },
    );
    expect(onlyPrepared.totals.providerAttempts).toBe(0);
    expect(onlyPrepared.totals.unknownCount).toBe(1);
  });
  it("preserves old producer hashes when optional tier and price snapshot are absent", () => {
    const old = fact();
    const before = canonicalJson(old);
    validateUsageFact(old);
    expect(canonicalJson(old)).toBe(before);
    expect(Object.hasOwn(old, "serviceTier")).toBe(false);
    expect(() =>
      validateUsageFact({ ...old, serviceTier: undefined } as never),
    ).toThrow("usage_invalid_fact");
    expect(() =>
      validateUsageFact({
        ...old,
        priceSnapshot: { prompt: "secret" },
      } as never),
    ).toThrow("usage_invalid_fact");
  });
  it("accepts late runner delivery inside trusted grant bounds without extending expiry", async () => {
    const f = fact({
      authority: "runtime",
      identity: {
        ...fact().identity,
        route: "direct",
        occurredAt: "2026-10-01T10:00:00.000Z",
      },
    });
    let writes = 0;
    const ingest = new IngestUsage({
      ingest: async () => {
        writes++;
        return { status: "accepted", hash: "hash" };
      },
    });
    const c = {
      workspaceId: "workspace-1",
      invocationId: "invocation-1",
      source: "runner" as const,
      now: new Date("2026-10-09T09:00:00Z"),
      replayUntil: new Date("2026-10-09T10:00:00Z"),
      originalEventNotBefore: new Date("2026-10-01T10:00:00Z"),
    };
    await ingest.execute(f, c);
    expect(writes).toBe(1);
    expect(() =>
      ingest.execute(f, { ...c, now: new Date("2026-10-09T10:00:01Z") }),
    ).toThrow("usage_report_expired");
    expect(() =>
      ingest.execute(
        {
          ...f,
          identity: { ...f.identity, occurredAt: "2026-10-01T09:54:59.000Z" },
        },
        c,
      ),
    ).toThrow("usage_report_expired");
    const legacy: Parameters<typeof ingest.execute>[1] = { ...c };
    delete legacy.originalEventNotBefore;
    expect(() => ingest.execute(f, legacy)).toThrow("usage_report_expired");
  });
  it("counts recovered native dispatch despite stale preparation and uses one cursor order", () => {
    const native = fact();
    const prepared = fact({
      sourceInstance: "relay",
      eventId: "relay",
      authority: "lifecycle",
      state: "prepared",
      dispatchEffect: "not_dispatched",
    });
    const query = {
      workspaceId: "workspace-1",
      actorId: null,
      access: "admin" as const,
      from: new Date("2026-10-01"),
      to: new Date("2026-11-01"),
      limit: 1,
    };
    const recovered = buildUsagePeriodReport(
      [selectProjection([prepared, native])],
      query,
    );
    expect(recovered.totals.tokens.total).toBe(130);
    expect(recovered.totals.providerAttempts).toBe(1);
    const unknown = fact({
      state: "unknown",
      dispatchEffect: "effect_unknown",
      completeness: "unknown",
      tokens: {
        inputTotal: null,
        outputTotal: null,
        cacheRead: null,
        cacheWrite: null,
        reasoning: null,
        total: null,
      },
    });
    const unknownReport = buildUsagePeriodReport(
      [selectProjection([prepared, unknown])],
      query,
    );
    expect(unknownReport.totals.providerAttempts).toBe(1);
    expect(unknownReport.totals.tokens.total).toBeNull();
    expect(unknownReport.totals.unknownCount).toBe(1);
    const noentry = fact({ ...prepared, state: "failed" });
    expect(
      buildUsagePeriodReport([selectProjection([noentry, native])], query)
        .totals.providerAttempts,
    ).toBe(0);
    const ids = ["a_", "aa", "A", "a-"];
    const projections = ids.map((id) =>
      selectProjection([
        fact({ eventId: id, identity: { ...fact().identity, callId: id } }),
      ]),
    );
    const paged: string[] = [];
    let after: string | undefined;
    for (let i = 0; i < ids.length; i++) {
      const result = buildUsagePeriodReport(projections, {
        ...query,
        ...(after ? { after } : {}),
      });
      paged.push(result.rows[0]!.identity.callId);
      after = result.nextCursor ?? undefined;
    }
    expect(paged).toEqual([...ids].sort());
    expect(new Set(paged).size).toBe(ids.length);
  });
});
