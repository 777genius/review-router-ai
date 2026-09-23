import { SDK_GROWTH_CHECK_NAME } from "../domain/sdk-growth-check-identity.js";

export { SDK_GROWTH_CHECK_NAME } from "../domain/sdk-growth-check-identity.js";

/**
 * GitHub status contexts and check names share this reservation. Comparison is
 * deliberately trim- and ASCII-case-insensitive so generic writers cannot
 * bypass ownership using provider normalization.
 */
export function isSdkGrowthReservedCheckIdentity(value: string): boolean {
  return value.trim().toLowerCase() === SDK_GROWTH_CHECK_NAME.toLowerCase();
}

export function assertUnreservedCheckIdentity(
  value: string,
  errorCode = "sdk_growth_check_identity_reserved",
): void {
  if (isSdkGrowthReservedCheckIdentity(value)) {
    throw new Error(errorCode);
  }
}
