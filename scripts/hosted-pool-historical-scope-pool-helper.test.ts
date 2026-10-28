import { describe, expect, it } from "vitest";
import { collectAuthenticatedPoolRows } from "./hosted-pool-historical-scope-pool-helper";

describe("historical scope authenticated pool fixture", () => {
  it("releases and joins sibling transactions after an identity query rejects", async () => {
    // Regression: Promise.all rejects before every identity query arrives, then
    // clearing the only barrier timer strands siblings inside their callbacks.
    const originalError = new Error("identity_query_rejected");
    let rejectQuery!: (error: Error) => void;
    const failingQuery = new Promise<never>((_resolve, reject) => {
      rejectQuery = reject;
    });
    let waiting = 0;
    let active = 0;
    const completed: number[] = [];
    const result = collectAuthenticatedPoolRows(3, async (arrive) => {
      const slot = active++;
      try {
        if (slot === 0) await failingQuery;
        else {
          const waitingAtBarrier = arrive();
          if (++waiting === 2) rejectQuery(originalError);
          await waitingAtBarrier;
        }
        return slot;
      } finally {
        completed.push(slot);
        active--;
      }
    });

    await expect(result).rejects.toBe(originalError);
    expect(waiting).toBe(2);
    expect(completed.sort()).toEqual([0, 1, 2]);
    expect(active).toBe(0);
  });
});
