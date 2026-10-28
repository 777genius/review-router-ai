import { describe, expect, it, vi } from "vitest";
import {
  ProviderAccountError,
  type PersonalOperationResult,
} from "@reviewrouter/features-provider-accounts";
import { createPersonalAccountSharingApi } from "./personal-account-sharing";
import type { OwnOrganizationBinding } from "./personal-account-sharing-queries";

const nonce = "b85e1480-1960-4533-a04b-51dbeaf79fab";
const source = {
  id: "source",
  owner: { kind: "user" as const, userId: "alice" },
  gatewayAccountRef: "private-account",
  gatewayOperationRef: null,
  profileRef: "profile",
  displayName: "Mine",
  state: "active" as const,
  metadataRevision: 4,
  authorizationEpochMirror: 9,
  pendingSourceOperationId: null,
};
const binding = {
  id: "binding",
  workspaceId: "org",
  connectionId: "source",
  revision: 1,
  policyRevision: 1,
  state: "active" as const,
  pendingFence: null,
  fenceAck: null,
};
const attach = {
  nonce,
  sourceId: "source",
  targetWorkspaceId: "org",
  expectedSourceMetadataRevision: 4,
  predecessorBindingId: null,
  expectedPredecessorRevision: null,
};
const revoke = {
  nonce,
  sourceId: "source",
  targetWorkspaceId: "org",
  expectedSourceMetadataRevision: 4,
  bindingId: "binding",
  expectedBindingRevision: 1,
};
function operation(
  action: "attach" | "revoke" = "attach",
): PersonalOperationResult {
  const common = {
    actorUserId: "alice",
    clientOperationId: nonce,
    personalWorkspaceId: "personal",
    sourceId: "source",
    targetWorkspaceId: "org",
    expectedSourceMetadataRevision: 4,
    expectedGatewayRevision: 17,
  };
  return {
    id: "operation",
    phase: "applied",
    available: action === "attach",
    source,
    binding:
      action === "attach"
        ? binding
        : {
            ...binding,
            revision: 2,
            policyRevision: 2,
            state: "revoked",
            pendingFence: {
              operationId: "operation",
              policySubject: "binding",
              policyRevision: 2,
            },
          },
    intent:
      action === "attach"
        ? {
            ...common,
            action,
            predecessorBindingId: null,
            expectedPredecessorRevision: null,
          }
        : {
            ...common,
            action,
            bindingId: "binding",
            expectedBindingRevision: 1,
          },
  };
}
function fixture() {
  let actor = "alice";
  let saved: PersonalOperationResult | null = null;
  const authorizeUser = vi.fn(async () => actor);
  const store = {
    readOperation: vi.fn(async () => {
      if (!saved) throw new ProviderAccountError("not_found");
      return saved;
    }),
    findOwnedSource: vi.fn(async () => source),
  };
  const gateway = {
    get: vi.fn(async () => ({
      accountRef: "private-account",
      profileId: "profile",
      displayName: "Mine",
      state: "active",
      metadataRevision: 17,
      authorizationEpoch: 9,
    })),
    operation: vi.fn(),
  };
  const queries = {
    listOwnAccessSummaries: vi.fn(async () => []),
    listOwnOrgBindings: vi.fn(async () => ({
      items: [] as OwnOrganizationBinding[],
      nextAfterId: null,
    })),
    listEligibleOrganizations: vi.fn(async () => ({
      items: [],
      nextAfterId: null,
    })),
  };
  const adapter = {
    list: vi.fn(async () => ({ sources: [], nextCursor: null })),
    attach: vi.fn(async () => {
      saved = operation();
      return {
        operationId: "operation",
        phase: "applied",
        sourceId: "source",
        bindingId: "binding",
        available: true,
        state: "active",
      };
    }),
    revoke: vi.fn(async () => {
      saved = operation("revoke");
      return {
        operation: {
          operationId: "operation",
          phase: "applied",
          sourceId: "source",
          bindingId: "binding",
          available: false,
          state: "revoked",
        },
        remoteFenceDelivery: "remote_pending" as const,
      };
    }),
    operation: vi.fn(async () => ({
      operationId: "operation",
      phase: "applied",
      sourceId: "source",
      bindingId: "binding",
      available: true,
      state: "active",
    })),
  };
  const readBindingAttachOperation = vi.fn(async () => operation());
  const deps = {
    authorizeUser,
    store,
    gateway,
    queries,
    readBindingAttachOperation,
    createAdapter: vi.fn<(authorize: () => Promise<string>) => typeof adapter>(
      () => adapter,
    ),
  };
  // Unused store writers are deliberately absent: this boundary delegates to C2.
  const api = createPersonalAccountSharingApi(
    deps as unknown as Parameters<typeof createPersonalAccountSharingApi>[0],
  );
  return {
    api,
    deps,
    adapter,
    store,
    gateway,
    queries,
    readBindingAttachOperation,
    setActor(value: string) {
      actor = value;
    },
    setSaved(value: PersonalOperationResult) {
      saved = value;
    },
  };
}
describe("personal sharing session and original intent boundary", () => {
  it("rejects caller-selected Gateway counters and unknown properties before reads", async () => {
    const f = fixture();
    expect(
      await f.api.attach({
        ...attach,
        expectedGatewayRevision: 999,
      } as typeof attach),
    ).toEqual({ status: "invalid" });
    expect(f.store.readOperation).not.toHaveBeenCalled();
    expect(f.gateway.get).not.toHaveBeenCalled();
  });
  it("checks session again after recipient reads and withholds their result on account switch", async () => {
    const f = fixture();
    f.queries.listOwnOrgBindings.mockImplementation(async () => {
      f.setActor("bob");
      return { items: [], nextAfterId: null };
    });
    expect(
      await f.api.listOwnGrants({ sourceId: "source", limit: 10 }),
    ).toEqual({ status: "denied" });
    expect(f.queries.listOwnOrgBindings).toHaveBeenCalledWith({
      actorUserId: "alice",
      sourceId: "source",
      limit: 10,
    });
  });
  it("preserves no-fence-required for active grants and projects only safe query fields", async () => {
    const f = fixture();
    const grant = {
      bindingId: "binding",
      sourceId: "source",
      targetWorkspaceId: "org",
      organizationLabel: "Organization",
      revision: 1,
      state: "active" as const,
      remoteFenceDelivery: "not_required" as const,
      canRevoke: true,
      privateGatewayRef: "private-account",
    };
    f.queries.listOwnOrgBindings.mockResolvedValue({
      items: [grant],
      nextAfterId: null,
    });
    const result = await f.api.listOwnGrants({ sourceId: "source", limit: 10 });
    expect(result).toMatchObject({
      status: "ok",
      value: {
        grants: [{ state: "active", remoteFenceDelivery: "not_required" }],
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-account");
  });
  it("rejects duplicate sources and invalid cursors without querying recipients", async () => {
    const f = fixture();
    expect(
      await f.api.listEligibleOrganizations({
        sourceIds: ["source", "source"],
        limit: 10,
      }),
    ).toEqual({ status: "invalid" });
    expect(
      await f.api.listOwnGrants({
        sourceId: "source",
        afterBindingId: "secret/token",
        limit: 10,
      }),
    ).toEqual({ status: "invalid" });
    expect(f.queries.listEligibleOrganizations).not.toHaveBeenCalled();
    expect(f.queries.listOwnOrgBindings).not.toHaveBeenCalled();
  });
  it("replays the original nonce before checking later source metadata or contacting Gateway", async () => {
    const f = fixture();
    f.setSaved(operation());
    f.store.findOwnedSource.mockRejectedValue(
      new Error("later source retired"),
    );
    expect((await f.api.attach(attach)).status).toBe("ok");
    expect(f.store.findOwnedSource).not.toHaveBeenCalled();
    expect(f.gateway.get).not.toHaveBeenCalled();
    expect(f.adapter.attach).not.toHaveBeenCalled();
    expect(
      await f.api.attach({ ...attach, targetWorkspaceId: "different-org" }),
    ).toEqual({ status: "conflict" });
    expect(
      await f.api.attach({ ...attach, expectedSourceMetadataRevision: 5 }),
    ).toEqual({ status: "conflict" });
  });
  it("derives the attach counter from an owner-scoped Gateway read and returns only a safe projection", async () => {
    const f = fixture();
    const result = await f.api.attach(attach);
    expect(f.gateway.get).toHaveBeenCalledWith(
      "alice",
      "private-account",
      "profile",
    );
    expect(f.adapter.attach).toHaveBeenCalledWith({
      ...attach,
      expectedGatewayRevision: 17,
    });
    expect(result.status).toBe("ok");
    expect(JSON.stringify(result)).not.toContain("private-account");
    expect(JSON.stringify(result)).not.toContain("expectedGatewayRevision");
  });
  it("stops before Gateway and mutation when session changes during a source read", async () => {
    const f = fixture();
    f.store.findOwnedSource.mockImplementation(async () => {
      f.setActor("bob");
      return source;
    });
    expect(await f.api.attach(attach)).toEqual({ status: "denied" });
    expect(f.gateway.get).not.toHaveBeenCalled();
    expect(f.adapter.attach).not.toHaveBeenCalled();
  });
  it("passes C2 a session callback that refuses a different actor", async () => {
    const f = fixture();
    await f.api.listSources({ limit: 10 });
    const scopedAuthorize = f.deps.createAdapter.mock.calls[0]![0];
    f.setActor("bob");
    await expect(scopedAuthorize()).rejects.toThrow();
  });
  it("revoke uses its exact original attach counter even when Gateway is unavailable", async () => {
    const f = fixture();
    f.gateway.get.mockRejectedValue(new Error("private remote failure"));
    const result = await f.api.revoke(revoke);
    expect(f.readBindingAttachOperation).toHaveBeenCalledWith(
      "alice",
      "binding",
    );
    expect(f.adapter.revoke).toHaveBeenCalledWith({
      ...revoke,
      expectedGatewayRevision: 17,
    });
    expect(f.gateway.get).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "ok",
      value: {
        remoteFenceDelivery: "remote_pending",
        operation: { state: "revoked", available: false },
      },
    });
  });
  it("retains the actual local revoke receipt when its later read fails", async () => {
    const f = fixture();
    let reads = 0;
    f.store.readOperation.mockImplementation(async () => {
      if (++reads === 1) throw new ProviderAccountError("not_found");
      throw new Error("post-commit database unavailable");
    });
    expect(await f.api.revoke(revoke)).toEqual({
      status: "ok",
      value: {
        operation: {
          operationId: "operation",
          phase: "applied",
          sourceId: "source",
          bindingId: "binding",
          available: false,
          state: "revoked",
        },
        remoteFenceDelivery: "remote_pending",
      },
    });
    expect(f.adapter.revoke).toHaveBeenCalledTimes(1);
    expect(f.gateway.get).not.toHaveBeenCalled();
  });
  it("withholds the known revoke receipt if the session changes during its later read", async () => {
    const f = fixture();
    let reads = 0;
    f.store.readOperation.mockImplementation(async () => {
      if (++reads === 1) throw new ProviderAccountError("not_found");
      f.setActor("bob");
      throw new Error("post-commit database unavailable");
    });
    expect(await f.api.revoke(revoke)).toEqual({ status: "denied" });
    expect(f.adapter.revoke).toHaveBeenCalledTimes(1);
  });
  it("does not invent a committed revoke receipt when C2 itself fails", async () => {
    const f = fixture();
    f.adapter.revoke.mockRejectedValue(new Error("no safe receipt"));
    expect(await f.api.revoke(revoke)).toEqual({ status: "unavailable" });
    expect(f.adapter.revoke).toHaveBeenCalledTimes(1);
    expect(f.store.readOperation).toHaveBeenCalledTimes(1);
  });
  it("rejects a stale exact binding revision and a different original source", async () => {
    const f = fixture();
    expect(
      await f.api.revoke({ ...revoke, expectedBindingRevision: 2 }),
    ).toEqual({ status: "conflict" });
    f.readBindingAttachOperation.mockResolvedValue({
      ...operation(),
      binding: { ...binding, connectionId: "foreign" },
    });
    expect(await f.api.revoke(revoke)).toEqual({ status: "denied" });
    expect(f.adapter.revoke).not.toHaveBeenCalled();
  });
  it("recovers revoke without current tuple reads and rejects changed retry payload", async () => {
    const f = fixture();
    f.setSaved(operation("revoke"));
    expect((await f.api.revoke(revoke)).status).toBe("ok");
    expect(f.readBindingAttachOperation).not.toHaveBeenCalled();
    expect(f.store.findOwnedSource).not.toHaveBeenCalled();
    expect(
      await f.api.revoke({ ...revoke, bindingId: "other-binding" }),
    ).toEqual({ status: "conflict" });
  });
  it("sanitizes transport diagnostics and checks operation readback after await", async () => {
    const f = fixture();
    f.gateway.get.mockRejectedValue(new Error("authorization=secret-token"));
    expect(await f.api.attach(attach)).toEqual({ status: "unavailable" });
    f.adapter.operation.mockImplementation(async () => {
      f.setActor("bob");
      throw new Error("callback=https://private");
    });
    expect(await f.api.readOperation(nonce)).toEqual({ status: "denied" });
  });
  it("keeps local revoke pending when the bounded fence repository is unavailable", async () => {
    const f = fixture();
    const api = createPersonalAccountSharingApi({
      ...f.deps,
      bindingFences: {
        accounts: {
          listPendingBindingFences: vi.fn(async () => {
            throw new Error("database secret");
          }),
          acknowledgeBindingFence: vi.fn(),
        },
        delivery: { submitFence: vi.fn(), readFenceOperation: vi.fn() },
      },
    } as unknown as Parameters<typeof createPersonalAccountSharingApi>[0]);
    expect(await api.revoke(revoke)).toMatchObject({
      status: "ok",
      value: {
        remoteFenceDelivery: "remote_pending",
        operation: { state: "revoked" },
      },
    });
    expect(f.adapter.revoke).toHaveBeenCalledTimes(1);
  });
  it("reports remote applied only after exact fence ACK is stored and re-read", async () => {
    const f = fixture();
    const pending = operation("revoke");
    const submitFence = vi.fn(async () => ({
      state: "applied" as const,
      operationId: "operation",
      policySubject: "binding",
      policyRevision: 2,
    }));
    const api = createPersonalAccountSharingApi({
      ...f.deps,
      bindingFences: {
        accounts: {
          listPendingBindingFences: vi.fn(async () => [pending.binding!]),
          acknowledgeBindingFence: vi.fn(async () => {
            f.setSaved({
              ...pending,
              binding: {
                ...pending.binding!,
                pendingFence: null,
                fenceAck: { operationId: "operation", policyRevision: 2 },
              },
            });
            return true;
          }),
        },
        delivery: { submitFence, readFenceOperation: vi.fn() },
      },
    } as unknown as Parameters<typeof createPersonalAccountSharingApi>[0]);
    expect(await api.revoke(revoke)).toMatchObject({
      status: "ok",
      value: { remoteFenceDelivery: "remote_applied" },
    });
    expect(submitFence).toHaveBeenCalledWith({
      bindingId: "binding",
      workspaceId: "org",
      operationId: "operation",
      policySubject: "binding",
      policyRevision: 2,
    });
  });
});
