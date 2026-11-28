import { describe, expect, it, vi } from "vitest";
import type { LifecycleClient } from "@agent-teams/account-gateway/http";
import { createAccountLifecycleReader } from "./account-lifecycle-reader";
const suspended = {
  accountRef: "account",
  ownerRef: "owner",
  profileId: "profile",
  displayName: "TEST",
  state: "suspended",
  metadataRevision: 2,
  authorizationEpoch: 2,
  authKind: "api_key",
  resumeCustody: "verified",
};
describe("lifecycle protocol discovery independent of writes", () => {
  it("keeps suspended inventory readable through v2 with Gateway new writes closed", async () => {
    const legacy = { get: vi.fn() };
    const lifecycle = {
      capability: vi.fn(async () => ({ writeGate: "disabled" })),
      get: vi.fn(async () => suspended),
    } as unknown as LifecycleClient;
    const reader = createAccountLifecycleReader({ lifecycle, legacy });
    expect(await reader.compatible()).toBe(true);
    expect(await reader.writable()).toBe(false);
    expect(await reader.get("account")).toMatchObject({ state: "suspended" });
    expect(legacy.get).not.toHaveBeenCalled();
    expect(lifecycle.capability).toHaveBeenCalledOnce();
  });
});

it("propagates one inventory cancellation through capability and account reads", async () => {
  const controller = new AbortController();
  const options = { signal: controller.signal };
  const lifecycle = {
    capability: vi.fn(async () => ({ writeGate: "disabled" })),
    get: vi.fn(async () => suspended),
  } as unknown as LifecycleClient;
  const legacy = { get: vi.fn() };
  const reader = createAccountLifecycleReader({ lifecycle, legacy });
  expect(await reader.compatible(options)).toBe(true);
  expect(await reader.get("account", options)).toMatchObject({
    state: "suspended",
  });
  expect(lifecycle.capability).toHaveBeenCalledWith(options);
  expect(lifecycle.get).toHaveBeenCalledWith("account", options);
  expect(legacy.get).not.toHaveBeenCalled();
});

it("does not start another account read after delayed capability discovery observes cancellation", async () => {
  const controller = new AbortController();
  let finish!: () => void;
  const lifecycle = {
    capability: async () => {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { writeGate: "disabled" };
    },
    get: vi.fn(),
  } as unknown as LifecycleClient;
  const legacy = { get: vi.fn() };
  const reader = createAccountLifecycleReader({ lifecycle, legacy });
  const pending = reader.get("account", { signal: controller.signal });
  const rejected = expect(pending).rejects.toBeDefined();
  controller.abort();
  finish();
  await rejected;
  expect(lifecycle.get).not.toHaveBeenCalled();
  expect(legacy.get).not.toHaveBeenCalled();
});
