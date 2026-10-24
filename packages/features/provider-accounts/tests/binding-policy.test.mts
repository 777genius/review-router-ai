import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProviderAccountError,
  selectBinding,
  type WorkspaceAccountBinding,
  type ProviderAccountConnection,
} from "../src/domain/provider-account";

const binding: WorkspaceAccountBinding = {
  id: "binding-x",
  workspaceId: "workspace-x",
  connectionId: "connection-x",
  state: "revoked",
  revision: 9,
  policyRevision: 2,
  pendingFence: null,
  fenceAck: null,
};
const connection: ProviderAccountConnection = {
  id: "connection-x",
  owner: { kind: "workspace", workspaceId: "workspace-x" },
  gatewayAccountRef: "account-x",
  gatewayOperationRef: null,
  profileRef: "profile-x",
  displayName: "X",
  state: "active",
  metadataRevision: 1,
};
// Regression: selecting uses reconstructs policy from the binding CAS counter.
test("selection retains independent versions and the opaque binding subject", () => {
  assert.deepEqual(
    selectBinding("workspace-x", "binding-x", {
      binding: { ...binding, state: "active" },
      connection,
    }),
    {
      workspaceId: "workspace-x",
      bindingId: "binding-x",
      bindingRevision: 9,
      policySubject: "binding-x",
      policyRevision: 2,
      connectionId: "connection-x",
      gatewayAccountRef: "account-x",
      profileRef: "profile-x",
    },
  );
});

test("rebound selection waits for the retained fence; ACK alone cannot restore revoked state", () => {
  const rebound: WorkspaceAccountBinding = {
    ...binding,
    state: "active",
    revision: 3,
    policyRevision: 3,
    pendingFence: {
      operationId: "op-x-2",
      policySubject: "binding-x",
      policyRevision: 2,
    },
  };
  const unavailable = (e: unknown) =>
    e instanceof ProviderAccountError && e.code === "binding_unavailable";
  assert.throws(
    () =>
      selectBinding("workspace-x", "binding-x", {
        binding: rebound,
        connection,
      }),
    unavailable,
  );
  const acked: WorkspaceAccountBinding = {
    ...rebound,
    pendingFence: null,
    fenceAck: { operationId: "op-x-2", policyRevision: 2 },
  };
  assert.equal(
    selectBinding("workspace-x", "binding-x", {
      binding: acked,
      connection,
    }).policyRevision,
    3,
  );
  assert.throws(
    () =>
      selectBinding("workspace-x", "binding-x", {
        binding: { ...acked, state: "revoked" },
        connection,
      }),
    unavailable,
  );
});

// Regression: malformed storage tuples authorize negative, overflowing or missing versions.
test("both persisted versions are validated independently", () => {
  for (const field of ["revision", "policyRevision"] as const) {
    for (const value of [-1, 0, 1.5, NaN, 2147483648, undefined]) {
      assert.throws(
        () =>
          selectBinding("workspace-x", "binding-x", {
            binding: { ...binding, state: "active", [field]: value },
            connection,
          }),
        (e: unknown) =>
          e instanceof ProviderAccountError && e.code === "binding_unavailable",
      );
    }
  }
  assert.equal(
    selectBinding("workspace-x", "binding-x", {
      binding: {
        ...binding,
        state: "active",
        revision: 2147483647,
        policyRevision: 1,
      },
      connection,
    }).policyRevision,
    1,
  );
});

