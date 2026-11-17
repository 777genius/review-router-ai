import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ProviderAccountError,
  type PersonalOperationResult,
} from "@reviewrouter/features-provider-accounts";
import {
  connectAttachNonce,
  createConnectWorkspaceAttach,
} from "./personal-connect-attach";

const connectNonce = "b85e1480-1960-4533-a04b-51dbeaf79fab";
const source = {
  id: "source",
  owner: { kind: "user" as const, userId: "alice" },
  gatewayAccountRef: "private-account",
  gatewayOperationRef: null,
  profileRef: "codex-oauth-v1",
  displayName: "Mine",
  state: "active" as const,
  metadataRevision: 3,
  authorizationEpochMirror: 9,
  pendingSourceOperationId: null,
};
function connect(
  overrides: Partial<PersonalOperationResult> = {},
): PersonalOperationResult {
  return {
    id: "operation",
    phase: "applied",
    available: true,
    source,
    binding: {
      id: "personal-binding",
      workspaceId: "personal",
      connectionId: "source",
      revision: 1,
      policyRevision: 1,
      state: "active",
      pendingFence: null,
      fenceAck: null,
    },
    intent: {
      action: "connect",
      actorUserId: "alice",
      clientOperationId: connectNonce,
      personalWorkspaceId: "personal",
      proposedSourceId: "source",
      profileId: source.profileRef,
      displayName: "Mine",
      ingress: "oauth-begin",
    },
    ...overrides,
  };
}
const receipt = (available: boolean) => ({
  status: "ok" as const,
  value: {
    operation: {
      operationId: "attach-operation",
      phase: "applied",
      sourceId: "source",
      bindingId: "org-binding",
      available,
      state: available ? "active" : "revoked",
    },
  },
});
function storedAttach(available: boolean): PersonalOperationResult {
  return {
    ...connect({ available }),
    intent: {
      action: "attach",
      actorUserId: "alice",
      clientOperationId: connectAttachNonce(connectNonce, "org"),
      personalWorkspaceId: "personal",
      sourceId: "source",
      targetWorkspaceId: "org",
      expectedSourceMetadataRevision: 3,
      expectedGatewayRevision: 7,
      predecessorBindingId: null,
      expectedPredecessorRevision: null,
    },
  };
}
function setup(
  input: {
    operation?: PersonalOperationResult;
    stored?: PersonalOperationResult;
    access?:
      | { personal: boolean; canDetach: boolean }
      | ProviderAccountError
      | Error;
    attach?: Awaited<
      ReturnType<Parameters<typeof createConnectWorkspaceAttach>[0]["attach"]>
    >;
    activeBinding?: boolean;
  } = {},
) {
  const deps = {
    actorUserId: "alice",
    readOperation: vi.fn(async (nonce: string) => {
      if (nonce === connectNonce) return input.operation ?? connect();
      if (input.stored) return input.stored;
      throw new ProviderAccountError("not_found");
    }),
    workspaceAccess: vi.fn(async () => {
      const access = input.access ?? { personal: false, canDetach: true };
      if (access instanceof Error) throw access;
      return access;
    }),
    hasActiveBinding: vi.fn(async () => input.activeBinding ?? false),
    attach: vi.fn(async () => input.attach ?? receipt(true)),
  };
  return { deps, attachConnected: createConnectWorkspaceAttach(deps) };
}

