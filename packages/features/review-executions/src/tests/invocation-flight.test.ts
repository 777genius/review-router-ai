import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  AcquireOrJoinInvocationFlight,
  AcquireOrJoinInvocationFlightStatus,
  ReviewExecutionAdmissionVerdict,
  ReviewExecutionProviderKind,
  ReviewInvocationLeasePurpose,
  ReviewInvocationLeaseTransitionStatus,
  ReviewTaskKind,
  ReviewWorkSlotState,
  canonicalInvocationFlightIdentity,
  invocationFlightIdentityFrom,
  type PrepareReviewExecutionCommand,
  type ReviewExecutionLimits,
  type ReviewExecutionScope,
  type ReviewRevision,
} from "../index";
import { InMemoryReviewExecutionStore } from "../testing/index";

const baseTime = new Date("2026-07-24T08:00:00.000Z");
const limits: ReviewExecutionLimits = {
  profileId: "limits-v1",
  maxWorkSlots: 8,
  maxAttemptBudget: 8,
  maxProjectionBytes: 32_000,
  maxFindingCount: 100,
  maxLeaseDurationMs: 60_000,
  maxResultReportDurationMs: 120_000,
};
const scope: ReviewExecutionScope = {
  workspaceId: "workspace-1",
  repositoryConnectionId: "connection-1",
  scmRepositoryIdentityId: "repository-1",
  pullRequestNumber: 42,
};
const otherScope: ReviewExecutionScope = {
  ...scope,
  pullRequestNumber: 43,
};
const revision = revisionFixture("a", "b", "c", "d");
const nextRevision = revisionFixture("a", "b", "e", "f");

