import {
  accountLifecycleIntentHash,
  snapshotAccountLifecycleIntent,
  type AccountLifecycleIntent,
} from "../../domain/account-lifecycle";
import { ProviderAccountError } from "../../domain/provider-account";
import type {
  AccountLifecycleCommand,
  AccountLifecycleGatewayPort,
  AccountLifecycleOperationStore,
  AccountLifecycleReceipt,
} from "../ports/account-lifecycle-operation-port";
export type AccountLifecycleDependencies = {
  readonly store: AccountLifecycleOperationStore;
  readonly gateway: AccountLifecycleGatewayPort;
  readonly authorize: (actorUserId: string) => Promise<void>;
};
function commandOf(receipt: AccountLifecycleReceipt): AccountLifecycleCommand {
  if (!receipt.source.profileRef)
    throw new ProviderAccountError("connection_unavailable");
  return Object.freeze({
    operationId: receipt.id,
    accountRef: receipt.source.gatewayAccountRef,
    profileId: receipt.source.profileRef,
    expectedMetadataRevision: receipt.intent.expectedGatewayRevision,
    action: receipt.intent.action,
  });
}
function sameCommand(
  a: AccountLifecycleCommand,
  b: AccountLifecycleCommand,
): boolean {
  return (
    a.operationId === b.operationId &&
    a.accountRef === b.accountRef &&
    a.profileId === b.profileId &&
    a.expectedMetadataRevision === b.expectedMetadataRevision &&
    a.action === b.action
  );
}
export async function beginAccountLifecycle(
  request: AccountLifecycleIntent,
  deps: AccountLifecycleDependencies,
) {
  const intent = snapshotAccountLifecycleIntent(request);
  await deps.authorize(intent.actorUserId);
  // Reservation is local deny. No remote read precedes delete's durable denial.
  const result = await deps.store.reserve(intent);
  if (
    accountLifecycleIntentHash(result.intent) !==
    accountLifecycleIntentHash(intent)
  )
    throw new ProviderAccountError("operation_conflict");
  await deps.authorize(intent.actorUserId);
  return result;
}
export async function submitAccountLifecycle(
  actorUserId: string,
  operationId: string,
  deps: AccountLifecycleDependencies,
) {
  await deps.authorize(actorUserId);
  const receipt = await deps.store.ready(actorUserId, operationId);
  if (receipt.phase === "ready") {
    const command = commandOf(receipt);
    await deps.authorize(actorUserId);
    const claim = await deps.store.claim(actorUserId, operationId);
    if (claim) {
      try {
        await deps.authorize(actorUserId);
        await deps.gateway.preflight(command);
        if (
          !(await deps.store.enterClaim(
            actorUserId,
            operationId,
            claim.claimToken,
          ))
        )
          throw new ProviderAccountError("connection_unavailable");
      } catch (error) {
        await deps.store.releaseUnenteredClaim(
          actorUserId,
          operationId,
          claim.claimToken,
        );
        throw error;
      }
      try {
        await deps.gateway.submit(command);
      } catch {
        await deps.store.unknown(actorUserId, operationId);
      }
    }
  }
  return readAccountLifecycle(actorUserId, operationId, deps);
}
/** Never submits remote ingress, including absent/rejected/unknown readback. */
export async function readAccountLifecycle(
  actorUserId: string,
  operationId: string,
  deps: AccountLifecycleDependencies,
) {
  await deps.authorize(actorUserId);
  const receipt = await deps.store.read(actorUserId, operationId);
  if (["submitted", "unknown"].includes(receipt.phase)) {
    const command = commandOf(receipt);
    try {
      const response = await deps.gateway.read(command);
      const result = Object.freeze({
        command: Object.freeze({ ...response.command }),
        state: response.state,
        account: response.account
          ? Object.freeze({ ...response.account })
          : null,
        retirementOperationId: response.retirementOperationId,
        closure: response.closure
          ? Object.freeze({ ...response.closure })
          : null,
        noEffectProofRef: response.noEffectProofRef,
      });
      if (!sameCommand(command, result.command))
        throw new ProviderAccountError("operation_conflict");
      const account = result.account;
      if (
        account &&
        (account.accountRef !== command.accountRef ||
          account.profileId !== command.profileId)
      )
        throw new ProviderAccountError("connection_unavailable");
      await deps.authorize(actorUserId);
      if (
        result.state === "rejected_no_effect" &&
        account &&
        result.noEffectProofRef
      ) {
        if (
          account.metadataRevision !== receipt.intent.expectedGatewayRevision ||
          account.authorizationEpoch !==
            receipt.intent.expectedAuthorizationEpoch ||
          account.state !==
            (receipt.intent.action === "resume" ? "suspended" : "active")
        )
          throw new ProviderAccountError("connection_unavailable");
        await deps.store.reject(
          actorUserId,
          operationId,
          account,
          result.noEffectProofRef,
        );
      } else if (result.state === "applied" && account) {
        if (
          account.metadataRevision <= receipt.intent.expectedGatewayRevision ||
          account.authorizationEpoch <=
            receipt.intent.expectedAuthorizationEpoch ||
          (account.state !==
            (receipt.intent.action === "suspend"
              ? "suspended"
              : receipt.intent.action === "resume"
                ? "active"
                : "disabled") &&
            !(
              receipt.intent.action === "delete" &&
              account.state === "tombstoned"
            ))
        )
          throw new ProviderAccountError("connection_unavailable");
        if (receipt.intent.action === "delete" && !result.retirementOperationId)
          throw new ProviderAccountError("connection_unavailable");
        await deps.store.finalize(
          actorUserId,
          operationId,
          account,
          result.retirementOperationId,
          result.closure,
        );
      }
    } catch {
      await deps.store.unknown(actorUserId, operationId);
    }
  }
  const current = await deps.store.read(actorUserId, operationId);
  await deps.authorize(actorUserId);
  return current;
}