describe("adding a new personal connection to the current workspace", () => {
  it("attaches through the owner attach operation for a workspace owner or admin", async () => {
    const { deps, attachConnected } = setup();

    await expect(attachConnected("org", connectNonce)).resolves.toEqual({
      status: "attached",
    });
    expect(deps.readOperation).toHaveBeenCalledWith(connectNonce);
    expect(deps.workspaceAccess).toHaveBeenCalledWith("org");
    expect(deps.attach).toHaveBeenCalledExactlyOnceWith({
      nonce: connectAttachNonce(connectNonce, "org"),
      sourceId: "source",
      targetWorkspaceId: "org",
      expectedSourceMetadataRevision: 3,
      predecessorBindingId: null,
      expectedPredecessorRevision: null,
    });
  });

  it("uses one stable, valid attach identity per connect and workspace", () => {
    const first = connectAttachNonce(connectNonce, "org");
    expect(first).toBe(connectAttachNonce(connectNonce, "org"));
    expect(first).not.toBe(connectAttachNonce(connectNonce, "other-org"));
    expect(z.string().uuid().safeParse(first).success).toBe(true);
  });

  it("does not attach for a plain member and says why", async () => {
    const { deps, attachConnected } = setup({
      access: { personal: false, canDetach: false },
    });

    await expect(attachConnected("org", connectNonce)).resolves.toEqual({
      status: "not_attached",
      reason: "not_permitted",
    });
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it("does not attach to a workspace the actor cannot access", async () => {
    const { deps, attachConnected } = setup({
      access: new ProviderAccountError("workspace_forbidden"),
    });

    await expect(attachConnected("org", connectNonce)).resolves.toEqual({
      status: "not_attached",
      reason: "not_permitted",
    });
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it("keeps a personal-only plan out of a shared workspace", async () => {
    const { deps, attachConnected } = setup({
      operation: connect({
        source: {
          ...source,
          profileRef: "glm-coding-global-responses-apikey-v1",
        },
      }),
    });

    await expect(attachConnected("org", connectNonce)).resolves.toEqual({
      status: "not_attached",
      reason: "personal_only",
    });
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it("reports the binding connect already made in the owner's personal workspace", async () => {
    const { deps, attachConnected } = setup({
      operation: connect({
        source: {
          ...source,
          profileRef: "glm-coding-global-responses-apikey-v1",
        },
      }),
      access: { personal: true, canDetach: false },
    });

    await expect(attachConnected("personal", connectNonce)).resolves.toEqual({
      status: "attached",
    });
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it("never attaches a connection that is not applied", async () => {
    for (const operation of [
      connect({ phase: "submitted", source: null, binding: null }),
      connect({ phase: "unknown" }),
    ]) {
      const { deps, attachConnected } = setup({ operation });
      await expect(attachConnected("org", connectNonce)).resolves.toEqual({
        status: "not_attached",
        reason: "not_connected",
      });
      expect(deps.workspaceAccess).not.toHaveBeenCalled();
      expect(deps.attach).not.toHaveBeenCalled();
    }
  });

  it("refuses a source owned by someone else", async () => {
    const { deps, attachConnected } = setup({
      operation: connect({
        source: { ...source, owner: { kind: "user", userId: "mallory" } },
      }),
    });

    await expect(attachConnected("org", connectNonce)).rejects.toMatchObject({
      code: "workspace_forbidden",
    });
    expect(deps.attach).not.toHaveBeenCalled();
  });

  it("reports a stored attach without sending another one", async () => {
    const kept = setup({ stored: storedAttach(true) });
    await expect(kept.attachConnected("org", connectNonce)).resolves.toEqual({
      status: "attached",
    });
    expect(kept.deps.attach).not.toHaveBeenCalled();

    // After the workspace use was revoked the original receipt is final.
    const revoked = setup({ stored: storedAttach(false) });
    await expect(revoked.attachConnected("org", connectNonce)).resolves.toEqual(
      { status: "not_attached", reason: "removed" },
    );
    expect(revoked.deps.attach).not.toHaveBeenCalled();
  });

  it("does not report a fresh attach that is not available as added", async () => {
    const { attachConnected } = setup({ attach: receipt(false) });

    await expect(attachConnected("org", connectNonce)).resolves.toEqual({
      status: "not_attached",
      reason: "unavailable",
    });
  });

  it("maps refusals from the attach operation", async () => {
    await expect(
      setup({ attach: { status: "denied" } }).attachConnected(
        "org",
        connectNonce,
      ),
    ).resolves.toEqual({ status: "not_attached", reason: "not_permitted" });
    await expect(
      setup({ attach: { status: "conflict" } }).attachConnected(
        "org",
        connectNonce,
      ),
    ).resolves.toEqual({ status: "not_attached", reason: "unavailable" });
    await expect(
      setup({
        attach: { status: "conflict" },
        activeBinding: true,
      }).attachConnected("org", connectNonce),
    ).resolves.toEqual({ status: "attached" });
  });

  it("rejects malformed input before reading anything", async () => {
    const { deps, attachConnected } = setup();

    await expect(attachConnected("org", "not-a-nonce")).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(attachConnected("../org", connectNonce)).rejects.toMatchObject(
      { code: "invalid_input" },
    );
    expect(deps.readOperation).not.toHaveBeenCalled();
  });
});
