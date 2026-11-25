import { describe, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  mutate: vi.fn(),
  personalMutate: vi.fn(),
  read: vi.fn(async () => ({
    status: "ok",
    value: { nonce: "original", state: "unknown", cleanup: "unresolved" },
  })),
  personalRead: vi.fn(async () => ({
    status: "ok",
    value: { nonce: "original", state: "unknown", cleanup: "unresolved" },
  })),
}));
vi.mock("../../src/server/account-gateway-accounts", () => ({
  accountsServerAdapter: async () => ({ mutate: f.mutate, operation: f.read }),
  snapshotOAuthCompletion: (value: unknown) => value,
}));
vi.mock("../../src/server/personal-account-composition", () => ({
  productionPersonalAccounts: async () => ({
    scope: "authenticated-scope",
    canonical: {
      mutateGatewayAccount: f.personalMutate,
      readGatewayOperation: f.personalRead,
    },
  }),
}));
import {
  mutateGatewayAccount,
  readGatewayOperation,
} from "./account-gateway-account-actions";
import {
  mutatePersonalGatewayAccount,
  readPersonalGatewayOperation,
} from "./personal-account-actions";
const intent = {
  kind: "disable" as const,
  nonce: "c19a6238-6aa2-4f70-93d8-83bdc4298fbc",
  connectionId: "source",
  mirrorRevision: 1,
  gatewayRevision: 2,
};
describe("legacy retirement admission", () => {
  it("refuses a new direct legacy disable even with an authenticated personal context", async () => {
    expect(
      await mutatePersonalGatewayAccount("authenticated-scope", intent),
    ).toEqual({ status: "denied" });
    expect(f.personalMutate).not.toHaveBeenCalled();
  });
  it("refuses a new direct legacy disable through the organization server action", async () => {
    expect(
      await mutateGatewayAccount("authenticated-workspace-context", intent),
    ).toEqual({ status: "denied" });
    expect(f.mutate).not.toHaveBeenCalled();
  });
  it("preserves original uncertain operation readback on both legacy APIs", async () => {
    await readGatewayOperation("authenticated-workspace-context", "original");
    await readPersonalGatewayOperation("authenticated-scope", "original");
    expect(f.read).toHaveBeenCalledWith(
      "authenticated-workspace-context",
      "original",
    );
    expect(f.personalRead).toHaveBeenCalledWith(
      "authenticated-scope",
      "original",
    );
  });
});
