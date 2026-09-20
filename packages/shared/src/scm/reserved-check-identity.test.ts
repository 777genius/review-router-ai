import { describe, expect, it } from "vitest";
import {
  assertUnreservedCheckIdentity,
  isSdkGrowthReservedCheckIdentity,
  SDK_GROWTH_RESERVED_CHECK_NAME,
} from "./reserved-check-identity";

describe("SDK growth check reservation", () => {
  it("reserves the check name and status context across trim and case", () => {
    expect(
      isSdkGrowthReservedCheckIdentity(SDK_GROWTH_RESERVED_CHECK_NAME),
    ).toBe(true);
    expect(
      isSdkGrowthReservedCheckIdentity(" reviewrouter / sdk growth authority "),
    ).toBe(true);
    expect(() =>
      assertUnreservedCheckIdentity(SDK_GROWTH_RESERVED_CHECK_NAME),
    ).toThrow("sdk_growth_check_identity_reserved");
  });

  it("leaves ordinary check names and status contexts unaffected", () => {
    expect(isSdkGrowthReservedCheckIdentity("ReviewRouter")).toBe(false);
    expect(() =>
      assertUnreservedCheckIdentity("ReviewRouter conflict review"),
    ).not.toThrow();
  });
});
