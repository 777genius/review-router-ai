import type { UsageProjection } from "../domain/usage";
import type { UsageReportQuery } from "./ports";
import { costUnits } from "./usage-money";
import { aggregateUsage, type UsageTotals } from "./usage-totals";

export interface UsageRequestedIdentity {
  provider: string;
  requestedModel: string | null;
}
export interface UsageModelAggregate extends UsageRequestedIdentity {
  totals: UsageTotals;
  observedModels: string[];
  hasUnknownObservedModel: boolean;
}
export interface UsageOverview {
  daily: { day: string; provider: string; totals: UsageTotals }[];
  models: (UsageModelAggregate & { route: "gateway" | "direct" })[];
  topModels: {
    tokens: UsageModelAggregate[];
    requests: UsageModelAggregate[];
    costs: {
      currency: string;
      basis: "estimated" | "source_reported";
      models: UsageModelAggregate[];
    }[];
  };
  runs: {
    runId: string;
    firstOccurredAt: string;
    lastOccurredAt: string;
    identities: UsageRequestedIdentity[];
    observedModels: string[];
    hasUnknownObservedModel: boolean;
    routes: ("gateway" | "direct")[];
    totals: UsageTotals;
  }[];
  nextRunCursor: string | null;
  facets: { providers: string[]; models: UsageRequestedIdentity[] };
  hasDirectObservations: boolean;
  observationsWithoutRunId: number;
}
export const compareUsageStrings = (a: string, b: string) =>
  a < b ? -1 : a > b ? 1 : 0;
export const usageRequestedIdentityKey = (p: UsageRequestedIdentity) =>
  JSON.stringify([p.provider, p.requestedModel]);
const compare = compareUsageStrings;
const identityKey = usageRequestedIdentityKey;
const requestedIdentity = (p: UsageProjection): UsageRequestedIdentity => ({
  provider: p.identity.provider,
  requestedModel: p.identity.requestedModel,
});
function identities(
  rows: readonly UsageProjection[],
): UsageRequestedIdentity[] {
  return [
    ...new Map(
      rows.map((p) => {
        const identity = requestedIdentity(p);
        return [identityKey(identity), identity] as const;
      }),
    ).values(),
  ].sort((a, b) => compare(identityKey(a), identityKey(b)));
}
function annotations(rows: readonly UsageProjection[]) {
  return {
    observedModels: [
      ...new Set(
        rows.flatMap((p) =>
          p.usage?.actualModel == null ? [] : [p.usage.actualModel],
        ),
      ),
    ].sort(compare),
    hasUnknownObservedModel: rows.some((p) => p.usage?.actualModel == null),
  };
}
/** Each bucket keeps spend authority and original attempts independent. */
function buckets(
  selected: readonly UsageProjection[],
  attempts: readonly UsageProjection[],
  key: (p: UsageProjection) => string | null,
) {
  const groups = new Map<
    string,
    { selected: UsageProjection[]; attempts: UsageProjection[] }
  >();
  for (const [kind, rows] of [
    ["selected", selected],
    ["attempts", attempts],
  ] as const)
    for (const p of rows) {
      const k = key(p);
      if (k === null) continue;
      const bucket = groups.get(k) ?? { selected: [], attempts: [] };
      bucket[kind].push(p);
      groups.set(k, bucket);
    }
  return [...groups.entries()]
    .sort(([a], [b]) => compare(a, b))
    .map(([key, g]) => ({
      key,
      rows: [...new Set([...g.selected, ...g.attempts])],
      totals: aggregateUsage(g.selected, g.attempts),
    }));
}
function ranked<T extends UsageModelAggregate>(
  models: readonly T[],
  value: (m: T) => bigint | number | null,
): T[] {
  return models
    .flatMap((m) => {
      const n = value(m);
      return n === null ? [] : [{ m, n }];
    })
    .sort((a, b) =>
      a.n < b.n
        ? 1
        : a.n > b.n
          ? -1
          : compare(identityKey(a.m), identityKey(b.m)),
    )
    .slice(0, 3)
    .map(({ m }) => m);
}
export function buildUsageTopModels(
  aggregateModels: readonly UsageModelAggregate[],
): UsageOverview["topModels"] {
  const costBuckets = [
    ...new Map(
      aggregateModels.flatMap((m) =>
        m.totals.costs.map(
          (c) =>
            [
              JSON.stringify([c.currency, c.basis]),
              { currency: c.currency, basis: c.basis },
            ] as const,
        ),
      ),
    ).entries(),
  ]
    .sort(([a], [b]) => compare(a, b))
    .map(([, bucket]) => bucket);
  return {
    tokens: ranked(aggregateModels, (m) => m.totals.tokens.total),
    requests: ranked(aggregateModels, (m) => m.totals.providerAttempts),
    costs: costBuckets.map((bucket) => ({
      ...bucket,
      models: ranked(aggregateModels, (m) => {
        const cost = m.totals.costs.find(
          (c) => c.currency === bucket.currency && c.basis === bucket.basis,
        );
        return cost ? costUnits(cost.amount) : null;
      }),
    })),
  };
}
/** Structural scope has already been enforced by the reader; facets never expand it. */
export function buildUsageOverview(
  structuralRows: readonly UsageProjection[],
  selected: readonly UsageProjection[],
  attempts: readonly UsageProjection[],
  query: UsageReportQuery,
): UsageOverview {
  const modelKey = (p: UsageProjection) => identityKey(requestedIdentity(p));
  const aggregateModels = buckets(selected, attempts, modelKey).map((g) => ({
    ...requestedIdentity(g.rows[0]!),
    totals: g.totals,
    ...annotations(g.rows),
  }));
  const runs = buckets(selected, attempts, (p) => p.identity.runId).map((g) => {
    const times = g.rows
      .map((p) => p.identity.occurredAt)
      .sort((a, b) => Date.parse(a) - Date.parse(b) || compare(a, b));
    return {
      runId: g.key,
      firstOccurredAt: times[0]!,
      lastOccurredAt: times.at(-1)!,
      identities: identities(g.rows),
      ...annotations(g.rows),
      routes: [...new Set(g.rows.map((p) => p.identity.route))].sort(compare),
      totals: g.totals,
    };
  });
  const after = runs.filter((r) => !query.runAfter || r.runId > query.runAfter);
  const page = after.slice(0, query.limit ?? 100);
  return {
    daily: buckets(selected, attempts, (p) =>
      JSON.stringify([p.identity.occurredAt.slice(0, 10), p.identity.provider]),
    ).map((g) => ({
      day: g.rows[0]!.identity.occurredAt.slice(0, 10),
      provider: g.rows[0]!.identity.provider,
      totals: g.totals,
    })),
    models: buckets(selected, attempts, (p) =>
      JSON.stringify([
        p.identity.provider,
        p.identity.requestedModel,
        p.identity.route,
      ]),
    ).map((g) => ({
      ...requestedIdentity(g.rows[0]!),
      route: g.rows[0]!.identity.route,
      totals: g.totals,
      ...annotations(g.rows),
    })),
    topModels: buildUsageTopModels(aggregateModels),
    runs: page,
    nextRunCursor: after.length > page.length ? page.at(-1)!.runId : null,
    facets: {
      providers: [
        ...new Set(structuralRows.map((p) => p.identity.provider)),
      ].sort(compare),
      models: identities(structuralRows),
    },
    hasDirectObservations: attempts.some((p) => p.identity.route === "direct"),
    observationsWithoutRunId: attempts.filter((p) => p.identity.runId === null)
      .length,
  };
}
