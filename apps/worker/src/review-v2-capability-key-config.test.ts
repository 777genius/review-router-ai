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
          {
            ...shortKey,
            secretBase64: Buffer.alloc(32, 7).toString("base64"),
            unexpected: true,
          },
        ]),
      }),
    ).toThrow("review_v2_capability_key_invalid");
  });

  it("preserves configured key bytes and the exact retirement deadline", async () => {
    const activeSecret = Buffer.alloc(32, 7);
    const retiredSecret = Buffer.alloc(32, 8);
    const retirement = "2026-11-25T12:00:00.000Z";
    const ring = readCapabilityKeyRing({
      [reviewV2CapabilityActiveKeyIdEnv]: " key-2 ",
      [reviewV2CapabilityKeysEnv]: JSON.stringify([
        {
          keyId: "key-1",
          secretBase64: retiredSecret.toString("base64"),
          verifyUntil: retirement,
        },
        {
          keyId: "key-2",
          secretBase64: activeSecret.toString("base64"),
          verifyUntil: null,
        },
      ]),
    });

    await expect(ring.activeSigningKey()).resolves.toEqual({
      keyId: "key-2",
      secret: new Uint8Array(activeSecret),
    });
    await expect(
      ring.verificationKey("key-1", new Date(retirement)),
    ).resolves.toEqual({
      keyId: "key-1",
      secret: new Uint8Array(retiredSecret),
    });
    await expect(
      ring.verificationKey("key-1", new Date("2026-11-25T12:00:00.001Z")),
    ).resolves.toBeNull();
  });

  it("rejects noncanonical key encodings and timestamps", () => {
    const key = {
      keyId: "key-1",
      secretBase64: Buffer.alloc(32, 7).toString("base64"),
      verifyUntil: null,
    };
    for (const invalid of [
      { ...key, secretBase64: `${key.secretBase64}\n` },
      { ...key, secretBase64: key.secretBase64.replace(/=$/u, "") },
      { ...key, verifyUntil: "2026-11-25T12:00:00Z" },
      { ...key, verifyUntil: "invalid" },
      { ...key, verifyUntil: undefined },
    ]) {
      expect(() =>
        readCapabilityKeyRing({
          [reviewV2CapabilityActiveKeyIdEnv]: "key-1",
          [reviewV2CapabilityKeysEnv]: JSON.stringify([invalid]),
        }),
      ).toThrow("review_v2_capability_key_invalid");
    }
  });
});
