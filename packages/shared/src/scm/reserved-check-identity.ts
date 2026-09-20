export const SDK_GROWTH_RESERVED_CHECK_NAME =
  "ReviewRouter / SDK growth authority" as const;

/**
 * GitHub status contexts and check names share this reservation. Comparison is
 * deliberately trim- and ASCII-case-insensitive so generic writers cannot
 * bypass ownership using provider normalization.
 */
export function isSdkGrowthReservedCheckIdentity(value: string): boolean {
  return (
    value.trim().toLowerCase() === SDK_GROWTH_RESERVED_CHECK_NAME.toLowerCase()
  );
}

export function assertUnreservedCheckIdentity(
  value: string,
  errorCode = "sdk_growth_check_identity_reserved",
): void {
  if (isSdkGrowthReservedCheckIdentity(value)) {
    throw new Error(errorCode);
  }
}
