import { deepStrictEqual } from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  selectReportFacts,
  UsageError,
  type UsageProjection,
} from "../../packages/features/provider-usage/src/index";
import { fact } from "../../packages/features/provider-usage/src/tests/fixture";

// Qualification-only reference from a678f21; never used by the application.
function scanSelection(projections: readonly UsageProjection[]) {
  const calls = projections.filter((p) => p.identity.granularity === "call");
  const summaries = projections.filter(
    (p) => p.identity.granularity === "turn",
  );
  const covered = new Set<string>();
  for (const summary of summaries)
    for (const id of summary.usage?.childCallIds ?? []) {
      if (covered.has(id)) throw new UsageError("usage_authority_conflict");
      covered.add(id);
    }
  const suppressed = new Set<string>();
  const selectedSummaries: UsageProjection[] = [];
  const partialChildren: UsageProjection[] = [];
  const unboundedSummaries: UsageProjection[] = [];
  for (const summary of summaries) {
    const manifest = summary.usage?.childCallIds;
    if (!manifest) {
      unboundedSummaries.push(summary);
      continue;
    }
    const children = calls.filter(
      (p) =>
        manifest.includes(p.identity.callId) &&
        p.identity.parentScope === summary.identity.parentScope &&
        p.identity.invocationId === summary.identity.invocationId,
    );
    if (
      children.length === manifest.length &&
      children.every((p) => p.usage?.completeness === "complete")
    )
      continue;
    selectedSummaries.push(summary);
    for (const child of children) {
      suppressed.add(child.identity.callId);
      partialChildren.push(child);
    }
  }
  return {
    selected: [
      ...calls.filter((p) => !suppressed.has(p.identity.callId)),
      ...selectedSummaries,
    ],
    partialChildren,
    unboundedSummaries,
  };
}

const calls: UsageProjection[] = [];
const summaries: UsageProjection[] = [];
for (let family = 0; family < 1000; family++) {
  const identity = {
    ...fact().identity,
    parentScope: `turn-${family}`,
    invocationId: `invocation-${family}`,
  };
  const childCallIds = Array.from(
    { length: 10 },
    (_, i) => `call-${family}-${i}`,
  );
  for (const [i, callId] of childCallIds.entries()) {
    const usage = fact({
      identity: {
        ...identity,
        callId,
        invocationId:
          family % 10 === 1 && i === 9 ? "other" : identity.invocationId,
      },
      completeness: family % 10 === 2 && i === 0 ? "partial" : "complete",
    });
    calls.push({ identity: usage.identity, usage, lifecycle: null });
  }
  const usage = fact({
    identity: { ...identity, callId: `summary-${family}`, granularity: "turn" },
    childCallIds:
      family % 10 === 3
        ? null
        : childCallIds.map((id, i) =>
            family % 10 === 0 && i === 9 ? `missing-${family}` : id,
          ),
  });
  summaries.push({ identity: usage.identity, usage, lifecycle: null });
}
const input = [...calls.reverse(), ...summaries];
const expected = scanSelection(input);
const actual = selectReportFacts(input);
deepStrictEqual(actual, expected);

// One warmup above and three serial samples; timings are evidence, not a CI gate.
const elapsedMs = { scan: [] as number[], indexed: [] as number[] };
for (let sample = 0; sample < 3; sample++) {
  for (const [name, select] of [
    ["scan", scanSelection],
    ["indexed", selectReportFacts],
  ] as const) {
    const start = performance.now();
    const result = select(input);
    elapsedMs[name].push(Number((performance.now() - start).toFixed(3)));
    deepStrictEqual(result, expected);
  }
}
const sourcePath = "packages/features/provider-usage/src/domain/usage.ts";
console.log(
  JSON.stringify(
    {
      node: process.version,
      sourceSha256: createHash("sha256")
        .update(readFileSync(sourcePath))
        .digest("hex"),
      calls: calls.length,
      summaries: summaries.length,
      selected: actual.selected.length,
      partialChildren: actual.partialChildren.length,
      unboundedSummaries: actual.unboundedSummaries.length,
      equivalence: "passed",
      warmupRuns: 1,
      measuredRuns: 3,
      elapsedMs,
      boundary:
        "Pure selection only; excludes SQL, full-period materialization and report aggregation.",
    },
    null,
    2,
  ),
);