describe("InvocationFlight singleflight", () => {
  it("restores the exact owner request after a lost acquire acknowledgement", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const request = leaseCommand({
      index: 1,
      scope,
      executionId: "execution-1",
      now: plus(2),
    });
    const owner = await useCase.execute(request);
    const replay = await useCase.execute({
      ...request,
      leaseId: "unused-retry-lease",
      attemptId: "unused-retry-attempt",
      leaseCapabilityId: "unused-retry-capability",
      now: plus(3),
    });

    expect(owner.status).toBe(
      AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
    );
    expect(replay.status).toBe(
      AcquireOrJoinInvocationFlightStatus.OwnerRestored,
    );
    expect(replay.flight).toEqual(owner.flight);
    const snapshot = await store.findExecution("execution-1");
    expect(snapshot?.activeLeases).toHaveLength(1);
    expect(snapshot?.activeLeases[0]).toMatchObject({
      leaseId: "lease-1",
      attemptId: "attempt-1",
      attemptOrdinal: 1,
      leaseCapabilityId: "capability-1",
      fencingToken: owner.flight!.fencingToken,
    });
    expect(snapshot?.execution.workSlots[0]?.nextAttemptOrdinal).toBe(2);
  });

  it("restores an exact retry whose target was read before the owner committed", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const staleTarget = await store.findExecution("execution-1");
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const request = leaseCommand({
      index: 1,
      scope,
      executionId: "execution-1",
      now: plus(2),
    });
    const owner = await useCase.execute(request);
    vi.spyOn(store, "findExecution").mockResolvedValueOnce(staleTarget);

    const replay = await useCase.execute({ ...request, now: plus(3) });

    expect(replay.status).toBe(
      AcquireOrJoinInvocationFlightStatus.OwnerRestored,
    );
    expect(replay.flight).toEqual(owner.flight);
    expect(
      (await store.findExecution("execution-1"))?.execution.workSlots[0]
        ?.nextAttemptOrdinal,
    ).toBe(2);
  });

  it("does not restore an owner superseded while its acquire replay completes", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const request = leaseCommand({
      index: 1,
      scope,
      executionId: "execution-1",
      now: plus(2),
    });
    await useCase.execute(request);
    const acquireLease = store.acquireLease.bind(store);
    vi.spyOn(store, "acquireLease").mockImplementationOnce(async (command) => {
      const restored = await acquireLease(command);
      const stream = await store.findStream(scope);
      await store.supersedeExecution({
        scope,
        executionId: "execution-1",
        expectedStreamVersion: stream!.version,
        observedCurrentRevision: nextRevision,
        now: plus(4),
      });
      return restored;
    });

    const replay = await useCase.execute({ ...request, now: plus(3) });

    expect(replay.status).toBe(AcquireOrJoinInvocationFlightStatus.NotRunnable);
    expect(replay.flight).toBeUndefined();
    expect(
      (await store.findExecution("execution-1"))?.execution.workSlots[0]
        ?.nextAttemptOrdinal,
    ).toBe(2);
  });

  it("does not restore an owner whose lease expires while its acquire replay completes", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const request = leaseCommand({
      index: 1,
      scope,
      executionId: "execution-1",
      now: plus(2),
      expiresAt: plus(1_000),
    });
    await useCase.execute(request);
    let databaseTime = plus(3);
    const observe = store.observeActiveInvocationFlight.bind(store);
    vi.spyOn(store, "observeActiveInvocationFlight").mockImplementation(
      (input) => observe({ ...input, requestedAt: databaseTime }),
    );
    const acquireLease = store.acquireLease.bind(store);
    vi.spyOn(store, "acquireLease").mockImplementationOnce(async (command) => {
      const restored = await acquireLease(command);
      databaseTime = plus(1_001);
      return restored;
    });

    const replay = await useCase.execute({ ...request, now: plus(3) });

    expect(replay.status).toBe(AcquireOrJoinInvocationFlightStatus.NotRunnable);
    expect(replay.flight).toBeUndefined();
    expect(
      (await store.findExecution("execution-1"))?.execution.workSlots[0]
        ?.nextAttemptOrdinal,
    ).toBe(2);
  });

  it.each([
    { acquireRequestHash: hash("changed-request") },
    { ownerIdHash: "changed-owner" },
    { preparedManifestCanonicalJson: '{"manifestVersion":2}' },
    { preparedManifestKey: hash("changed-manifest") },
  ])(
    "rejects a changed identity under the same acquire request: %j",
    async (changed) => {
      const store = new InMemoryReviewExecutionStore();
      await prepareAndAdmit(store, scope, "execution-1", revision);
      const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
      const request = leaseCommand({
        index: 1,
        scope,
        executionId: "execution-1",
        now: plus(2),
      });
      await useCase.execute(request);

      const replay = await useCase.execute({
        ...request,
        ...changed,
        now: plus(3),
      });

      expect(replay.status).toBe(
        AcquireOrJoinInvocationFlightStatus.IdempotencyConflict,
      );
      expect(replay.flight).toBeUndefined();
      expect(
        (await store.findExecution("execution-1"))?.activeLeases,
      ).toHaveLength(1);
    },
  );

  it("rejects a reused acquire request that changes the work slot", async () => {
    const store = new InMemoryReviewExecutionStore();
    const command = prepareCommand(scope, "execution-1", revision);
    await prepareAndAdmit(store, scope, "execution-1", revision, [
      ...command.workSlots,
      {
        ...command.workSlots[0]!,
        workSlotId: "slot-2",
        shardKey: "other-shard",
      },
    ]);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const request = leaseCommand({
      index: 1,
      scope,
      executionId: "execution-1",
      now: plus(2),
    });
    await useCase.execute(request);

    const replay = await useCase.execute({
      ...request,
      workSlotId: "slot-2",
      acquireRequestHash: hash("changed-work-slot"),
      now: plus(3),
    });

    expect(replay.status).toBe(
      AcquireOrJoinInvocationFlightStatus.IdempotencyConflict,
    );
    expect(replay.flight).toBeUndefined();
    const snapshot = await store.findExecution("execution-1");
    expect(snapshot?.activeLeases).toHaveLength(1);
    expect(snapshot?.execution.workSlots[1]?.nextAttemptOrdinal).toBe(1);
  });

  it.each([
    { at: 3, expected: AcquireOrJoinInvocationFlightStatus.Busy },
    { at: 2_000, expected: AcquireOrJoinInvocationFlightStatus.TakenOver },
  ])(
    "namespaces the same acquire ID by invocation key at $at",
    async ({ at, expected }) => {
      const store = new InMemoryReviewExecutionStore();
      await prepareAndAdmit(store, scope, "execution-1", revision);
      const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
      const request = leaseCommand({
        index: 1,
        scope,
        executionId: "execution-1",
        now: plus(2),
        expiresAt: plus(1_000),
      });
      const owner = await useCase.execute(request);

      const differentKey = await useCase.execute({
        ...request,
        providerInvocationKey: hash("other-invocation"),
        acquireRequestHash: hash("same-id-other-key"),
        leaseId: "lease-other-key",
        attemptId: "attempt-other-key",
        leaseCapabilityId: "capability-other-key",
        now: plus(at),
        expiresAt: plus(3_000),
      });

      expect(differentKey.status).toBe(expected);
      const snapshot = await store.findExecution("execution-1");
      expect(snapshot?.activeLeases).toHaveLength(1);
      if (expected === AcquireOrJoinInvocationFlightStatus.TakenOver) {
        expect(differentKey.flight?.ownerLeaseId).toBe("lease-other-key");
        expect(differentKey.flight!.fencingToken).toBeGreaterThan(
          owner.flight!.fencingToken,
        );
        expect(snapshot?.activeLeases[0]?.attemptOrdinal).toBe(2);
      } else {
        expect(snapshot?.activeLeases[0]?.leaseId).toBe("lease-1");
        expect(snapshot?.activeLeases[0]?.attemptOrdinal).toBe(1);
      }
    },
  );

  it("still joins a distinct acquire request from the same owner", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const owner = await useCase.execute(
      leaseCommand({
        index: 1,
        scope,
        executionId: "execution-1",
        now: plus(2),
      }),
    );
    const joined = await useCase.execute({
      ...leaseCommand({
        index: 2,
        scope,
        executionId: "execution-1",
        now: plus(3),
      }),
      ownerIdHash: "owner-1",
    });

    expect(joined.status).toBe(AcquireOrJoinInvocationFlightStatus.Joined);
    expect(joined.flight).toEqual(owner.flight);
    expect(
      (await store.findExecution("execution-1"))?.activeLeases,
    ).toHaveLength(1);
  });

  it("does not restore an expired owner request or consume another attempt", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const request = leaseCommand({
      index: 1,
      scope,
      executionId: "execution-1",
      now: plus(2),
      expiresAt: plus(1_000),
    });
    await useCase.execute(request);

    const replay = await useCase.execute({ ...request, now: plus(2_000) });

    expect(replay.status).toBe(AcquireOrJoinInvocationFlightStatus.NotRunnable);
    expect(replay.flight).toBeUndefined();
    expect(
      (await store.findExecution("execution-1"))?.execution.workSlots[0]
        ?.nextAttemptOrdinal,
    ).toBe(2);
  });

  it("joins simultaneous exact-revision requests onto one durable flight", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);

    const results = await Promise.all(
      Array.from({ length: 32 }, (_, index) =>
        useCase.execute(
          leaseCommand({
            index,
            scope,
            executionId: "execution-1",
            now: plus(2),
          }),
        ),
      ),
    );

    expect(
      results.filter(
        (result) =>
          result.status === AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
      ),
    ).toHaveLength(1);
    expect(
      results.filter(
        (result) =>
          result.status === AcquireOrJoinInvocationFlightStatus.Joined,
      ),
    ).toHaveLength(31);
    expect(new Set(results.map((result) => result.flight?.flightId))).toEqual(
      new Set(["lease-0"]),
    );
    expect(
      (await store.findExecution("execution-1"))?.activeLeases,
    ).toHaveLength(1);
  });

  it("reports exhausted attempt budget after the final provider lease is released", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);

    for (let index = 1; index <= 4; index += 1) {
      const owner = await useCase.execute(
        leaseCommand({
          index,
          scope,
          executionId: "execution-1",
          now: plus(index * 2),
        }),
      );
      expect(owner.status).toBe(
        AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
      );
      const released = await store.releaseLease({
        leaseId: owner.flight!.ownerLeaseId,
        ownerIdHash: owner.flight!.ownerIdHash,
        leaseCapabilityId: `capability-${index}`,
        fencingToken: owner.flight!.fencingToken,
        now: plus(index * 2 + 1),
      });
      expect(released.status).toBe(
        ReviewInvocationLeaseTransitionStatus.Applied,
      );
    }

    const exhausted = await store.findExecution("execution-1");
    expect(exhausted?.execution.workSlots[0]).toMatchObject({
      state: ReviewWorkSlotState.Exhausted,
      attemptBudget: 4,
      nextAttemptOrdinal: 5,
    });
    expect(exhausted?.activeLeases).toHaveLength(0);
    for (const index of [5, 6]) {
      const result = await useCase.execute(
        leaseCommand({
          index,
          scope,
          executionId: "execution-1",
          now: plus(index * 2),
        }),
      );
      expect(result.status).toBe(
        AcquireOrJoinInvocationFlightStatus.AttemptBudgetExhausted,
      );
      expect(result.flight).toBeUndefined();
    }
    expect(
      (await store.findExecution("execution-1"))?.activeLeases,
    ).toHaveLength(0);
  });

  it("never joins an active flight from another revision", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    await prepareAndAdmit(store, otherScope, "execution-2", nextRevision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const owner = await useCase.execute(
      leaseCommand({
        index: 1,
        scope,
        executionId: "execution-1",
        now: plus(2),
      }),
    );

    const result = await useCase.execute(
      leaseCommand({
        index: 2,
        scope: otherScope,
        executionId: "execution-2",
        now: plus(3),
      }),
    );

    expect(owner.status).toBe(
      AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
    );
    expect(result.status).toBe(
      AcquireOrJoinInvocationFlightStatus.CrossRevisionJoinForbidden,
    );
    expect(
      (await store.findExecution("execution-2"))?.activeLeases,
    ).toHaveLength(0);
  });

  it("acquires independent owners for the same provider account in separate scopes", async () => {
    const store = new InMemoryReviewExecutionStore(undefined, {
      providerScopeConcurrencyActivated: true,
    });
    await prepareAndAdmit(store, scope, "execution-1", revision);
    await prepareAndAdmit(store, otherScope, "execution-2", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);

    const results = await Promise.all([
      useCase.execute(
        leaseCommand({
          index: 1,
          scope,
          executionId: "execution-1",
          now: plus(2),
        }),
      ),
      useCase.execute(
        leaseCommand({
          index: 2,
          scope: otherScope,
          executionId: "execution-2",
          now: plus(2),
        }),
      ),
    ]);

    expect(results.map((result) => result.status)).toEqual([
      AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
      AcquireOrJoinInvocationFlightStatus.OwnerAcquired,
    ]);
  });

  it("does not join when provider or compatibility-policy identity differs", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    await useCase.execute(
      leaseCommand({
        index: 1,
        scope,
        executionId: "execution-1",
        now: plus(2),
      }),
    );

    const policyMismatch = await useCase.execute({
      ...leaseCommand({
        index: 2,
        scope,
        executionId: "execution-1",
        now: plus(3),
      }),
      leaseSafetyDecisionHash: hash("other-policy"),
    });
    const invocationMismatch = await useCase.execute({
      ...leaseCommand({
        index: 3,
        scope,
        executionId: "execution-1",
        now: plus(3),
      }),
      providerInvocationKey: hash("other-invocation"),
    });

    expect(policyMismatch.status).toBe(
      AcquireOrJoinInvocationFlightStatus.Busy,
    );
    expect(invocationMismatch.status).toBe(
      AcquireOrJoinInvocationFlightStatus.Busy,
    );
    expect(
      (await store.findExecution("execution-1"))?.activeLeases,
    ).toHaveLength(1);
  });

  it("takes over an expired owner with a larger fence and rejects the stale term", async () => {
    const store = new InMemoryReviewExecutionStore();
    await prepareAndAdmit(store, scope, "execution-1", revision);
    const useCase = new AcquireOrJoinInvocationFlight(store, store, store);
    const owner = await useCase.execute(
      leaseCommand({
        index: 1,
        scope,
        executionId: "execution-1",
        now: plus(2),
        expiresAt: plus(1_000),
      }),
    );
    const takeover = await useCase.execute(
      leaseCommand({
        index: 2,
        scope,
        executionId: "execution-1",
        now: plus(2_000),
        expiresAt: plus(32_000),
      }),
    );
    const stale = await store.releaseLease({
      leaseId: takeover.flight!.ownerLeaseId,
      ownerIdHash: owner.flight!.ownerIdHash,
      leaseCapabilityId: "capability-1",
      fencingToken: owner.flight!.fencingToken,
      now: plus(2_001),
    });

    expect(takeover.status).toBe(AcquireOrJoinInvocationFlightStatus.TakenOver);
    expect(takeover.flight!.fencingToken).toBeGreaterThan(
      owner.flight!.fencingToken,
    );
    expect(stale.status).toBe(ReviewInvocationLeaseTransitionStatus.StaleTerm);
    expect(
      (
        await store.observeActiveInvocationFlightByLane({
          providerVoteIdentityHash: hash("lane"),
          requestedAt: plus(2_001),
        })
      ).flight,
    ).toMatchObject({
      ownerLeaseId: "lease-2",
      fencingToken: takeover.flight!.fencingToken,
    });
  });

  it("keeps identity independent from work-slot and scheduler shard order", async () => {
    const store = new InMemoryReviewExecutionStore();
    const snapshot = await prepareAndAdmit(
      store,
      scope,
      "execution-1",
      revision,
    );
    const slot = snapshot.execution.workSlots[0]!;
    const first = invocationFlightIdentityFrom({
      execution: snapshot.execution,
      slot,
      providerInvocationKey: hash("invocation"),
      preparedManifestKey: hash("manifest"),
      providerVoteIdentityHash: slot.providerVoteIdentityHash,
      policyIdentityHash: hash("policy"),
    });
    const rescheduled = invocationFlightIdentityFrom({
      execution: snapshot.execution,
      slot: { ...slot, workSlotId: "other-slot", shardKey: "other-shard" },
      providerInvocationKey: hash("invocation"),
      preparedManifestKey: hash("manifest"),
      providerVoteIdentityHash: slot.providerVoteIdentityHash,
      policyIdentityHash: hash("policy"),
    });

    expect(canonicalInvocationFlightIdentity(rescheduled)).toBe(
      canonicalInvocationFlightIdentity(first),
    );
    expect(
      canonicalInvocationFlightIdentity(
        invocationFlightIdentityFrom({
          execution: {
            ...snapshot.execution,
            compatibilityKey: "compatibility-v2",
          },
          slot,
          providerInvocationKey: hash("invocation"),
          preparedManifestKey: hash("manifest"),
          providerVoteIdentityHash: slot.providerVoteIdentityHash,
          policyIdentityHash: hash("policy"),
        }),
      ),
    ).not.toBe(canonicalInvocationFlightIdentity(first));
  });
});

