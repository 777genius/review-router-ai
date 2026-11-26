/** Keep late completion separate from the timed-out caller's state transitions. */
export async function withOrgRulesetIoDeadline<T>(
  signal: AbortSignal,
  work: () => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  let onAbort: (() => void) | undefined;
  const pending = work();
  // The gateway owns known remote settlement, including a response arriving
  // after this race. Its persisted attempt token remains until that transaction
  // commits; unknown outcomes cannot become configured on another retry.
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        onAbort = () => {
          reject(new Error("org_ruleset_attempt_timeout"));
        };
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      }),
    ]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
