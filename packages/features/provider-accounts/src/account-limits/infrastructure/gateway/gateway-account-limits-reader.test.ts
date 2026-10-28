import { describe, expect, it } from "vitest";
import type { AccountLimitsTarget } from "../../application/ports/account-limits-reader";
import {
  createGatewayAccountLimitsReader,
  type GatewayAccountLimitsClient,
} from "./gateway-account-limits-reader";

const target: AccountLimitsTarget = {
  ownerRef: "owner",
  accountRef: "account",
  profileId: "codex",
  expectedAuthorizationEpoch: 3,
};
describe("Gateway cached account limits capability", () => {
  it("uses only the explicitly selected v2 contract without probing the legacy source", async () => {
    const calls: string[] = [];
    const reader = createGatewayAccountLimitsReader(
      {
        async getAccountLimitsCapabilities() {
          calls.push("v2-capability");
          return {
            contract: "account-limits/v2",
            cachedRead: true,
            quotaOnlyRefresh: false,
          };
        },
        async readAccountLimits(input) {
          calls.push(input.profileId);
          return { status: "unknown" };
        },
      },
      "account-limits/v2",
    );
    expect(
      await reader.read({
        ...target,
        profileId: "grok-subscription-responses-oauth-v1",
      }),
    ).toEqual({ status: "unknown" });
    expect(calls).toEqual([
      "v2-capability",
      "grok-subscription-responses-oauth-v1",
    ]);
  });

  it("does not retry v1 when declared v2 support is absent", async () => {
    let reads = 0;
    const reader = createGatewayAccountLimitsReader(
      {
        async getAccountLimitsCapabilities() {
          return {
            contract: "account-limits/v1",
            cachedRead: true,
            quotaOnlyRefresh: false,
          };
        },
        async readAccountLimits() {
          reads++;
          return { status: "unknown" };
        },
      },
      "account-limits/v2",
    );
    expect(await reader.read(target)).toMatchObject({ status: "unavailable" });
    expect(reads).toBe(0);
  });
  it.each(["forbidden", "not_found", "conflict", "unauthenticated"])(
    "clears old observations on a safe %s identity refusal",
    async (code) => {
      const reader = createGatewayAccountLimitsReader({
        getAccountLimitsCapabilities: async () => ({
          contract: "account-limits/v1",
          cachedRead: true,
          quotaOnlyRefresh: false,
        }),
        async readAccountLimits() {
          throw Object.assign(new Error("safe_error"), {
            diagnostic: { code, traceRef: "private-ref" },
          });
        },
      });
      expect(await reader.read(target)).toEqual({
        status: "unknown",
        reason: "generation_changed",
      });
    },
  );
  it("handshakes once and calls only the canonical cached reader with the complete server target", async () => {
    const calls: string[] = [];
    const received: AccountLimitsTarget[] = [];
    const client = new Proxy(
      {
        async getAccountLimitsCapabilities() {
          calls.push("capability");
          return {
            contract: "account-limits/v1",
            cachedRead: true,
            quotaOnlyRefresh: true,
          };
        },
        async readAccountLimits(input: AccountLimitsTarget) {
          calls.push("cached-read");
          received.push(input);
          return {
            status: "unknown" as const,
            reason: "missing_snapshot" as const,
          };
        },
      },
      {
        get(object, key, receiver) {
          if (!(key in object)) throw new Error("unsafe_client_method");
          return Reflect.get(object, key, receiver);
        },
      },
    );
    const reader = createGatewayAccountLimitsReader(client);
    expect(calls).toEqual([]);
    const values = await Promise.all([
      reader.read(target),
      reader.read(target),
    ]);
    expect(calls).toEqual(["capability", "cached-read", "cached-read"]);
    expect(received).toEqual([target, target]);
    expect(values).toEqual([
      { status: "unknown", reason: "missing_snapshot" },
      { status: "unknown", reason: "missing_snapshot" },
    ]);
  });
  it.each([
    { contract: "account-limits/v2", cachedRead: true, quotaOnlyRefresh: true },
    {
      contract: "account-limits/v1",
      cachedRead: false,
      quotaOnlyRefresh: true,
    },
    {
      contract: "account-limits/v1",
      cachedRead: "true",
      quotaOnlyRefresh: false,
    },
  ])(
    "refuses incompatible capability before reading accounts: %j",
    async (capability) => {
      let reads = 0;
      const client = {
        getAccountLimitsCapabilities: async () => capability,
        readAccountLimits: async () => {
          reads++;
          return { status: "unknown" as const };
        },
      } as GatewayAccountLimitsClient;
      expect(
        await createGatewayAccountLimitsReader(client).read(target),
      ).toEqual({ status: "unavailable", reason: "source_unavailable" });
      expect(reads).toBe(0);
    },
  );
  it.each(["capability", "read"])(
    "never leaks upstream errors or retries a failed %s",
    async (phase) => {
      const calls: string[] = [];
      const reader = createGatewayAccountLimitsReader({
        async getAccountLimitsCapabilities() {
          calls.push("capability");
          if (phase === "capability") throw new Error("SECRET-provider-error");
          return {
            contract: "account-limits/v1",
            cachedRead: true,
            quotaOnlyRefresh: false,
          };
        },
        async readAccountLimits() {
          calls.push("read");
          throw new Error("SECRET-provider-error");
        },
      });
      expect(await reader.read(target)).toEqual({
        status: "unavailable",
        reason: "source_unavailable",
      });
      expect(calls).toEqual(
        phase === "capability" ? ["capability"] : ["capability", "read"],
      );
    },
  );
});
