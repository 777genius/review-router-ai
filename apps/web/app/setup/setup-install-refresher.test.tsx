// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SetupInstallRefresher } from "./setup-install-refresher";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("re-checks the install with backoff and gives up after five minutes", async () => {
  vi.useFakeTimers();
  render(<SetupInstallRefresher />);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(3_000);
  });
  expect(router.refresh).toHaveBeenCalledTimes(1);

  // The last check is scheduled before five minutes and runs at most 30 s later.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(6 * 60_000);
  });
  const refreshes = router.refresh.mock.calls.length;
  // 3 s at first, then a quarter of the wait, at most every 30 s.
  expect(refreshes).toBeGreaterThan(5);
  expect(refreshes).toBeLessThan(25);

  await act(async () => {
    await vi.advanceTimersByTimeAsync(10 * 60_000);
  });
  expect(router.refresh).toHaveBeenCalledTimes(refreshes);
});
