import { afterEach, expect, test, vi } from "vitest";
import { accountLifecycleApi } from "./account-lifecycle-api";
import {
  mutateAccountLifecycle,
  continueAccountLifecycleOperation,
} from "./account-lifecycle-actions";
vi.mock("./account-lifecycle-actions", () => ({
  mutateAccountLifecycle: vi.fn(),
  continueAccountLifecycleOperation: vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
test("Check reads original operation or lost-ACK nonce through GET without invoking lifecycle writes", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(
      async () => new Response(JSON.stringify({ status: "unavailable" })),
    );
  vi.stubGlobal("fetch", fetch);
  expect(
    await accountLifecycleApi.read("actor", "workspace-A", {
      operationId: "original",
    }),
  ).toEqual({ status: "unavailable" });
  await accountLifecycleApi.read("actor", "workspace-A", {
    nonce: "saved-nonce",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(mutateAccountLifecycle).not.toHaveBeenCalled();
  expect(continueAccountLifecycleOperation).not.toHaveBeenCalled();
  fetch.mock.calls.forEach(([url, init], index) => {
    const request = new URL(String(url), "https://reviewrouter.test");
    expect(request.pathname).toBe("/api/dashboard/accounts/access");
    expect(request.searchParams.get("view")).toBe("lifecycle");
    expect(request.searchParams.get("context")).toBe("actor");
    expect(JSON.parse(request.searchParams.get("request")!)).toEqual({
      workspaceId: "workspace-A",
      ...(index === 0 ? { operationId: "original" } : { nonce: "saved-nonce" }),
    });
    expect(init).toEqual({
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    });
  });
});
