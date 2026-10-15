import { createHash } from "node:crypto";
import {
  ProviderAccountError,
  assertExpectedRevision,
  assertMetadata,
  assertOpaqueReference,
} from "./provider-account";

/** Safe immutable intent only. Credential bytes and fingerprints never belong here. */
export type PersonalCanonicalIntent = {
  readonly actorUserId: string;
  readonly clientOperationId: string;
  readonly personalWorkspaceId: string;
  readonly sourceId: string;
  readonly expectedSourceMetadataRevision: number;
  readonly expectedGatewayRevision: number;
  readonly expectedAuthorizationEpoch: number;
} & (
  | { readonly action: "rename"; readonly displayName: string }
  | { readonly action: "reconnect" | "retire" }
);
export function snapshotCanonicalIntent(
  input: PersonalCanonicalIntent,
): PersonalCanonicalIntent {
  const value = {
    actorUserId: input.actorUserId,
    clientOperationId: input.clientOperationId,
    personalWorkspaceId: input.personalWorkspaceId,
    sourceId: input.sourceId,
    expectedSourceMetadataRevision: input.expectedSourceMetadataRevision,
    expectedGatewayRevision: input.expectedGatewayRevision,
    expectedAuthorizationEpoch: input.expectedAuthorizationEpoch,
  };
  for (const ref of [
    value.actorUserId,
    value.clientOperationId,
    value.personalWorkspaceId,
    value.sourceId,
  ])
    assertOpaqueReference(ref);
  assertExpectedRevision(value.expectedSourceMetadataRevision);
  for (const counter of [
    value.expectedGatewayRevision,
    value.expectedAuthorizationEpoch,
  ]) {
    if (!Number.isSafeInteger(counter) || counter < 1)
      throw new ProviderAccountError("invalid_input");
  }
  if (input.action === "rename") {
    const displayName = input.displayName.trim();
    assertMetadata({
      displayName,
      profileRef: null,
      gatewayOperationRef: null,
      state: "active",
    });
    if (Buffer.byteLength(displayName, "utf8") > 400)
      throw new ProviderAccountError("invalid_input");
    return Object.freeze({ ...value, action: "rename", displayName });
  }
  if (input.action !== "reconnect" && input.action !== "retire")
    throw new ProviderAccountError("invalid_input");
  return Object.freeze({ ...value, action: input.action });
}
export function canonicalIntentHash(input: PersonalCanonicalIntent): string {
  return createHash("sha256")
    .update(JSON.stringify(snapshotCanonicalIntent(input)))
    .digest("hex");
}
export function canonicalFenceOperationId(
  operationId: string,
  bindingId: string,
): string {
  return `rrpf_${createHash("sha256")
    .update(
      JSON.stringify(["rr-personal-source-fence-v1", operationId, bindingId]),
    )
    .digest("hex")}`;
}
