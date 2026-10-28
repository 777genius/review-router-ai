import { expect, it } from "vitest";
import { createAccountLimits } from "./composition";

it("real limits assembly borrows its reader without I/O and preserves the authorization gate", async () => {
  let reads = 0;
  const reader = {
    read: async () => {
      reads++;
      return {
        status: "unknown" as const,
        reason: "missing_snapshot" as const,
      };
    },
  };
  const limits = await createAccountLimits({ reader });
  expect(limits.reader).toBe(reader);
  expect(reads).toBe(0);
  expect(
    await limits.read({
      authorize: async () => null,
      now: () => new Date("2026-10-22T12:00:00Z"),
    }),
  ).toMatchObject({ status: "restricted" });
  expect(reads).toBe(0);
  expect(
    await limits.read({
      authorize: async () => ({
        target: {
          ownerRef: "owner",
          accountRef: "account",
          profileId: "codex",
          expectedAuthorizationEpoch: 1,
        },
        displayToken: "opaque",
      }),
      now: () => new Date("2026-10-22T12:00:00Z"),
    }),
  ).toMatchObject({
    status: "unknown",
    reason: "missing_snapshot",
    displayToken: "opaque",
  });
  expect(reads).toBe(1);
});

it.each([undefined, {}, { read: true }])(
  "rejects a missing or incompatible reader before assembly can perform I/O",
  async (reader) => {
    await expect(createAccountLimits({ reader } as never)).rejects.toThrow(
      "account_limits_binding_invalid",
    );
  },
);
