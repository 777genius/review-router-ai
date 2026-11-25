import { describe, expect, it } from "vitest";
import {
  evaluateResolutionHistory,
  type ResolutionHistory,
  type ResolutionOperationIdentity,
} from "../domain/review-thread-resolution-history";
const own: ResolutionOperationIdentity = {
  sourceKind: "canonical_operation",
  operationId: "resolve-A",
  publicationAttemptId: "publication",
  executionId: "execution",
  generation: "4",
  reviewedHeadSha: "a".repeat(40),
  bodyHash: "b".repeat(64),
};
const history: ResolutionHistory = {
  threadId: "thread-A",
  version: 0,
  historyCut: {
    activatedAt: "2026-10-25T10:00:00.000Z",
    activationVersion: 1,
    writerDigest: "c".repeat(64),
  },
  confirmed: null,
  pending: [],
};
const input = {
  history,
  parentCreatedAt: "2026-10-25T11:00:00.000Z",
  isResolved: false,
};
describe("scoped resolution history policy", () => {
  it("quarantines every pre-cut or equal-cut parent, including a late-visible thread with no retained row", () => {
    const cut = history.historyCut!;
    const bootstrap = {
      qualificationSource: "retired_legacy_writers_quarantine.v1" as const,
      executorSetHash: "d".repeat(64),
      proofHash: "e".repeat(64),
      retiredAt: "2026-10-25T09:59:00.000Z",
      activationCut: cut.activatedAt,
    };
    const quarantined = { ...history, historyCut: { ...cut, bootstrap } };
    for (const parentCreatedAt of ["2020-01-01T00:00:00.000Z", cut.activatedAt])
      expect(
        evaluateResolutionHistory({
          history: quarantined,
          parentCreatedAt,
          isResolved: false,
        }),
      ).toEqual({
        status: "blocked",
        reasonCodes: ["untracked_legacy_possibility"],
      });
    expect(
      evaluateResolutionHistory({
        history: {
          ...quarantined,
          threadId: "late-visible-pre-cut",
          version: 0,
        },
        parentCreatedAt: "2026-10-25T09:59:59.000Z",
        isResolved: false,
      }),
    ).toEqual({
      status: "blocked",
      reasonCodes: ["untracked_legacy_possibility"],
    });
    expect(
      evaluateResolutionHistory({
        history: quarantined,
        parentCreatedAt: "2026-10-25T10:00:00.001Z",
        isResolved: false,
      }),
    ).toMatchObject({
      status: "eligible",
      historyStatus: "no_prior_rr_resolution",
    });
    expect(quarantined.pending).toEqual([]);
    expect(quarantined.confirmed).toBeNull();
  });

  it("allows pre-cut targets honestly and proves only the observed post-cut lifetime", () => {
    expect(evaluateResolutionHistory(input)).toMatchObject({
      status: "eligible",
      historyStatus: "no_prior_rr_resolution",
      reasonCodes: [],
    });
    expect(
      evaluateResolutionHistory({
        ...input,
        parentCreatedAt: "2025-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({
      status: "eligible",
      historyStatus: "no_known_resolution_since_cut",
      reasonCodes: ["legacy_history_before_cut_unobserved"],
    });
    expect(
      evaluateResolutionHistory({
        ...input,
        history: { ...history, historyCut: null },
      }),
    ).toMatchObject({ status: "blocked" });
  });
  it("keeps pending unknown conservative and permits only exact own operation progress", () => {
    const pending = {
      ...history,
      pending: [
        {
          ...own,
          state: "effect_unknown" as const,
          enteredAt: "2026-10-25T11:00:00.000Z",
        },
      ],
    };
    expect(
      evaluateResolutionHistory({ ...input, history: pending }),
    ).toMatchObject({
      status: "blocked",
      reasonCodes: ["resolution_effect_unknown"],
    });
    expect(
      evaluateResolutionHistory({
        ...input,
        history: pending,
        ownOperation: own,
      }),
    ).toMatchObject({ status: "own_operation_pending" });
    expect(
      evaluateResolutionHistory({
        ...input,
        history: pending,
        ownOperation: { ...own, generation: "5" },
      }),
    ).toMatchObject({ status: "blocked" });
    expect(
      evaluateResolutionHistory({
        ...input,
        history: pending,
        ownOperation: { ...own, bodyHash: "d".repeat(64) },
      }),
    ).toMatchObject({ status: "blocked" });
  });
  it("never recloses own confirmed reopen and retains foreign cycles after own confirmation", () => {
    const confirmed = {
      ...own,
      effectId: "effect-A",
      observedAt: "2026-10-25T12:00:00.000Z",
    };
    expect(
      evaluateResolutionHistory({
        ...input,
        history: { ...history, confirmed },
        ownOperation: own,
        isResolved: true,
      }),
    ).toMatchObject({ status: "own_operation_applied" });
    expect(
      evaluateResolutionHistory({
        ...input,
        history: { ...history, confirmed },
        ownOperation: own,
      }),
    ).toMatchObject({
      status: "blocked",
      reasonCodes: ["previously_resolved_thread_reopened"],
    });
    expect(
      evaluateResolutionHistory({
        ...input,
        history: {
          ...history,
          confirmed: {
            ...confirmed,
            latestConfirmed: {
              ...confirmed,
              generation: "5",
              operationId: "foreign",
            },
          },
        },
        ownOperation: own,
      }),
    ).toMatchObject({ status: "blocked" });
  });
});
