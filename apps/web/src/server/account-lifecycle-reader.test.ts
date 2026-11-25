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
