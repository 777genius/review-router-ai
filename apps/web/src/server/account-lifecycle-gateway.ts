import { createHash } from "node:crypto";
import * as c from "@agent-teams/account-gateway/contracts";
import type {
  LifecycleClient,
  ManagementClient,
} from "@agent-teams/account-gateway/http";
import { ProviderAccountError } from "@reviewrouter/features-provider-accounts";
import type {
  AccountLifecycleGatewayPort,
  AccountLifecycleCommand,
  AccountLifecycleClosure,
} from "@reviewrouter/features-provider-accounts/synchronization";

const digest = (kind: string, facts: unknown) =>
  `rr_${createHash("sha256")
    .update(JSON.stringify(["rr-account-delete-proof-v1", kind, facts]))
    .digest("hex")}`;
export function createAccountLifecycleGateway(input: {
  lifecycle: LifecycleClient;
  legacy: Pick<ManagementClient, "disable" | "operation" | "retirement">;
  authorize(): Promise<void>;
  ownerRef: string;
  bindingClosure(command: AccountLifecycleCommand): Promise<string | null>;
}): AccountLifecycleGatewayPort {
  async function checked<T>(call: () => Promise<T>) {
    await input.authorize();
    const result = await call();
    await input.authorize();
    return result;
  }
  function exact(
    command: AccountLifecycleCommand,
    account: { accountRef: string; profileId: string; ownerRef: string },
  ) {
    if (
      account.accountRef !== command.accountRef ||
      account.profileId !== command.profileId ||
      account.ownerRef !== input.ownerRef
    )
      throw new ProviderAccountError("connection_unavailable");
  }
  return {
    async preflight() {
      await input.authorize();
    },
    async submit(command) {
      await checked(async () =>
        command.action === "delete"
          ? input.legacy.disable(command.accountRef, {
              operationId: command.operationId,
              expectedMetadataRevision: command.expectedMetadataRevision,
            })
          : input.lifecycle[command.action](command.accountRef, {
              operationId: command.operationId,
              expectedMetadataRevision: command.expectedMetadataRevision,
            }),
      );
    },
    async read(command) {
      if (command.action === "delete") {
        // This endpoint reads exact original retirement, not a new disable and not a guessed legacy reference.
        const retirement = c.accountRetirement.parse(
          await checked(() =>
            input.legacy.retirement(command.accountRef, command.operationId),
          ),
        );
        exact(command, retirement.account);
        if (
          retirement.operationRef !== command.operationId ||
          retirement.fence.metadataRevision <= command.expectedMetadataRevision
        )
          throw new ProviderAccountError("operation_conflict");
        let closure: AccountLifecycleClosure | null = null;
        if (retirement.state === "completed" && retirement.inert) {
          const binding = await checked(() => input.bindingClosure(command));
          if (binding) {
            const tuple = {
              operationId: command.operationId,
              accountRef: command.accountRef,
              profileId: command.profileId,
              fence: retirement.fence,
            };
            // Each digest names independently checked authoritative facts. The strict retirement
            // reader verifies all retained generations erased and every request transport closed.
            // Binding proof is independently read from the complete local revoked/fence-ACK scope.
            closure = {
              retirementOperationId: command.operationId,
              bindingErasureProofRef: binding,
              nativeErasureProofRef: digest("native", {
                ...tuple,
                retained: retirement.counts.retainedGenerations,
                erased: retirement.counts.settledNativeErasureGenerations,
              }),
              transportErasureProofRef: digest("transport", {
                ...tuple,
                executions: retirement.counts.retainedExecutions,
                requests: retirement.counts.requests,
                open: retirement.counts.openExecutions,
                occupied: retirement.counts.occupiedTransports,
                ack: retirement.counts.acknowledgedNativeTransports,
                nonEntry: retirement.counts.positiveKernelNonEntryRequests,
                unknown: retirement.counts.unknownEffects,
              }),
            };
          }
        }
        return {
          command,
          state: retirement.state === "rejected" ? "unknown" : "applied",
          account: retirement.account,
          retirementOperationId: command.operationId,
          closure,
          noEffectProofRef: null,
        };
      }
      const operation = c.lifecycleOperation.parse(
        await checked(() => input.lifecycle.operation(command.operationId)),
      );
      const intent = operation.intent;
      if (
        operation.operationRef !== command.operationId ||
        intent.action !== command.action ||
        intent.accountRef !== command.accountRef ||
        intent.profileId !== command.profileId ||
        intent.expectedMetadataRevision !== command.expectedMetadataRevision
      )
        throw new ProviderAccountError("operation_conflict");
      const account =
        operation.state === "applied"
          ? operation.result.account
          : operation.account;
      exact(command, account);
      const rejected =
        operation.state === "rejected" &&
        operation.error.effect === "not_dispatched";
      return {
        command,
        state:
          operation.state === "applied"
            ? "applied"
            : rejected
              ? "rejected_no_effect"
              : operation.state === "pending"
                ? "pending"
                : "unknown",
        account,
        retirementOperationId: null,
        closure: null,
        noEffectProofRef: rejected
          ? digest("no-effect", {
              operationId: command.operationId,
              intent,
              account,
              effect: operation.error.effect,
            })
          : null,
      };
    },
  };
}