// Personal grants require fresh repository facts, including stable owner/target
// and safe source epoch. An operator designation cannot create personal use.
test("personal use is closed by default and requires the exact live donor/target", () => {
  const source: ProviderAccountConnection = {
    ...connection,
    owner: { kind: "user", userId: "donor-u" },
    authorizationEpochMirror: 7,
    pendingSourceOperationId: null,
  };
  const selected = {
    binding: { ...binding, state: "active" as const },
    connection: source,
  };
  const facts = {
    workspaceId: "workspace-x",
    personalOwnerUserId: null,
    donorUserId: "donor-u",
    donorRole: "admin" as const,
  };
  const denied = (error: unknown) =>
    error instanceof ProviderAccountError &&
    error.code === "connection_unavailable";
  assert.throws(
    () => selectBinding("workspace-x", "binding-x", selected),
    denied,
  );
  assert.throws(
    () => selectBinding("workspace-x", "binding-x", selected, "workspace-x"),
    denied,
  );
  assert.equal(
    selectBinding("workspace-x", "binding-x", {
      ...selected,
      personalUse: facts,
    }).expectedAuthorizationEpoch,
    7,
  );
  for (const personalUse of [
    { ...facts, workspaceId: "workspace-y" },
    { ...facts, donorUserId: "donor-v" },
    { ...facts, donorRole: "member" as const },
    { ...facts, donorRole: null },
    { ...facts, personalOwnerUserId: "donor-v" },
  ])
    assert.throws(
      () =>
        selectBinding("workspace-x", "binding-x", {
          ...selected,
          personalUse,
        }),
      denied,
    );
  // P ownership is stable User identity, independent of organization membership.
  assert.equal(
    selectBinding("workspace-x", "binding-x", {
      ...selected,
      personalUse: {
        ...facts,
        personalOwnerUserId: "donor-u",
        donorRole: null,
      },
    }).expectedAuthorizationEpoch,
    7,
  );
  const { authorizationEpochMirror: _epoch, ...withoutEpoch } = source;
  assert.equal(_epoch, 7);
  assert.throws(
    () =>
      selectBinding("workspace-x", "binding-x", {
        ...selected,
        personalUse: facts,
        connection: withoutEpoch,
      }),
    denied,
  );
  for (const authorizationEpochMirror of [
    null,
    0,
    -1,
    1.5,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.throws(
      () =>
        selectBinding("workspace-x", "binding-x", {
          ...selected,
          personalUse: facts,
          connection: { ...source, authorizationEpochMirror },
        }),
      denied,
    );
  }
  for (const patch of [
    { state: "pending" as const },
    { pendingSourceOperationId: "pending-op" },
  ]) {
    assert.throws(
      () =>
        selectBinding("workspace-x", "binding-x", {
          ...selected,
          personalUse: facts,
          connection: { ...source, ...patch },
        }),
      denied,
    );
  }
});

test("GLM cannot enter organization or operator execution through a saved binding", () => {
  const source: ProviderAccountConnection = {
    ...connection,
    profileRef: "glm-coding-global-responses-apikey-v1",
    owner: { kind: "user", userId: "donor-u" },
    authorizationEpochMirror: 7,
  };
  const selected = {
    binding: { ...binding, state: "active" as const },
    connection: source,
    personalUse: {
      workspaceId: "workspace-x",
      personalOwnerUserId: "donor-u",
      donorUserId: "donor-u",
      donorRole: null,
    },
  };
  assert.equal(
    selectBinding("workspace-x", "binding-x", selected)
      .expectedAuthorizationEpoch,
    7,
  );
  const denied = (error: unknown) =>
    error instanceof ProviderAccountError &&
    error.code === "connection_unavailable";
  for (const personalUse of [
    undefined,
    {
      ...selected.personalUse,
      personalOwnerUserId: null,
      donorRole: "owner" as const,
    },
    {
      ...selected.personalUse,
      personalOwnerUserId: null,
      donorRole: "admin" as const,
    },
    { ...selected.personalUse, personalOwnerUserId: "other-user" },
    { ...selected.personalUse, donorUserId: "other-user" },
    { ...selected.personalUse, workspaceId: "other-personal-workspace" },
  ]) {
    assert.throws(
      () =>
        selectBinding(
          "workspace-x",
          "binding-x",
          personalUse
            ? { ...selected, personalUse }
            : { binding: selected.binding, connection: selected.connection },
          "operator",
        ),
      denied,
    );
  }
  for (const ownerWorkspaceId of ["workspace-x", "operator"]) {
    assert.throws(
      () =>
        selectBinding(
          "workspace-x",
          "binding-x",
          {
            ...selected,
            connection: {
              ...source,
              owner: { kind: "workspace", workspaceId: ownerWorkspaceId },
            },
          },
          "operator",
        ),
      denied,
    );
  }
  // Other subscription profiles retain the existing explicit donor grant behavior.
  for (const profileRef of [
    "kimi-code-global-responses-apikey-v1",
    "minimax-mplan-global-responses-apikey-v1",
    "codex",
    "claude",
  ]) {
    assert.equal(
      selectBinding("workspace-x", "binding-x", {
        ...selected,
        connection: { ...source, profileRef },
        personalUse: {
          ...selected.personalUse,
          personalOwnerUserId: null,
          donorRole: "admin",
        },
      }).expectedAuthorizationEpoch,
      7,
    );
  }
});
