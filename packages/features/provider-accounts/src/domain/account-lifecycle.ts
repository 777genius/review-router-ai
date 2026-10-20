import { createHash } from "node:crypto";
import {
  assertExpectedRevision,
  assertOpaqueReference,
  ProviderAccountError,
} from "./provider-account";

/** Safe immutable request. Scope is re-authorized from storage, never trusted. */
export type AccountLifecycleIntent = {
  readonly actorUserId: string;
  readonly clientOperationId: string;
  readonly sourceId: string;
  readonly expectedSourceMetadataRevision: number;
  readonly expectedGatewayRevision: number;
  readonly expectedAuthorizationEpoch: number;
  readonly action: "suspend" | "resume" | "delete";
} & (
  | { readonly personalWorkspaceId: string; readonly owningWorkspaceId: null }
  | { readonly personalWorkspaceId: null; readonly owningWorkspaceId: string }
);
export function snapshotAccountLifecycleIntent(
  input: AccountLifecycleIntent,
): AccountLifecycleIntent {
  const intent = {
    actorUserId: input.actorUserId,
    clientOperationId: input.clientOperationId,
    sourceId: input.sourceId,
    personalWorkspaceId: input.personalWorkspaceId,
    owningWorkspaceId: input.owningWorkspaceId,
    expectedSourceMetadataRevision: input.expectedSourceMetadataRevision,
    expectedGatewayRevision: input.expectedGatewayRevision,
    expectedAuthorizationEpoch: input.expectedAuthorizationEpoch,
    action: input.action,
  };
  if (
    (intent.personalWorkspaceId === null) ===
      (intent.owningWorkspaceId === null) ||
    !["suspend", "resume", "delete"].includes(intent.action)
  )
    throw new ProviderAccountError("invalid_input");
  for (const ref of [
    intent.actorUserId,
    intent.clientOperationId,
    intent.sourceId,
    intent.personalWorkspaceId ?? intent.owningWorkspaceId!,
  ])
    assertOpaqueReference(ref);
  assertExpectedRevision(intent.expectedSourceMetadataRevision);
  for (const counter of [
    intent.expectedGatewayRevision,
    intent.expectedAuthorizationEpoch,
  ])
    if (!Number.isSafeInteger(counter) || counter < 1)
      throw new ProviderAccountError("invalid_input");
  return Object.freeze(intent) as AccountLifecycleIntent;
}
export function accountLifecycleIntentHash(
  intent: AccountLifecycleIntent,
): string {
  return createHash("sha256")
    .update(JSON.stringify(snapshotAccountLifecycleIntent(intent)))
    .digest("hex");
}
