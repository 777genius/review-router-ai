import { describe, expect, it } from "vitest";
import {
  assertContextGatewaySessionConfiguration,
  type ContextGatewaySessionConfiguration,
} from "../domain/gateway-session-configuration.js";

const valid: ContextGatewaySessionConfiguration = {
  sessionLifetimeMs: 1_000,
  reuseTtlMs: 30_000,
  replayProofLifetimeMs: 10_000,
  replayCapabilityLifetimeMs: 8_000,
  attachmentCapabilityLifetimeMs: 6_000,
};

describe("gateway session configuration admission", () => {
  it("accepts a 32-byte key and safe positive TTLs", () => {
    expect(() =>
      assertContextGatewaySessionConfiguration(valid, 32),
    ).not.toThrow();
  });

  it.each([0, 1, 31, 33, 64, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid session key byte length %s",
    (byteLength) => {
      expect(() =>
        assertContextGatewaySessionConfiguration(valid, byteLength),
      ).toThrow("review_context_attestation_config_invalid");
    },
  );

  it.each([
    "sessionLifetimeMs",
    "reuseTtlMs",
    "replayProofLifetimeMs",
    "replayCapabilityLifetimeMs",
    "attachmentCapabilityLifetimeMs",
  ] as const)("rejects invalid %s without side effects", (field) => {
    for (const value of [
      0,
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        assertContextGatewaySessionConfiguration(
          { ...valid, [field]: value },
          32,
        ),
      ).toThrow("review_context_attestation_config_invalid");
    }
  });
});
