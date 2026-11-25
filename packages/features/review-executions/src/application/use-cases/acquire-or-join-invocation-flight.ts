import {
  ReviewExecutionState,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseState,
  ReviewWorkSlotState,
  scopeKey,
  type ReviewExecutionSnapshot,
  type ReviewInvocationLease,
  type ReviewWorkSlot,
} from "../../domain/review-execution";
import {
  InvocationFlightJoinDecisionStatus,
  decideInvocationFlightJoin,
  invocationFlightIdentitiesEqual,
  invocationFlightIdentityFrom,
  restoreInvocationFlight,
  type InvocationFlight,
  type InvocationFlightIdentity,
} from "../../domain/invocation-flight";
import {
  ReviewInvocationLeaseAcquireStatus,
  type ReviewExecutionCommandPort,
  type ReviewExecutionQueryPort,
} from "../ports/review-execution-ports";
import type {
  AcquireOrJoinInvocationFlightInput,
  InvocationFlightQueryPort,
} from "../ports/invocation-flight-ports";

export enum AcquireOrJoinInvocationFlightStatus {
  InputStale = "input_stale",
  OwnerAcquired = "owner_acquired",
  OwnerRestored = "owner_restored",
  Joined = "joined",
  TakenOver = "taken_over",
  Busy = "busy",
  CrossRevisionJoinForbidden = "cross_revision_join_forbidden",
  AttemptBudgetExhausted = "attempt_budget_exhausted",
  NotRunnable = "not_runnable",
  Missing = "missing",
  IdempotencyConflict = "idempotency_conflict",
}

export type AcquireOrJoinInvocationFlightResult = Readonly<{
  status: AcquireOrJoinInvocationFlightStatus;
  flight?: InvocationFlight | undefined;
}>;

export class AcquireOrJoinInvocationFlight {
  constructor(
    private readonly flights: InvocationFlightQueryPort,
    private readonly executions: ReviewExecutionQueryPort,
    private readonly commands: ReviewExecutionCommandPort,
  ) {}

