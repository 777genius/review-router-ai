/** Bound close-authority I/O separately from native cleanup. Permits stay held
 * until the actual I/O settles, even if a caller's deadline has elapsed. */
export function createCloseAuthorityGate(limit: number) {
  let active = 0;
  let urgentStreak = 0;
  const urgent: Array<() => void> = [];
  const normal: Array<() => void> = [];

  const drain = () => {
    while (active < limit && (urgent.length || normal.length)) {
      const takeUrgent =
        urgent.length > 0 && (normal.length === 0 || urgentStreak < 3);
      const next = takeUrgent ? urgent.shift() : normal.shift();
      urgentStreak = takeUrgent ? urgentStreak + 1 : 0;
      active++;
      next!();
    }
  };

  return async function run<T>(
    priority: "normal" | "urgent",
    work: () => Promise<T>,
  ): Promise<T> {
    await new Promise<void>((resolve) => {
      (priority === "urgent" ? urgent : normal).push(resolve);
      drain();
    });
    try {
      return await work();
    } finally {
      active--;
      drain();
    }
  };
}
