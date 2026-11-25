import { performance } from "node:perf_hooks";
import { setTimeout as pause } from "node:timers/promises";

/** Drive bounded E2E worker passes without spending them before a scheduled retry. */
export async function settleReviewWorker(input: {
  runMaintenance(): Promise<unknown>;
  hasActiveWork(): Promise<boolean>;
  nextEligibleAt(): Promise<Date | null>;
  maxPasses: number;
  timeoutMs?: number;
  now?: () => number;
  monotonicNow?: () => number;
  pause?: (delayMs: number) => Promise<void>;
}): Promise<boolean> {
  const now = input.now ?? Date.now;
  const monotonicNow = input.monotonicNow ?? (() => performance.now());
  const wait = input.pause ?? pause;
  const deadline = monotonicNow() + (input.timeoutMs ?? 30_000);

  for (let pass = 0; pass < input.maxPasses; pass += 1) {
    if (monotonicNow() >= deadline) return false;
    await input.runMaintenance();
    if (!(await input.hasActiveWork())) return true;
    if (pass + 1 === input.maxPasses || monotonicNow() >= deadline) break;

    const nextEligibleAt = await input.nextEligibleAt();
    const remainingMs = deadline - monotonicNow();
    if (remainingMs <= 0) break;
    const delayMs = Math.min(
      remainingMs,
      Math.max(0, (nextEligibleAt?.getTime() ?? now()) - now()),
    );
    if (delayMs > 0) await wait(delayMs);
  }
  return false;
}
