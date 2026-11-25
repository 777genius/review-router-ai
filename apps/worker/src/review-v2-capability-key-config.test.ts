import { describe, expect, it } from "vitest";
import {
  positiveInteger,
  readCapabilityKeyRing,
  reviewV2CapabilityActiveKeyIdEnv,
  reviewV2CapabilityKeysEnv,
} from "./review-v2-capability-key-config";

describe("review v2 capability key configuration", () => {
  it("preserves explicit integer limits and accepted defaults", () => {
    expect(positiveInteger(undefined, 7, "invalid_limit")).toBe(7);
    expect(positiveInteger(" ", 7, "invalid_limit")).toBe(7);
    expect(positiveInteger("12", 7, "invalid_limit")).toBe(12);
    for (const value of ["0", "-1", "1.5", "NaN", "9007199254740992"]) {
      expect(() => positiveInteger(value, 7, "invalid_limit")).toThrow(
        "invalid_limit",
      );
    }
  });

  it("fails closed when no active key identifier is configured", () => {
    expect(() => readCapabilityKeyRing({})).toThrow(
      `review_v2_worker_config_missing:${reviewV2CapabilityActiveKeyIdEnv}`,
    );
  });

  it("rejects malformed JSON and empty key arrays", () => {
    const base = { [reviewV2CapabilityActiveKeyIdEnv]: "key-1" };
    expect(() =>
      readCapabilityKeyRing({ ...base, [reviewV2CapabilityKeysEnv]: "{" }),
    ).toThrow("review_v2_capability_keys_invalid");
    expect(() =>
      readCapabilityKeyRing({ ...base, [reviewV2CapabilityKeysEnv]: "[]" }),
    ).toThrow("review_v2_capability_keys_invalid");
  });

  it("rejects too-short key material and unknown key fields", () => {
    const shortKey = {
      keyId: "key-1",
      secretBase64: Buffer.from("too-short").toString("base64"),
      verifyUntil: null,
    };
    const base = { [reviewV2CapabilityActiveKeyIdEnv]: "key-1" };
    expect(() =>
      readCapabilityKeyRing({
        ...base,
        [reviewV2CapabilityKeysEnv]: JSON.stringify([shortKey]),
      }),
    ).toThrow("review_v2_capability_key_invalid");
    expect(() =>
      readCapabilityKeyRing({
        ...base,
        [reviewV2CapabilityKeysEnv]: JSON.stringify([
          { ...shortKey, unexpected: true },
        ]),
      }),
    ).toThrow("review_v2_capability_key_invalid");
  });
});