  async execute(
    command: AcquireOrJoinInvocationFlightInput,
  ): Promise<AcquireOrJoinInvocationFlightResult> {
    if (
      command.purpose !== ReviewInvocationLeasePurpose.ProviderExecution ||
      command.preparedManifestKey === null
    ) {
      throw new Error("invocation_flight_requires_provider_execution");
    }
    const target = await this.executions.findExecution(command.executionId);
    if (target === null) {
      return { status: AcquireOrJoinInvocationFlightStatus.Missing };
    }
    if (
      scopeKey(target.execution) !== scopeKey(command.scope) ||
      target.stream.activeExecutionId !== target.execution.executionId ||
      target.execution.state !== ReviewExecutionState.Running
    ) {
      return { status: AcquireOrJoinInvocationFlightStatus.NotRunnable };
    }
    const slot = target.execution.workSlots.find(
      (candidate) => candidate.workSlotId === command.workSlotId,
    );
    if (slot === undefined) {
      return { status: AcquireOrJoinInvocationFlightStatus.Missing };
    }
    if (slot.state === ReviewWorkSlotState.Exhausted) {
      return {
        status: AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted,
      };
    }
    if (
      slot.state === ReviewWorkSlotState.Satisfied ||
      slot.state === ReviewWorkSlotState.Cancelled
    ) {
      return { status: AcquireOrJoinInvocationFlightStatus.NotRunnable };
    }
    const requestedIdentity = invocationFlightIdentityFrom({
      execution: target.execution,
      slot,
      providerInvocationKey: command.providerInvocationKey,
      preparedManifestKey: command.preparedManifestKey,
      providerVoteIdentityHash: command.providerVoteIdentityHash,
      policyIdentityHash: command.leaseSafetyDecisionHash,
    });

    let takeover = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const observation = await this.flights.observeActiveInvocationFlight({
        scope: command.scope,
        providerInvocationKey: command.providerInvocationKey,
        providerVoteIdentityHash: command.providerVoteIdentityHash,
        requestedAt: command.now,
      });
      const incumbent = observation.flight;
      if (incumbent?.executionId === command.executionId) {
        const incumbentLease = await this.executions.findLease(
          incumbent.ownerLeaseId,
        );
        if (
          incumbentLease?.acquireRequestIdHash ===
            command.acquireRequestIdHash &&
          incumbentLease.providerInvocationKey === command.providerInvocationKey
        ) {
          // Exact retries recover their owner acknowledgement; the store checks
          // the complete request identity before restoring the original lease.
          const replay = await this.commands.acquireLease(command);
          if (
            replay.status ===
            ReviewInvocationLeaseAcquireStatus.IdempotencyConflict
          ) {
            return {
              status: AcquireOrJoinInvocationFlightStatus.IdempotencyConflict,
            };
          }
          if (
            replay.status !== ReviewInvocationLeaseAcquireStatus.Restored ||
            replay.lease === undefined
          ) {
            throw new Error("invocation_flight_acquire_replay_not_restored");
          }
          const flight = await this.restoreAcquiredFlight(
            replay.lease,
            requestedIdentity,
            command.now,
          );
          return flight === null
            ? { status: AcquireOrJoinInvocationFlightStatus.NotRunnable }
            : {
                status: AcquireOrJoinInvocationFlightStatus.OwnerRestored,
                flight,
              };
        }
      }
      const decision = decideInvocationFlightJoin({
        incumbent,
        requestedIdentity,
        now: observation.observedAt,
      });
      if (decision === InvocationFlightJoinDecisionStatus.Join) {
        return {
          status: AcquireOrJoinInvocationFlightStatus.Joined,
          flight: incumbent ?? undefined,
        };
      }
      if (
        decision ===
        InvocationFlightJoinDecisionStatus.CrossRevisionJoinForbidden
      ) {
        return {
          status:
            AcquireOrJoinInvocationFlightStatus.CrossRevisionJoinForbidden,
          flight: incumbent ?? undefined,
        };
      }
      if (decision === InvocationFlightJoinDecisionStatus.Busy) {
        return {
          status: AcquireOrJoinInvocationFlightStatus.Busy,
          flight: incumbent ?? undefined,
        };
      }
      takeover ||= decision === InvocationFlightJoinDecisionStatus.Takeover;

      const acquired = await this.commands.acquireLease(command);
      if (
        acquired.status === ReviewInvocationLeaseAcquireStatus.Acquired ||
        acquired.status === ReviewInvocationLeaseAcquireStatus.Restored
      ) {
        if (acquired.lease === undefined) {
          throw new Error("invocation_flight_acquired_lease_missing");
        }
        const flight = await this.restoreAcquiredFlight(
          acquired.lease,
          requestedIdentity,
          command.now,
        );
        if (flight === null) {
          return { status: AcquireOrJoinInvocationFlightStatus.NotRunnable };
        }
        return {
          status: takeover
            ? AcquireOrJoinInvocationFlightStatus.TakenOver
            : acquired.status === ReviewInvocationLeaseAcquireStatus.Restored
              ? AcquireOrJoinInvocationFlightStatus.OwnerRestored
              : AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
          flight,
        };
      }
      if (acquired.status === ReviewInvocationLeaseAcquireStatus.Busy) {
        continue;
      }
      return { status: mapAcquireStatus(acquired.status) };
    }
    return { status: AcquireOrJoinInvocationFlightStatus.Busy };
  }

  private async restoreAcquiredFlight(
    lease: ReviewInvocationLease,
    requestedIdentity: InvocationFlightIdentity,
    requestedAt: Date,
  ): Promise<InvocationFlight | null> {
    const snapshot = await this.executions.findExecution(lease.executionId);
    const slot = findLeaseSlot(snapshot, lease);
    if (snapshot === null || slot === null) {
      throw new Error("invocation_flight_acquired_aggregate_missing");
    }
    const observation = await this.flights.observeActiveInvocationFlight({
      scope: lease,
      providerInvocationKey: lease.providerInvocationKey,
      providerVoteIdentityHash: lease.providerVoteIdentityHash,
      requestedAt,
    });
    const currentLease = snapshot.activeLeases.find(
      (candidate) => candidate.leaseId === lease.leaseId,
    );
    if (
      currentLease === undefined ||
      currentLease.state !== ReviewInvocationLeaseState.Active ||
      currentLease.expiresAt <= observation.observedAt ||
      observation.flight === null ||
      observation.flight.ownerLeaseId !== lease.leaseId ||
      !invocationFlightIdentitiesEqual(
        observation.flight.identity,
        requestedIdentity,
      ) ||
      snapshot.execution.state !== ReviewExecutionState.Running ||
      snapshot.stream.activeExecutionId !== lease.executionId ||
      slot.activeLeaseId !== lease.leaseId
    ) {
      return null;
    }
    const flight = restoreInvocationFlight({
      execution: snapshot.execution,
      slot,
      lease: currentLease,
    });
    if (!invocationFlightIdentitiesEqual(flight.identity, requestedIdentity)) {
      throw new Error("invocation_flight_acquired_identity_mismatch");
    }
    return flight;
  }
}

function findLeaseSlot(
  snapshot: ReviewExecutionSnapshot | null,
  lease: ReviewInvocationLease,
): ReviewWorkSlot | null {
  return (
    snapshot?.execution.workSlots.find(
      (candidate) => candidate.workSlotId === lease.workSlotId,
    ) ?? null
  );
}

function mapAcquireStatus(
  status: Exclude<
    ReviewInvocationLeaseAcquireStatus,
    | ReviewInvocationLeaseAcquireStatus.Acquired
    | ReviewInvocationLeaseAcquireStatus.Restored
    | ReviewInvocationLeaseAcquireStatus.Busy
  >,
): AcquireOrJoinInvocationFlightStatus {
  switch (status) {
    case ReviewInvocationLeaseAcquireStatus.InputStale:
      return AcquireOrJoinInvocationFlightStatus.InputStale;
    case ReviewInvocationLeaseAcquireStatus.AttemptBudgetExhausted:
      return AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted;
    case ReviewInvocationLeaseAcquireStatus.NotRunnable:
      return AcquireOrJoinInvocationFlightStatus.NotRunnable;
    case ReviewInvocationLeaseAcquireStatus.Missing:
      return AcquireOrJoinInvocationFlightStatus.Missing;
    case ReviewInvocationLeaseAcquireStatus.IdempotencyConflict:
      return AcquireOrJoinInvocationFlightStatus.IdempotencyConflict;
  }
}
