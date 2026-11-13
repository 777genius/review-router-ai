import { describe, expect, it } from "vitest";
import {
  executionStateTerminal,
  terminalSnapshot,
} from "./review-progress-terminal-policy";

const now = new Date("2026-08-12T12:00:00.000Z");

describe("Review progress terminal policy", () => {
  it("preserves explicit settlement precedence", () => {
    expect(executionStateTerminal("completed", "succeeded")).toBe("complete");
    expect(executionStateTerminal("partial", "succeeded")).toBe(
      "complete_with_gaps",
    );
    expect(executionStateTerminal("completed", "failed")).toBe("failed");
    expect(executionStateTerminal("completed", "superseded")).toBe(
      "superseded",
    );
    expect(executionStateTerminal("running", "succeeded")).toBeNull();
  });

  it("preserves the original terminal snapshot projection", () => {
    const snapshot = {
      schemaVersion: 1,
      phase: "publishing",
      counts: {
        requiredCompleted: 1,
        requiredTotal: 1,
        requiredExhausted: 0,
        requiredCancelled: 0,
      },
    };
    expect(terminalSnapshot(snapshot, "complete", now)).toEqual({
      ...snapshot,
      phase: "terminal",
      terminal: "complete",
      updatedAt: now.toISOString(),
    });
  });

  it("rejects inconsistent complete required counts", () => {
    expect(() =>
      terminalSnapshot(
        {
          schemaVersion: 1,
          counts: {
            requiredCompleted: 0,
            requiredTotal: 1,
            requiredExhausted: 0,
            requiredCancelled: 0,
          },
        },
        "complete",
        now,
      ),
    ).toThrow("review_progress_complete_outcome_inconsistent");
  });

  it("rejects a partial outcome after all required work is complete", () => {
    for (const gaps of [
      { requiredExhausted: 1, requiredCancelled: 0 },
      { requiredExhausted: 0, requiredCancelled: 1 },
    ]) {
      expect(() =>
        terminalSnapshot(
          {
            schemaVersion: 1,
            counts: {
              requiredCompleted: 1,
              requiredTotal: 1,
              ...gaps,
            },
          },
          "complete_with_gaps",
          now,
        ),
      ).toThrow("review_progress_partial_outcome_inconsistent");
    }
  });

  it("rejects required gap counts exceeding the declared total", () => {
    expect(() =>
      terminalSnapshot(
        {
          schemaVersion: 1,
          counts: {
            requiredCompleted: 0,
            requiredTotal: 1,
            requiredExhausted: 1,
            requiredCancelled: 1,
          },
        },
        "complete_with_gaps",
        now,
      ),
    ).toThrow("review_progress_snapshot_invalid");
  });

  it("accepts a genuine partially completed required outcome", () => {
    const snapshot = {
      schemaVersion: 1,
      counts: {
        requiredCompleted: 1,
        requiredTotal: 2,
        requiredExhausted: 1,
        requiredCancelled: 0,
      },
    };
    const actual = terminalSnapshot(snapshot, "complete_with_gaps", now);
    expect(actual).toMatchObject({
      ...snapshot,
      phase: "terminal",
      terminal: "complete_with_gaps",
    });
  });
});
