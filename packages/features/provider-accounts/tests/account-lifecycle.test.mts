import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beginAccountLifecycle,
  submitAccountLifecycle,
  readAccountLifecycle,
} from "../src/application/use-cases/account-lifecycle";
import {
  accountLifecycleIntentHash,
  type AccountLifecycleIntent,
} from "../src/domain/account-lifecycle";
import type {
  AccountLifecycleGatewayPort,
  AccountLifecycleOperationStore,
  AccountLifecycleReceipt,
} from "../src/application/ports/account-lifecycle-operation-port";
const intent: AccountLifecycleIntent = {
  actorUserId: "user",
  clientOperationId: "nonce",
  personalWorkspaceId: "personal",
  owningWorkspaceId: null,
  sourceId: "source",
  expectedSourceMetadataRevision: 1,
  expectedGatewayRevision: 3,
  expectedAuthorizationEpoch: 4,
  action: "suspend",
};
function fixture(action: AccountLifecycleIntent["action"] = "suspend") {
  let receipt: AccountLifecycleReceipt = {
    id: "operation",
    intent: { ...intent, action },
    phase: "ready",
    source: {
      id: "source",
      owner: { kind: "user", userId: "user" },
      gatewayAccountRef: "account",
      gatewayOperationRef: null,
      profileRef: "profile",
      displayName: "Connection",
      state: "pending",
      metadataRevision: 2,
      authorizationEpochMirror: 4,
      pendingSourceOperationId: "operation",
    },
    retirementOperationId: null,
    closureComplete: false,
  };
  let submits = 0,
    releases = 0,
    finalized = 0,
    rejects = 0;
  let readback: AccountLifecycleGatewayPort["read"] = async (command) => ({
    command,
    state: "unknown",
    account: null,
    retirementOperationId: null,
    closure: null,
    noEffectProofRef: null,
  });
  const store: AccountLifecycleOperationStore = {
    reserve: async (request) => {
      if (
        accountLifecycleIntentHash(request) !==
        accountLifecycleIntentHash(receipt.intent)
      )
        throw Error("conflict");
      return receipt;
    },
    read: async () => receipt,
    listFences: async () => [],
    ready: async () => receipt,
    claim: async () => {
      if (receipt.phase !== "ready") return null;
      receipt = { ...receipt, phase: "submitted" };
      return { claimToken: "claim" };
    },
    enterClaim: async () => true,
    releaseUnenteredClaim: async () => {
      releases++;
      receipt = { ...receipt, phase: "ready" };
      return true;
    },
    unknown: async () => {
      if (["submitted", "unknown"].includes(receipt.phase))
        receipt = { ...receipt, phase: "unknown" };
    },
    reject: async () => {
      rejects++;
      receipt = { ...receipt, phase: "rejected" };
      return receipt;
    },
    finalize: async (_actor, _id, _account, retirement, closure) => {
      finalized++;
      receipt = {
        ...receipt,
        phase: action === "delete" && !closure ? "unknown" : "applied",
        retirementOperationId: retirement,
        closureComplete: !!closure,
      };
      return receipt;
    },
  };
  const gateway: AccountLifecycleGatewayPort = {
    preflight: async () => {},
    submit: async () => {
      submits++;
      throw Error("lost ACK");
    },
    read: (command) => readback(command),
  };
  const deps = { store, gateway, authorize: async () => {} };
  return {
    deps,
    setRead: (read: typeof readback) => {
      readback = read;
    },
    counters: () => ({ submits, releases, finalized, rejects }),
  };
}
test("double submit and lost ACK read original operation without replay", async () => {
  const f = fixture();
  await Promise.all([
    submitAccountLifecycle("user", "operation", f.deps),
    submitAccountLifecycle("user", "operation", f.deps),
  ]);
  await readAccountLifecycle("user", "operation", f.deps);
  assert.equal(f.counters().submits, 1);
});
test("readback checks full original request tuple before releasing denial", async () => {
  const f = fixture();
  f.setRead(async (command) => ({
    command: { ...command, expectedMetadataRevision: 99 },
    state: "rejected_no_effect",
    account: {
      accountRef: "account",
      profileId: "profile",
      displayName: "Connection",
      state: "active",
      metadataRevision: 3,
      authorizationEpoch: 4,
    },
    retirementOperationId: null,
    closure: null,
    noEffectProofRef: "proof",
  }));
  assert.equal(
    (await submitAccountLifecycle("user", "operation", f.deps)).phase,
    "unknown",
  );
  assert.equal(f.counters().rejects, 0);
});
test("positive no-effect proof recovers without a second ingress", async () => {
  const f = fixture();
  f.setRead(async (command) => ({
    command,
    state: "rejected_no_effect",
    account: {
      accountRef: "account",
      profileId: "profile",
      displayName: "Connection",
      state: "active",
      metadataRevision: 3,
      authorizationEpoch: 4,
    },
    retirementOperationId: null,
    closure: null,
    noEffectProofRef: "proof",
  }));
  assert.equal(
    (await submitAccountLifecycle("user", "operation", f.deps)).phase,
    "rejected",
  );
  assert.equal(f.counters().submits, 1);
});
test("delete applied retirement is incomplete until independent closure proofs", async () => {
  const f = fixture("delete");
  f.setRead(async (command) => ({
    command,
    state: "applied",
    account: {
      accountRef: "account",
      profileId: "profile",
      displayName: "Connection",
      state: "disabled",
      metadataRevision: 4,
      authorizationEpoch: 5,
    },
    retirementOperationId: "retirement",
    closure: null,
    noEffectProofRef: null,
  }));
  const pending = await submitAccountLifecycle("user", "operation", f.deps);
  assert.equal(pending.phase, "unknown");
  assert.equal(pending.closureComplete, false);
  assert.equal(pending.source.pendingSourceOperationId, "operation");
});
test("authority loss after claim releases only unentered ingress", async () => {
  const f = fixture();
  let calls = 0;
  f.deps.authorize = async () => {
    if (++calls === 3) throw Error("role lost");
  };
  await assert.rejects(submitAccountLifecycle("user", "operation", f.deps));
  assert.deepEqual(f.counters(), {
    submits: 0,
    releases: 1,
    finalized: 0,
    rejects: 0,
  });
});
test("begin establishes local durable deny before any Gateway I/O", async () => {
  const f = fixture("delete");
  assert.equal(
    (await beginAccountLifecycle({ ...intent, action: "delete" }, f.deps))
      .source.pendingSourceOperationId,
    "operation",
  );
  assert.equal(f.counters().submits, 0);
});

