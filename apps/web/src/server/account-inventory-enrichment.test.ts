import { afterEach, expect, it, vi } from "vitest";
import { createAccountInventoryEnrichment } from "./account-inventory-enrichment";

afterEach(() => vi.useRealTimers());

it("bounds one page's held remote work and ignores late results after returning local inventory", async () => {
  vi.useFakeTimers();
  const page = createAccountInventoryEnrichment();
  const signals: AbortSignal[] = [];
  const finish: Array<(value: string) => void> = [];
  let active = 0;
  let peak = 0;
  const read = vi.fn((signal: AbortSignal) => {
    signals.push(signal);
    active++;
    peak = Math.max(peak, active);
    return new Promise<string>((resolve) =>
      finish.push((value) => {
        active--;
        resolve(value);
      }),
    );
  });
  const pending = page.map(
    Array.from({ length: 100 }, (_, index) => index),
    async (id) => ({
      id,
      value: await page.read(read).catch(() => "unknown"),
    }),
  );
  await vi.advanceTimersByTimeAsync(3000);
  const inventory = await pending;
  expect(inventory).toHaveLength(100);
  expect(inventory.map((entry) => entry.id)).toEqual(
    Array.from({ length: 100 }, (_, index) => index),
  );
  expect(inventory.every((entry) => entry.value === "unknown")).toBe(true);
  expect(peak).toBe(4);
  expect(active).toBe(4); // Cancellation did not falsely release real I/O ownership.
  expect(read).toHaveBeenCalledTimes(4);
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  page.close();
  finish.forEach((resolve) => resolve("late-private-value"));
  await vi.advanceTimersByTimeAsync(0);
  expect(active).toBe(0);
  expect(inventory.every((entry) => entry.value === "unknown")).toBe(true);
  expect(read).toHaveBeenCalledTimes(4);
  expect(vi.getTimerCount()).toBe(0);
});

it("starts its one deadline at the first remote read and shares it across later phases", async () => {
  vi.useFakeTimers();
  const page = createAccountInventoryEnrichment();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(vi.getTimerCount()).toBe(0);
  const catalog = page.read(async () => {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    return ["profile"];
  });
  await vi.advanceTimersByTimeAsync(2500);
  expect(await catalog).toEqual(["profile"]);
  let signal: AbortSignal | undefined;
  const rows = page.read((value) => {
    signal = value;
    return new Promise(() => {});
  });
  const failed = expect(rows).rejects.toThrow(
    "account_inventory_enrichment_unavailable",
  );
  await vi.advanceTimersByTimeAsync(500);
  await failed;
  expect(signal?.aborted).toBe(true);
  const later = vi.fn(async () => "late");
  await expect(page.read(later)).rejects.toThrow();
  expect(later).not.toHaveBeenCalled();
  page.close();
  expect(vi.getTimerCount()).toBe(0);
});
