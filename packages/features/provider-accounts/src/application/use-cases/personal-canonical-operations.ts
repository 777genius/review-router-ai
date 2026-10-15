import { ProviderAccountError } from "../../domain/provider-account";
import {
  canonicalIntentHash,
  snapshotCanonicalIntent,
  type PersonalCanonicalIntent,
} from "../../domain/personal-canonical-operation";
import type { PersonalCanonicalOperationStore } from "../ports/personal-canonical-operation-port";
import type { PersonalAccountGatewayPort } from "../ports/provider-account-synchronization-port";

export type PersonalCanonicalDependencies = {
  readonly store: PersonalCanonicalOperationStore;
  readonly gateway: PersonalAccountGatewayPort;
  /** Current stable session authority, including after awaited readiness/claim. */
  readonly authorizeOwner: (actorUserId: string) => Promise<void>;
};
export async function beginPersonalCanonicalOperation(
  request: PersonalCanonicalIntent,
  deps: PersonalCanonicalDependencies,
) {
  const intent = snapshotCanonicalIntent(request);
  await deps.authorizeOwner(intent.actorUserId);
  try {
    const original = await deps.store.read(
      intent.actorUserId,
      intent.clientOperationId,
    );
    if (canonicalIntentHash(original.intent) !== canonicalIntentHash(intent))
      throw new ProviderAccountError("operation_conflict");
    await deps.authorizeOwner(intent.actorUserId);
    return original;
  } catch (error) {
    if (!(error instanceof ProviderAccountError) || error.code !== "not_found")
      throw error;
  }
  // Capture mirror CAS before GET. A delayed GET cannot overwrite later metadata.
  const source = await deps.store.findOwnedSource(
    intent.actorUserId,
    intent.sourceId,
  );
  if (!source.profileRef)
    throw new ProviderAccountError("connection_unavailable");
  const account = await deps.gateway.get(
    intent.actorUserId,
    source.gatewayAccountRef,
    source.profileRef,
  );
  if (
    account.accountRef !== source.gatewayAccountRef ||
    account.profileId !== source.profileRef ||
    account.metadataRevision !== intent.expectedGatewayRevision ||
    account.authorizationEpoch !== intent.expectedAuthorizationEpoch ||
    source.metadataRevision !== intent.expectedSourceMetadataRevision ||
    source.authorizationEpochMirror !== intent.expectedAuthorizationEpoch
  )
    throw new ProviderAccountError("revision_conflict");
  await deps.authorizeOwner(intent.actorUserId);
  const reserved = await deps.store.reserve(intent);
  await deps.authorizeOwner(intent.actorUserId);
  return reserved;
}
/** Parent adapter owns the sole write-only SDK call. No credential enters the intent/store. */
export async function submitPersonalCanonicalOperation(
  actorUserId: string,
  clientOperationId: string,
  deps: PersonalCanonicalDependencies,
  ingress: (command: {
    operationId: string;
    accountRef: string;
    expectedMetadataRevision: number;
    action: "rename" | "reconnect" | "retire";
    displayName?: string;
  }) => Promise<void>,
) {
  await deps.authorizeOwner(actorUserId);
  const original = await deps.store.ready(actorUserId, clientOperationId);
  if (original.phase === "ready" || original.phase === "reserved") {
    await deps.authorizeOwner(actorUserId);
    const claim = await deps.store.claim(actorUserId, clientOperationId);
    if (claim) {
      try {
        await deps.authorizeOwner(actorUserId);
      } catch (error) {
        // Positive local non-entry only. Once ingress is called, never release.
        // A concurrent readback that marked unknown makes the CAS fail closed.
        await deps.store.releaseUnenteredClaim(
          actorUserId,
          clientOperationId,
          claim.claimToken,
        );
        throw error;
      }
      try {
        await ingress({
          operationId: original.id,
          accountRef: original.source.gatewayAccountRef,
          expectedMetadataRevision: original.intent.expectedGatewayRevision,
          action: original.intent.action,
          ...(original.intent.action === "rename"
            ? { displayName: original.intent.displayName }
            : {}),
        });
      } catch {
        await deps.store.notePhase(actorUserId, clientOperationId, "unknown");
      }
    }
  }
  return readPersonalCanonicalOperation(actorUserId, clientOperationId, deps);
}
/** Readback never retries ingress, even on 404/not-dispatched/unknown. */
export async function readPersonalCanonicalOperation(
  actorUserId: string,
  clientOperationId: string,
  deps: PersonalCanonicalDependencies,
) {
  await deps.authorizeOwner(actorUserId);
  const original = await deps.store.read(actorUserId, clientOperationId);
  if (!["submitted", "unknown"].includes(original.phase)) {
    await deps.authorizeOwner(actorUserId);
    return original;
  }
  try {
    const operation = await deps.gateway.operation(original.id);
    if (operation.operationId !== original.id)
      throw new ProviderAccountError("connection_unavailable");
    if (operation.state === "rejected") {
      await deps.store.notePhase(actorUserId, clientOperationId, "rejected");
    } else if (
      operation.state === "applied" &&
      operation.result &&
      original.source.profileRef
    ) {
      const account = await deps.gateway.get(
        actorUserId,
        original.source.gatewayAccountRef,
        original.source.profileRef,
      );
      if (
        operation.result.accountRef !== account.accountRef ||
        account.accountRef !== original.source.gatewayAccountRef ||
        account.profileId !== original.source.profileRef ||
        operation.result.metadataRevision !== account.metadataRevision ||
        operation.result.authorizationEpoch !== account.authorizationEpoch ||
        account.metadataRevision <= original.intent.expectedGatewayRevision ||
        (original.intent.action === "rename"
          ? account.authorizationEpoch !==
              original.intent.expectedAuthorizationEpoch ||
            account.displayName !== original.intent.displayName ||
            account.state !== original.source.state
          : account.authorizationEpoch <=
              original.intent.expectedAuthorizationEpoch ||
            (original.intent.action === "retire"
              ? !["disabled", "tombstoned"].includes(account.state)
              : account.state !== "active"))
      )
        throw new ProviderAccountError("connection_unavailable");
      await deps.authorizeOwner(actorUserId);
      const applied = await deps.store.finalize(
        actorUserId,
        clientOperationId,
        account,
      );
      await deps.authorizeOwner(actorUserId);
      return applied;
    }
  } catch {
    await deps.store.notePhase(actorUserId, clientOperationId, "unknown");
  }
  const current = await deps.store.read(actorUserId, clientOperationId);
  await deps.authorizeOwner(actorUserId);
  return current;
}