test("readback snapshots remote facts before awaited live authorization", async () => {
  const f = fixture();
  const account = {
    accountRef: "account",
    profileId: "profile",
    displayName: "Connection",
    state: "active",
    metadataRevision: 3,
    authorizationEpoch: 4,
  };
  f.setRead(async (command) => ({
    command,
    state: "rejected_no_effect",
    account,
    retirementOperationId: null,
    closure: null,
    noEffectProofRef: "proof",
  }));
  let authorizations = 0;
  f.deps.authorize = async () => {
    if (++authorizations === 5) account.metadataRevision = 999;
  };
  assert.equal(
    (await submitAccountLifecycle("user", "operation", f.deps)).phase,
    "rejected",
  );
  assert.equal(f.counters().rejects, 1);
});

test("Gateway ingress requires consumption of the exact unentered capability", async () => {
  const f = fixture();
  let entered = false;
  f.deps.store.enterClaim = async () => {
    entered = true;
    return true;
  };
  await submitAccountLifecycle("user", "operation", f.deps);
  assert.equal(entered, true);
  const blocked = fixture();
  blocked.deps.store.enterClaim = async () => false;
  await assert.rejects(
    submitAccountLifecycle("user", "operation", blocked.deps),
  );
  assert.equal(blocked.counters().submits, 0);
  assert.equal(blocked.counters().releases, 1);
});