async function prepareAndAdmit(
  store: InMemoryReviewExecutionStore,
  requestedScope: ReviewExecutionScope,
  executionId: string,
  requestedRevision: ReviewRevision,
  workSlots?: PrepareReviewExecutionCommand["workSlots"],
) {
  const command = prepareCommand(
    requestedScope,
    executionId,
    requestedRevision,
  );
  const prepared = await store.prepareExecution({
    ...command,
    workSlots: workSlots ?? command.workSlots,
  });
  const admitted = await store.confirmAdmission({
    scope: requestedScope,
    expectedStreamVersion: prepared.snapshot!.stream.version,
    executionId,
    authorizationId: "authorization-1",
    mutationEpoch: 1n,
    requestedRevision,
    observedRevision: requestedRevision,
    verdict: ReviewExecutionAdmissionVerdict.Current,
    checkedAt: plus(1),
  });
  return admitted.snapshot!;
}

function prepareCommand(
  requestedScope: ReviewExecutionScope,
  executionId: string,
  requestedRevision: ReviewRevision,
): PrepareReviewExecutionCommand {
  return {
    scope: requestedScope,
    expectedStreamVersion: 0n,
    executionId,
    authorizationId: "authorization-1",
    producerReleaseId: "producer-release-1",
    mutationEpoch: 1n,
    revision: requestedRevision,
    startIdentityHash: hash(`start-${executionId}`),
    canonicalStartHash: hash(`canonical-${executionId}`),
    admissionSafetyDecisionHash: hash("admission"),
    compatibilityKey: "compatibility-v1",
    planHash: hash(`plan-${executionId}`),
    workSlots: [
      {
        workSlotId: "slot-1",
        taskKind: ReviewTaskKind.FindingDiscovery,
        providerKind: ReviewExecutionProviderKind.Codex,
        providerVoteIdentityHash: hash("lane"),
        shardKey: `pr-${requestedScope.pullRequestNumber}`,
        required: true,
        attemptBudget: 4,
        retryPolicyVersion: "retry-v1",
      },
    ],
    limits,
    sourceRunId: `run-${executionId}`,
    sourceRunAttempt: "1",
    now: baseTime,
    admissionDeadlineAt: plus(60_000),
    executionDeadlineAt: plus(600_000),
    retainUntil: plus(3_600_000),
  };
}

