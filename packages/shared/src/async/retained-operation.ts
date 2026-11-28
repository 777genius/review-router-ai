export class RetainedOperationUnavailable extends Error {
  constructor(readonly reason: "capacity" | "deadline") {
    super(`operation_${reason}`);
    this.name = "RetainedOperationUnavailable";
  }
}

/** A finite caller wait never releases capacity still owned by real work. */
export function createRetainedOperationRunner(maxInFlight: number) {
  if (!Number.isSafeInteger(maxInFlight) || maxInFlight < 1)
    throw new Error("operation_capacity_invalid");
  let active = 0;
  return {
    async run<Value>(
      operation: (signal: AbortSignal) => Promise<Value>,
      options: Readonly<{ timeoutMs: number; signal?: AbortSignal }>,
    ): Promise<Value> {
      if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1)
        throw new Error("operation_deadline_invalid");
      options.signal?.throwIfAborted();
      if (active >= maxInFlight)
        throw new RetainedOperationUnavailable("capacity");
      const controller = new AbortController();
      const signal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      const deadline = performance.now() + options.timeoutMs;
      const expire = () =>
        controller.abort(new RetainedOperationUnavailable("deadline"));
      const timer = setTimeout(expire, options.timeoutMs);
      active += 1;
      const actual = Promise.resolve()
        .then(() => {
          signal.throwIfAborted();
          return operation(signal);
        })
        .finally(() => {
          active -= 1;
        });
      let aborted!: () => void;
      const interruption = new Promise<never>((_, reject) => {
        aborted = () => reject(signal.reason);
        signal.addEventListener("abort", aborted, { once: true });
        if (signal.aborted) aborted();
      });
      try {
        const value = await Promise.race([actual, interruption]);
        // A busy event loop can settle IO before its overdue timer callback.
        if (performance.now() >= deadline) expire();
        signal.throwIfAborted();
        return value;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", aborted);
      }
    },
  };
}
