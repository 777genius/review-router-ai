import { describe, expect, it } from "vitest";
import type { ProgressSnapshot } from "@reviewrouter/features-review-progress";
import { parseSnapshot } from "./review-progress-snapshot-policy";

const validSnapshot: ProgressSnapshot = {
  schemaVersion: 1,
  generation: 1,
  phase: "reviewing",
  terminal: "none",
  updatedAt: "2026-08-12T12:00:00.000Z",
  counts: {
    total: 2,
    completed: 1,
    exhausted: 0,
    cancelled: 0,
    running: 1,
    pending: 0,
    retrying: 0,
    recovered: 0,
    requiredTotal: 2,
    requiredCompleted: 1,
    requiredExhausted: 0,
    requiredCancelled: 0,
    optionalTotal: 0,
    optionalCompleted: 0,
  },
  fileCoverage: { valid: false },
  sourceIdentity: { sourceRunId: "700001", sourceRunAttempt: "2" },
};

describe("Review progress snapshot policy", () => {
  it("preserves a valid v1 snapshot and its identity", () => {
    expect(parseSnapshot(validSnapshot)).toBe(validSnapshot);
  });

  it("accepts a legacy snapshot without source identity", () => {
    const legacy = { ...validSnapshot, sourceIdentity: undefined };
    expect(parseSnapshot(legacy)).toBe(legacy);
  });

  it("rejects an unsafe generation and an invalid phase", () => {
    expect(() =>
      parseSnapshot({
        ...validSnapshot,
        generation: Number.MAX_SAFE_INTEGER + 1,
      }),
    ).toThrow("review_progress_snapshot_invalid");
    const invalidPhase = { ...validSnapshot, phase: "unknown" };
    expect(() => parseSnapshot(invalidPhase)).toThrow(
      "review_progress_snapshot_invalid",
    );
  });

  it("rejects negative counters and invalid valid-coverage fields", () => {
    expect(() =>
      parseSnapshot({
        ...validSnapshot,
        counts: { ...validSnapshot.counts, requiredTotal: -1 },
      }),
    ).toThrow("review_progress_snapshot_invalid");
    expect(() =>
      parseSnapshot({
        ...validSnapshot,
        fileCoverage: {
          valid: true,
          total: 1,
          covered: -1,
          uncovered: 0,
          excluded: 0,
        },
      }),
    ).toThrow("review_progress_snapshot_invalid");
  });

  it("rejects malformed source identities", () => {
    expect(() =>
      parseSnapshot({
        ...validSnapshot,
        sourceIdentity: {
          sourceRunId: "700001 -->",
          sourceRunAttempt: "2",
        },
      }),
    ).toThrow("review_progress_snapshot_invalid");
  });
});