function leaseCommand(input: {
  readonly index: number;
  readonly scope: ReviewExecutionScope;
  readonly executionId: string;
  readonly now: Date;
  readonly expiresAt?: Date;
}) {
  return {
    scope: input.scope,
    executionId: input.executionId,
    workSlotId: "slot-1",
    purpose: ReviewInvocationLeasePurpose.ProviderExecution,
    providerInvocationKey: hash("invocation"),
    preparedManifestCanonicalJson: '{"manifestVersion":1}',
    preparedManifestKey: hash("manifest"),
    providerVoteIdentityHash: hash("lane"),
    leaseId: `lease-${input.index}`,
    attemptId: `attempt-${input.index}`,
    sourceObservationId: null,
    acquireRequestIdHash: hash(`request-id-${input.index}`),
    acquireRequestHash: hash(`request-${input.index}`),
    ownerIdHash: `owner-${input.index}`,
    leaseCapabilityId: `capability-${input.index}`,
    capabilitySigningKeyId: "signing-key-1",
    leaseSafetyDecisionHash: hash("policy"),
    now: input.now,
    expiresAt: input.expiresAt ?? new Date(input.now.getTime() + 30_000),
    resultReportUntil: new Date(input.now.getTime() + 60_000),
    retainUntil: plus(300_000),
    limits,
  } as const;
}

function revisionFixture(
  base: string,
  mergeBase: string,
  head: string,
  review: string,
): ReviewRevision {
  return {
    baseSha: base.repeat(40),
    mergeBaseSha: mergeBase.repeat(40),
    headSha: head.repeat(40),
    reviewRevisionHash: review.repeat(64),
  };
}

function hash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function plus(milliseconds: number): Date {
  return new Date(baseTime.getTime() + milliseconds);
}
