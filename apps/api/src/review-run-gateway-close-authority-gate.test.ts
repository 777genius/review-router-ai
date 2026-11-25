import { describe, expect, it } from "vitest";
import { createCloseAuthorityGate } from "./review-run-gateway-close-authority-gate";

describe("close authority gate", () => {
  it("prioritizes cancellation without starving queued normal work", async () => {
    const run = createCloseAuthorityGate(1);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const order: string[] = [];
    const first = run("normal", async () => {
      await blocked;
    });
    const normal = run("normal", async () => {
      order.push("normal");
    });
    const urgent = Array.from({ length: 5 }, (_, index) =>
      run("urgent", async () => {
        order.push(`urgent-${index}`);
      }),
    );
    release();
    await Promise.all([first, normal, ...urgent]);
    expect(order).toEqual([
      "urgent-0",
      "urgent-1",
      "urgent-2",
      "normal",
      "urgent-3",
      "urgent-4",
    ]);
  });

  it("releases a permit on failure only after the underlying work settles", async () => {
    const run = createCloseAuthorityGate(1);
    let reject!: (error: Error) => void;
    const held = new Promise<void>((_, rejectPromise) => {
      reject = rejectPromise;
    });
    const failed = run("normal", () => held);
    let started = false;
    const next = run("urgent", async () => {
      started = true;
    });
    await Promise.resolve();
    expect(started).toBe(false);
    reject(new Error("database unavailable"));
    await expect(failed).rejects.toThrow("database unavailable");
    await next;
    expect(started).toBe(true);
  });
});
