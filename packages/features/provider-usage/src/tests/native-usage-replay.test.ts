import { expect, it } from "vitest";
import { matchesNativeUsageProjectionReplay } from "../domain/native-usage-replay";
import { validateUsageFact } from "../domain/usage";
import { fact } from "./fixture";

it("keeps written usage versions immutable and compares the entire common projection", () => {
  const legacy = fact({ cost: null });
  const native = fact({
    nativeEvidenceVersion: 2,
    nativeContext: {
      schemaVersion: 1,
      providerId: "new-provider",
      productId: "mixed",
      profileId: "new-profile",
      modelId: "gpt-test",
      billing: { status: "known", kind: "payg" },
    },
  });
  expect(() => validateUsageFact(native)).not.toThrow();
  expect(matchesNativeUsageProjectionReplay(legacy, native)).toBe(true);
  expect(matchesNativeUsageProjectionReplay(native, legacy)).toBe(true);
  expect(legacy.nativeContext).toBeUndefined();
  expect(native.nativeContext?.billing).toEqual({
    status: "known",
    kind: "payg",
  });
  expect(
    matchesNativeUsageProjectionReplay(native, {
      ...native,
      nativeContext: {
        ...native.nativeContext!,
        billing: { status: "known", kind: "subscription" },
      },
    }),
  ).toBe(false);
  expect(
    matchesNativeUsageProjectionReplay(legacy, {
      ...native,
      tokens: { ...native.tokens, outputTotal: 31, total: 131 },
    }),
  ).toBe(false);
  expect(matchesNativeUsageProjectionReplay(undefined, native)).toBe(false);
  // An old source-reported cost is not evidence that an old record was wire v2.
  expect(matchesNativeUsageProjectionReplay(fact(), native)).toBe(false);
});
