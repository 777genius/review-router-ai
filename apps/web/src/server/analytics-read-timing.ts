/** Measure only known, authorized report reads. Log no actor, SQL or filters. */
export async function timeAnalyticsRead<T>(
  operation: "statistics.report" | "usage.report",
  read: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const started = now();
  try {
    return await read();
  } finally {
    const duration = Math.max(0, now() - started);
    if (duration >= 2_000)
      console.warn("analytics_read_slow", {
        operation,
        durationBucketMs: Math.min(30_000, Math.ceil(duration / 500) * 500),
      });
  }
}
