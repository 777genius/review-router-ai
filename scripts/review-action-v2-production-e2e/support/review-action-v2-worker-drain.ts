/** Bounded test driver; production retry deadlines remain authoritative. */
export async function drainReviewActionV2Worker(
  input: {
    readonly runMaintenance: () => Promise<unknown>;
    readonly hasActiveCompletion: () => Promise<boolean>;
    readonly nextEligibleAt: () => Promise<Date | null>;
    readonly signal: AbortSignal;
  },
  maxPasses = 12,
): Promise<boolean> {
  let remainingWaitMs = 5_000;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    input.signal.throwIfAborted();
    await input.runMaintenance();
    input.signal.throwIfAborted();
    const active = await input.hasActiveCompletion();
    input.signal.throwIfAborted();
    if (!active) return true;
    // Single-pass fault probes must neither read deadlines nor wait.
    if (pass + 1 === maxPasses) break;
    const nextEligibleAt = await input.nextEligibleAt();
    input.signal.throwIfAborted();
    const delayMs = Math.max(0, (nextEligibleAt?.getTime() ?? 0) - Date.now());
    if (delayMs > remainingWaitMs) break;
    if (delayMs > 0) {
      remainingWaitMs -= delayMs;
      await waitForRetry(delayMs, input.signal);
    }
  }
  return false;
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
