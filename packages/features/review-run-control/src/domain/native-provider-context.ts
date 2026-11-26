/** Captured admission identity, never a claim about an executed request's price. */
export type ReviewRunNativeProviderContext = Readonly<{
  schemaVersion: 1;
  profileId: string;
  providerId: string;
  productId: string;
}>;

/** Unknown versions cannot be interpreted using a current provider catalog. */
export function parseReviewRunNativeProviderContext(
  value: unknown,
  expectedProfileId: string,
): ReviewRunNativeProviderContext {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("review_run_native_context_invalid");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 4 ||
    row.schemaVersion !== 1 ||
    row.profileId !== expectedProfileId ||
    ![row.profileId, row.providerId, row.productId].every(
      (id) =>
        typeof id === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id),
    )
  )
    throw new Error("review_run_native_context_invalid");
  return Object.freeze({
    schemaVersion: 1,
    profileId: String(row.profileId),
    providerId: String(row.providerId),
    productId: String(row.productId),
  });
}
