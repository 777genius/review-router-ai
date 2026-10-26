import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ReviewSnapshotV2Record } from "@reviewrouter/features-review-snapshots/v2";
import type { ReviewPublicationAttemptView } from "@reviewrouter/features-review-publishing/v2";
import {
  appliedComparisonResolutions,
  retainedComparisonResolutionFacts,
  bindComparisonResolutionHistory,
} from "./review-comparison-baseline-resolutions.js";
const lineageId = `rrl_${"a".repeat(32)}`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const markerHash = sha(
  "reviewrouter-lifecycle:rrt_dddddddddddddddddddddddddddddddd:resolved",
);
const bodyHash = sha(JSON.stringify({ resolve: true, threadId: "thread" }));
const record = {
  sourceReviewedHeadSha: "head",
  sourceReviewRevisionHash: "revision",
  payload: {
    projectionEnvelope: {
      publishing: {
        lifecycle: [
          {
            targetId: "rrt_dddddddddddddddddddddddddddddddd",
            threadId: "thread",
            markerFingerprint: lineageId,
            lineageId,
            verdict: "resolved",
            mutationEligible: true,
          },
        ],
      },
      snapshot: { lineageHints: [{ lineageId, active: false }] },
    },
  },
} as unknown as ReviewSnapshotV2Record;
function view(): ReviewPublicationAttemptView {
  return {
    attempt: {
      state: "terminal",
      terminalOutcome: "succeeded",
      operations: [
        {
          publicationOperationId: "op",
          publicationKind: "thread_lifecycle",
          state: "completed",
          markerHash,
          bodyHash,
          targetCommitId: "head",
          reviewRevisionHash: "revision",
        },
      ],
    },
    receipts: [
      {
        publicationOperationId: "op",
        status: "succeeded",
        canonicalExternalObjectId: "thread:thread",
        canonicalEffectId: "effect",
      },
    ],
    effects: [
      {
        effectId: "effect",
        publicationOperationId: "op",
        externalObjectId: "thread:thread",
        observedObjectHash: sha(
          JSON.stringify({
            externalObjectId: "thread:thread",
            markerHash,
            bodyHash,
          }),
        ),
        effectKind: "mutation_acknowledged",
        observedAt: new Date("2026-10-22T12:00:00.000Z"),
      },
    ],
    corrections: [],
    tombstones: [],
  } as unknown as ReviewPublicationAttemptView;
}
describe("comparison resolution receipt evidence", () => {
  it("requires the exact successful operation/effect tuple and canonical time", () => {
    expect(appliedComparisonResolutions(record, view())).toEqual([
      {
        lineageId,
        targetId: "rrt_dddddddddddddddddddddddddddddddd",
        threadId: "thread",
        markerFingerprint: lineageId,
        resolvedAt: "2026-10-22T12:00:00.000Z",
      },
    ]);
    expect(appliedComparisonResolutions(record, null)).toEqual([]);
  });
  it("rejects desired-only, compensated, wrong-object and stale outcomes", () => {
    const correct = view();
    for (const changed of [
      { ...correct, receipts: [] },
      { ...correct, effects: [] },
      {
        ...correct,
        effects: correct.effects.map((effect) => ({
          ...effect,
          effectKind: "lifecycle_compensated" as const,
        })),
      },
      {
        ...correct,
        effects: correct.effects.map((effect) => ({
          ...effect,
          externalObjectId: "thread:other",
        })),
      },
      {
        ...correct,
        attempt: {
          ...correct.attempt,
          terminalOutcome: "stale_compensated" as const,
        },
      },
      {
        ...correct,
        receipts: correct.receipts.map((receipt) => ({
          ...receipt,
          status: "compensated" as const,
        })),
      },
    ])
      expect(
        appliedComparisonResolutions(
          record,
          changed as unknown as ReviewPublicationAttemptView,
        ),
      ).toEqual([]);
  });
  it("retains positive canonical history from a partial attempt independently of current snapshot closure", () => {
    const partial = view();
    const candidate = {
      ...partial,
      receipts: [],
      attempt: {
        ...partial.attempt,
        state: "reconciling",
        terminalOutcome: null,
        publicationAttemptId: "publication",
        permit: { executionId: "execution", generation: 4n },
      },
    } as unknown as ReviewPublicationAttemptView;
    expect(appliedComparisonResolutions(record, candidate)).toEqual([]);
    expect(retainedComparisonResolutionFacts(record, candidate)).toMatchObject([
      {
        operationId: "op",
        effectId: "effect",
        executionId: "execution",
        generation: "4",
      },
    ]);
    expect(
      retainedComparisonResolutionFacts(record, { ...candidate, effects: [] }),
    ).toEqual([]);
  });
  it("requires exact native parent bindings and never fabricates missing guard histories", () => {
    const witness = {
      targetId: "target",
      threadId: "thread",
      parentCommentId: "parent",
      parentCreatedAt: "2020-01-01T00:00:00.000Z",
      parentBodyHash: "a".repeat(64),
    };
    const history = {
      threadId: "thread",
      version: 0,
      historyCut: null,
      confirmed: null,
      pending: [],
    };
    expect(bindComparisonResolutionHistory([witness], [history])).toEqual([
      { ...witness, history },
    ]);
    expect(() => bindComparisonResolutionHistory([witness], [])).toThrow(
      "resolution_history_target_binding_invalid",
    );
    expect(() =>
      bindComparisonResolutionHistory(
        [{ ...witness, parentBodyHash: "changed" }],
        [history],
      ),
    ).toThrow("resolution_history_target_binding_invalid");
  });
});
