import {
  ProviderAccountError,
  assertOpaqueReference,
} from "./provider-account";

/** Safe immutable selection only. Native owns the sensitive input commitment. */
export type NativeConnectionIntent = Readonly<{
  schemaVersion: 1;
  profileId: string;
  methodId: string;
  methodRevision: number;
  configurationGeneration: string;
}>;

export function snapshotNativeConnectionIntent(
  value: unknown,
): NativeConnectionIntent {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ProviderAccountError("invalid_input");
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).length !== 5 ||
    row.schemaVersion !== 1 ||
    typeof row.profileId !== "string" ||
    typeof row.methodId !== "string" ||
    typeof row.configurationGeneration !== "string" ||
    typeof row.methodRevision !== "number" ||
    !Number.isSafeInteger(row.methodRevision) ||
    row.methodRevision < 1
  )
    throw new ProviderAccountError("invalid_input");
  for (const id of [row.profileId, row.methodId, row.configurationGeneration])
    assertOpaqueReference(id);
  return Object.freeze({
    schemaVersion: 1,
    profileId: row.profileId,
    methodId: row.methodId,
    methodRevision: row.methodRevision,
    configurationGeneration: row.configurationGeneration,
  });
}
