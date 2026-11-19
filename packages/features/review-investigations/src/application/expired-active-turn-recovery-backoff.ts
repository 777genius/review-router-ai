export const expiredActiveTurnRecoveryBackoffPolicy = Object.freeze({
  initialDelayMs: 60 * 60 * 1_000,
  maxDelayMs: 24 * 60 * 60 * 1_000,
  maxTrackedInvestigations: 1_000,
});

type BackoffEntry = Readonly<{ failures: number; retryAtMs: number }>;

/**
 * Process-local retry schedule for investigations whose expired turn could not
 * be recovered. A row that keeps failing is retried after 1h, 2h, 4h ... and
 * then at most once a day, so it neither keeps the maintenance loop hot nor
 * takes a slot from healthy rows in the bounded recovery batch. A worker
 * restart forgets the schedule and retries every row once, which is the
 * intended way to pick up a code fix.
 */
export class ExpiredActiveTurnRecoveryBackoff {
  private readonly entries = new Map<string, BackoffEntry>();

  deferredInvestigationIds(nowMs: number): readonly string[] {
    return [...this.entries]
      .filter(([, entry]) => entry.retryAtMs > nowMs)
      .map(([investigationId]) => investigationId);
  }

  recordFailure(investigationId: string, nowMs: number): void {
    const failures = (this.entries.get(investigationId)?.failures ?? 0) + 1;
    const delayMs = Math.min(
      expiredActiveTurnRecoveryBackoffPolicy.initialDelayMs *
        2 ** Math.min(failures - 1, 16),
      expiredActiveTurnRecoveryBackoffPolicy.maxDelayMs,
    );
    this.entries.delete(investigationId);
    this.entries.set(investigationId, {
      failures,
      retryAtMs: nowMs + delayMs,
    });
    if (
      this.entries.size >
      expiredActiveTurnRecoveryBackoffPolicy.maxTrackedInvestigations
    ) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
  }

  clear(investigationId: string): void {
    this.entries.delete(investigationId);
  }
}
