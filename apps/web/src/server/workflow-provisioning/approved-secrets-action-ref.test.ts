import { expect, it, vi } from "vitest";
import { resolveApprovedSecretsRuntimeActionRef } from "./approved-secrets-action-ref";
it("selects only registered immutable producers shipping the Secrets profile", async () => {
  const ref = `777genius/review-router@${"a".repeat(40)}`;
  const isRegistered = vi.fn(async () => true),
    hasSecretsRuntime = vi.fn(async () => true);
  expect(
    await resolveApprovedSecretsRuntimeActionRef(ref, {
      isRegistered,
      hasSecretsRuntime,
    }),
  ).toBe(ref);
  expect(
    await resolveApprovedSecretsRuntimeActionRef("777genius/review-router@v1", {
      isRegistered,
      hasSecretsRuntime,
    }),
  ).toBeUndefined();
  expect(isRegistered).toHaveBeenCalledTimes(1);
  expect(
    await resolveApprovedSecretsRuntimeActionRef(ref, {
      isRegistered: async () => false,
      hasSecretsRuntime,
    }),
  ).toBeUndefined();
  expect(hasSecretsRuntime).toHaveBeenCalledTimes(1);
  expect(
    await resolveApprovedSecretsRuntimeActionRef(ref, {
      isRegistered,
      hasSecretsRuntime: async () => false,
    }),
  ).toBeUndefined();
});

it("preserves legacy setup when producer qualification is unavailable", async () => {
  expect(
    await resolveApprovedSecretsRuntimeActionRef(
      `777genius/review-router@${"a".repeat(40)}`,
      {
        isRegistered: async () => {
          throw new Error("unavailable");
        },
        hasSecretsRuntime: async () => true,
      },
    ),
  ).toBeUndefined();
});
