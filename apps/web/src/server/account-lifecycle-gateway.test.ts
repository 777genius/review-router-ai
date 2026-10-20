import { describe, expect, it, vi } from "vitest";
import type {
  LifecycleClient,
  ManagementClient,
} from "@agent-teams/account-gateway/http";
import { createAccountLifecycleGateway } from "./account-lifecycle-gateway";
const command = {
  operationId: "operation",
  accountRef: "account",
  profileId: "profile",
  expectedMetadataRevision: 2,
  action: "resume" as const,
};
const account = {
  accountRef: "account",
  ownerRef: "owner",
  profileId: "profile",
  displayName: "Account",
  state: "suspended",
  metadataRevision: 2,
  authorizationEpoch: 3,
  authKind: "api_key",
  resumeCustody: "attention_required",
};
function setup(operation: unknown) {
  const submit = vi.fn();
  const gateway = createAccountLifecycleGateway({
    lifecycle: {
      operation: async () => operation,
      suspend: submit,
      resume: submit,
    } as unknown as LifecycleClient,
    legacy: {} as ManagementClient,
    ownerRef: "owner",
    authorize: async () => {},
    bindingClosure: async () => null,
  });
  return { gateway, submit };
}
describe("lifecycle Gateway exact readback", () => {
  it("requires the original action tuple even if a nonce returns the expected account", async () => {
    const { gateway } = setup({
      operationRef: "operation",
      intent: {
        action: "suspend",
        accountRef: "account",
        profileId: "profile",
        expectedMetadataRevision: 2,
      },
      state: "rejected",
      account,
      error: {
        code: "conflict",
        traceRef: "trace",
        effect: "not_dispatched",
        retry: { kind: "never" },
      },
    });
    await expect(gateway.read(command)).rejects.toThrow();
  });
  it("accepts exact positive no-effect evidence and never re-enters the operation", async () => {
    const { gateway, submit } = setup({
      operationRef: "operation",
      intent: {
        action: "resume",
        accountRef: "account",
        profileId: "profile",
        expectedMetadataRevision: 2,
      },
      state: "rejected",
      account,
      error: {
        code: "conflict",
        traceRef: "trace",
        effect: "not_dispatched",
        retry: { kind: "never" },
      },
    });
    const result = await gateway.read(command);
    expect(result.state).toBe("rejected_no_effect");
    expect(result.noEffectProofRef).toMatch(/^rr_/);
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("delete closure evidence", () => {
  const retirement = {
    operationRef: "operation",
    account: {
      accountRef: "account",
      ownerRef: "owner",
      profileId: "profile",
      displayName: "Account",
      state: "disabled",
      metadataRevision: 3,
      authorizationEpoch: 4,
    },
    state: "completed",
    inert: true,
    fence: { metadataRevision: 3, authorizationEpoch: 4 },
    counts: {
      retainedGenerations: 2,
      settledNativeErasureGenerations: 2,
      retainedExecutions: 1,
      openExecutions: 0,
      requests: 1,
      occupiedTransports: 0,
      acknowledgedNativeTransports: 1,
      positiveKernelNonEntryRequests: 0,
      unknownEffects: 0,
    },
  };
  function deletion(binding: string | null, value = retirement) {
    return createAccountLifecycleGateway({
      lifecycle: {} as LifecycleClient,
      legacy: { retirement: async () => value } as unknown as ManagementClient,
      ownerRef: "owner",
      authorize: async () => {},
      bindingClosure: async () => binding,
    });
  }
  it("does not turn completed retirement into deletion while independent binding closure is absent", async () => {
    const result = await deletion(null).read({ ...command, action: "delete" });
    expect(result.state).toBe("applied");
    expect(result.closure).toBeNull();
  });
  it("binds separate native and transport facts plus independently checked binding proof", async () => {
    const result = await deletion("binding-proof").read({
      ...command,
      action: "delete",
    });
    expect(result.closure?.bindingErasureProofRef).toBe("binding-proof");
    expect(result.closure?.nativeErasureProofRef).not.toEqual(
      result.closure?.transportErasureProofRef,
    );
    expect(result.closure?.retirementOperationId).toBe("operation");
  });
  it("refuses contradictory native erasure counts even when retirement claims completed", async () => {
    await expect(
      deletion("binding-proof", {
        ...retirement,
        counts: { ...retirement.counts, settledNativeErasureGenerations: 1 },
      }).read({ ...command, action: "delete" }),
    ).rejects.toThrow();
  });
});
