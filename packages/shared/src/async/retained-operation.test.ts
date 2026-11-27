import { afterEach, describe, expect, it, vi } from "vitest";
import { createRetainedOperationRunner } from "./retained-operation";

describe("retained operation capacity", () => {
  afterEach(() => vi.useRealTimers());

  it("retains timed-out work until actual settlement, then recovers capacity", async () => {
    vi.useFakeTimers();
    const runner = createRetainedOperationRunner(2);
    const first = deferred<string>();
    const second = deferred<string>();
    const firstCall = runner.run(() => first.promise, { timeoutMs: 20 });
    const secondCall = runner.run(() => second.promise, { timeoutMs: 20 });
    const timedOut = Promise.all([
      expect(firstCall).rejects.toThrow("operation_deadline"),
      expect(secondCall).rejects.toThrow("operation_deadline"),
    ]);
    await vi.advanceTimersByTimeAsync(20);
    await timedOut;

    const unexpected = vi.fn(async () => "should not start");
    await expect(runner.run(unexpected, { timeoutMs: 20 })).rejects.toThrow(
      "operation_capacity",
    );
    expect(unexpected).not.toHaveBeenCalled();
    first.reject(new Error("late transport rejection"));
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      runner.run(async () => "recovered", { timeoutMs: 20 }),
    ).resolves.toBe("recovered");
    second.resolve("late result");
    await Promise.resolve();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates stop to IO without pretending ignored abort freed its slot", async () => {
    const runner = createRetainedOperationRunner(1);
    const controller = new AbortController();
    const held = deferred<string>();
    let ownedSignal: AbortSignal | undefined;
    const call = runner.run(
      (signal) => {
        ownedSignal = signal;
        return held.promise;
      },
      { timeoutMs: 1_000, signal: controller.signal },
    );
    const aborted = expect(call).rejects.toThrow("caller stopped");
    await Promise.resolve();
    controller.abort(new Error("caller stopped"));
    await aborted;
    expect(ownedSignal?.aborted).toBe(true);
    await expect(
      runner.run(async () => "new", { timeoutMs: 20 }),
    ).rejects.toThrow("operation_capacity");
    held.resolve("late");
    await Promise.resolve();
    await Promise.resolve();
    await expect(
      runner.run(async () => "new", { timeoutMs: 20 }),
    ).resolves.toBe("new");
  });

  it("never starts a pre-aborted operation and clears settled deadlines", async () => {
    vi.useFakeTimers();
    const runner = createRetainedOperationRunner(1);
    const execute = vi.fn(async () => 42);
    const controller = new AbortController();
    controller.abort(new Error("stopped before admission"));
    await expect(
      runner.run(execute, {
        signal: controller.signal,
        timeoutMs: 50,
      }),
    ).rejects.toThrow("stopped before admission");
    expect(execute).not.toHaveBeenCalled();
    await expect(runner.run(execute, { timeoutMs: 50 })).resolves.toBe(42);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a late result even if the deadline timer has not run yet", async () => {
    const now = vi.spyOn(performance, "now");
    try {
      now.mockReturnValue(0);
      const runner = createRetainedOperationRunner(1);
      await expect(
        runner.run(
          async () => {
            now.mockReturnValue(200);
            return "obsolete";
          },
          { timeoutMs: 100 },
        ),
      ).rejects.toThrow("operation_deadline");
    } finally {
      now.mockRestore();
    }
  });

  it("rejects a result when its operation revoked authority before returning", async () => {
    const runner = createRetainedOperationRunner(1);
    const controller = new AbortController();
    const execute = async () => {
      controller.abort(new Error("authority expired"));
      return "obsolete";
    };
    await expect(
      runner.run(execute, {
        signal: controller.signal,
        timeoutMs: 100,
      }),
    ).rejects.toThrow("authority expired");
  });
});

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
