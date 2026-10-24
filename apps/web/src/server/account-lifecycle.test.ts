import { describe, expect, it, vi } from "vitest";
import {
  createAccountLifecycleService,
  lifecycleProjection,
} from "./account-lifecycle";
import type {
  AccountLifecycleReceipt,
  AccountLifecycleDependencies,
} from "@reviewrouter/features-provider-accounts/synchronization";
const request = {
  nonce: "c19a6238-6aa2-4f70-93d8-83bdc4298fbc",
  connectionId: "source",
  action: "delete" as const,
  mirrorRevision: 1,
  gatewayRevision: 2,
  authorizationEpoch: 3,
};
function setup() {
  const order: string[] = [];
  const receipt = {
    id: "ledger",
    intent: {
      actorUserId: "user",
      clientOperationId: request.nonce,
      sourceId: "source",
      personalWorkspaceId: "personal",
      owningWorkspaceId: null,
      expectedSourceMetadataRevision: 1,
      expectedGatewayRevision: 2,
      expectedAuthorizationEpoch: 3,
      action: "delete",
    },
    phase: "fencing",
    source: {
      id: "source",
      gatewayAccountRef: "account",
      profileRef: "profile",
    },
    retirementOperationId: null,
    closureComplete: false,
  } as AccountLifecycleReceipt;
  const store = {
    reserve: vi.fn(async () => {
      order.push("deny");
      return receipt;
    }),
    read: vi.fn(async () => receipt),
    ready: vi.fn(async () => receipt),
    claim: vi.fn(async () => null),
    enterClaim: vi.fn(async () => true),
    listFences: vi.fn(async () => []),
    unknown: vi.fn(async () => {}),
    finalize: vi.fn(),
  } as unknown as AccountLifecycleDependencies["store"];
  const gateway = { preflight: vi.fn(), submit: vi.fn(), read: vi.fn() };
  const deliverFences = vi.fn(async () => {});
  const compatible = vi.fn(async () => {
    order.push("remote-capability");
    return true;
  });
  const service = createAccountLifecycleService({
    deps: { store, gateway, authorize: async () => {} },
    authorize: async () => ({ userId: "user", personal: false }),
    scopeForSource: async () => ({
      personalWorkspaceId: "personal",
      owningWorkspaceId: null,
    }),
    compatible,
    deliverFences,
  });
  return { service, receipt, store, gateway, order, deliverFences, compatible };
}
describe("account lifecycle server policy", () => {
  it("observational Check never delivers pending fences or enters account ingress", async () => {
    const f = setup();
    await f.service.read("organization", "ledger");
    expect(f.deliverFences).not.toHaveBeenCalled();
    expect(f.store.claim).not.toHaveBeenCalled();
    expect(f.gateway.submit).not.toHaveBeenCalled();
  });
  it("observational Check finalizes original readback with the write gate closed and without replay", async () => {
    const f = setup();
    f.compatible.mockResolvedValue(false);
    (f.receipt as { phase: string }).phase = "unknown";
    f.gateway.read.mockResolvedValue({
      command: {
        operationId: "ledger",
        accountRef: "account",
        profileId: "profile",
        expectedMetadataRevision: 2,
        action: "delete",
      },
      state: "applied",
      account: {
        accountRef: "account",
        profileId: "profile",
        displayName: "TEST",
        state: "disabled",
        metadataRevision: 3,
        authorizationEpoch: 4,
      },
      retirementOperationId: "ledger",
      closure: {
        retirementOperationId: "ledger",
        bindingErasureProofRef: "binding",
        transportErasureProofRef: "transport",
        nativeErasureProofRef: "native",
      },
      noEffectProofRef: null,
    });
    vi.mocked(f.store.finalize).mockImplementation(async () => {
      Object.assign(f.receipt, { phase: "applied", closureComplete: true });
      return f.receipt;
    });
    expect(await f.service.read("organization", "ledger")).toMatchObject({
      phase: "applied",
      closureComplete: true,
    });
    expect(f.store.finalize).toHaveBeenCalledOnce();
    expect(f.deliverFences).not.toHaveBeenCalled();
    expect(f.gateway.submit).not.toHaveBeenCalled();
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.store.claim).not.toHaveBeenCalled();
  });

  it("keeps unverified retirement visibly deleting instead of treating it as legacy disabled", () => {
    expect(
      lifecycleProjection({
        owned: true,
        compatible: true,
        state: "disabled",
        pendingOperationId: "original-delete",
        pendingAction: "delete",
        operationReadable: true,
        synchronized: false,
      }),
    ).toEqual({
      lifecycle: {
        status: "pending",
        action: "delete",
        operationId: "original-delete",
      },
      actions: [],
    });
  });
  it("continues only the durable original operation for a current owning admin, without reserving another nonce", async () => {
    const f = setup();
    (f.receipt as { phase: string }).phase = "ready";
    Object.assign(f.receipt.intent, {
      actorUserId: "original-admin",
      personalWorkspaceId: null,
      owningWorkspaceId: "organization",
    });
    vi.mocked(f.store.claim).mockResolvedValue({ claimToken: "claim" });
    await f.service.continue("organization", "ledger");
    expect(f.store.reserve).not.toHaveBeenCalled();
    expect(f.store.read).toHaveBeenCalledWith("user", "ledger");
    expect(f.gateway.submit).toHaveBeenCalledWith({
      operationId: "ledger",
      accountRef: "account",
      profileId: "profile",
      expectedMetadataRevision: 2,
      action: "delete",
    });
  });
  it("does not re-submit a submitted or uncertain durable operation through Continue", async () => {
    const f = setup();
    for (const phase of ["submitted", "unknown"] as const) {
      (f.receipt as { phase: string }).phase = phase;
      await f.service.continue("organization", "ledger");
    }
    expect(f.gateway.submit).not.toHaveBeenCalled();
    expect(f.store.reserve).not.toHaveBeenCalled();
  });

  it("commits delete denial before capability I/O and preserves actual personal ownership from an org view", async () => {
    const { service, store, order } = setup();
    const result = await service.mutate("organization", request);
    expect(order).toEqual(["deny", "remote-capability"]);
    expect(store.reserve).toHaveBeenCalledWith(
      expect.objectContaining({
        personalWorkspaceId: "personal",
        owningWorkspaceId: null,
      }),
    );
    expect(result.closureComplete).toBe(false);
  });
  it("read never submits remote ingress even when reservation becomes ready", async () => {
    const { service, gateway, receipt } = setup();
    (receipt as { phase: string }).phase = "ready";
    await service.read("organization", "ledger");
    expect(gateway.submit).not.toHaveBeenCalled();
  });
  it("does not expose operation handles or lifecycle controls to recipient viewers", () => {
    const result = lifecycleProjection({
      owned: false,
      compatible: true,
      state: "pending",
      pendingOperationId: "private-ledger",
      synchronized: true,
    });
    expect(result.actions).toEqual([]);
    expect(result.lifecycle).not.toHaveProperty("operationId");
  });
  it("legacy disabled never advertises a delete the reservation store refuses", () => {
    // The store and the lifecycle_source_cas guard reserve delete only from
    // active/suspended/quarantined, so any advertised action would be dead.
    for (const row of [
      { owned: true, compatible: true, synchronized: true },
      { owned: true, compatible: false, synchronized: false },
      { owned: false, compatible: true, synchronized: true },
    ])
      expect(
        lifecycleProjection({
          ...row,
          state: "disabled",
          pendingOperationId: null,
        }),
      ).toEqual({ lifecycle: { status: "support_required" }, actions: [] });
  });
  it("suspended resume requires authoritative retained-custody proof", () => {
    const row = {
      owned: true,
      compatible: true,
      state: "suspended",
      pendingOperationId: null,
      synchronized: true,
    };
    expect(lifecycleProjection(row).actions).toEqual(["delete"]);
    expect(
      lifecycleProjection({ ...row, custodyVerified: true }).actions,
    ).toEqual(["resume", "delete"]);
  });
});
