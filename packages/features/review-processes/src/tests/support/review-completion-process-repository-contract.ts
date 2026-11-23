import { describe, expect, it } from "vitest";
import {
  ReviewCompletionProcessCreateStatus,
  ReviewCompletionProcessTransitionStatus,
  type ReviewCompletionProcessRepositoryPort,
} from "../../application/ports/review-completion-process-ports";
import {
  ReviewCompletionProcessState,
  ReviewCompletionSafeReason,
  ReviewCompletionWakeupKind,
  type CreateReviewCompletionProcessInput,
} from "../../domain/review-completion-process";

export type ReviewCompletionProcessRepositoryContractHarness = {
  readonly repository: ReviewCompletionProcessRepositoryPort;
  prepare(input: CreateReviewCompletionProcessInput): Promise<void>;
  preparePublicationAttempt(
    input: CreateReviewCompletionProcessInput,
    publicationAttemptId: string,
  ): Promise<void>;
};

export function reviewCompletionProcessRepositoryContract(
  name: string,
  createHarness: () =>
    | ReviewCompletionProcessRepositoryContractHarness
    | Promise<ReviewCompletionProcessRepositoryContractHarness>,
  enabled = true,
): void {
  const suite = enabled ? describe : describe.skip;
  suite(`${name} ReviewCompletionProcessRepository contract`, () => {
    it("creates once and restores or wakes the same execution idempotently", async () => {
      const harness = await createHarness();
      const input = processInput(contractId("create"));
      await harness.prepare(input);

      const [left, right] = await Promise.all([
        harness.repository.createOrWake(input),
        harness.repository.createOrWake(input),
      ]);
      expect([left.status, right.status].sort()).toEqual(
        [
          ReviewCompletionProcessCreateStatus.Created,
          ReviewCompletionProcessCreateStatus.Restored,
        ].sort(),
      );

      const newer = await harness.repository.createOrWake({
        ...input,
        wakeupKind: ReviewCompletionWakeupKind.PublicationChanged,
        wakeupAt: new Date(input.wakeupAt.getTime() + 1_000),
        retainUntil: new Date(input.retainUntil.getTime() + 1_000),
      });
      expect(newer).toMatchObject({
        status: ReviewCompletionProcessCreateStatus.Woken,
        process: {
          processVersion: 2n,
          lastWakeupKind: ReviewCompletionWakeupKind.PublicationChanged,
        },
      });

      const duplicate = await harness.repository.createOrWake({
        ...input,
        wakeupKind: ReviewCompletionWakeupKind.PublicationChanged,
        wakeupAt: new Date(input.wakeupAt.getTime() + 1_000),
        retainUntil: new Date(input.retainUntil.getTime() + 1_000),
      });
      expect(duplicate.status).toBe(
        ReviewCompletionProcessCreateStatus.Restored,
      );

      const conflict = await harness.repository.createOrWake({
        ...input,
        finalizedArtifactId: `${input.finalizedArtifactId}-conflict`,
      });
      expect(conflict.status).toBe(
        ReviewCompletionProcessCreateStatus.ArtifactConflict,
      );
    });

    it("issues monotonic bigint terms and rejects a stale claimant after takeover", async () => {
      const harness = await createHarness();
      const input = processInput(contractId("takeover"));
      await harness.prepare(input);
      await harness.repository.createOrWake(input);
      await harness.preparePublicationAttempt(
        input,
        `${input.executionId}-publication`,
      );

      const oldClaim = await harness.repository.claimByExecutionId({
        executionId: input.executionId,
        claimId: `${input.executionId}-old`,
        ownerIdHash: "owner-old",
        now: contractNow,
        claimUntil: new Date(contractNow.getTime() + 100),
      });
      expect(oldClaim).not.toBeNull();
      expect(typeof oldClaim!.fencingToken).toBe("bigint");

      const takeoverAt = new Date(contractNow.getTime() + 101);
      const newClaim = await harness.repository.claimByExecutionId({
        executionId: input.executionId,
        claimId: `${input.executionId}-new`,
        ownerIdHash: "owner-new",
        now: takeoverAt,
        claimUntil: new Date(takeoverAt.getTime() + 1_000),
      });
      expect(newClaim).not.toBeNull();
      expect(newClaim!.fencingToken > oldClaim!.fencingToken).toBe(true);

      await expect(
        harness.repository.applyTransition(oldClaim!, {
          state: ReviewCompletionProcessState.PartialCompleted,
          publicationAttemptId: `${input.executionId}-publication`,
          nextActionAt: null,
          lastSafeReason: ReviewCompletionSafeReason.PartialCoveragePublished,
          now: takeoverAt,
        }),
      ).resolves.toEqual({
        status: ReviewCompletionProcessTransitionStatus.StaleClaim,
      });

      await expect(
        harness.repository.applyTransition(newClaim!, {
          state: ReviewCompletionProcessState.PartialCompleted,
          publicationAttemptId: `${input.executionId}-publication`,
          nextActionAt: null,
          lastSafeReason: ReviewCompletionSafeReason.PartialCoveragePublished,
          now: new Date(takeoverAt.getTime() + 1),
        }),
      ).resolves.toMatchObject({
        status: ReviewCompletionProcessTransitionStatus.Applied,
        process: {
          state: ReviewCompletionProcessState.PartialCompleted,
          activeClaimId: null,
          claimFencingToken: null,
          nextActionAt: null,
        },
      });
    });

    it("rejects an expired claim even before another worker takes it over", async () => {
      const harness = await createHarness();
      const input = processInput(contractId("expired"));
      await harness.prepare(input);
      await harness.repository.createOrWake(input);
      const claim = await harness.repository.claimByExecutionId({
        executionId: input.executionId,
        claimId: `${input.executionId}-claim`,
        ownerIdHash: "owner-expired",
        now: contractNow,
        claimUntil: new Date(contractNow.getTime() + 100),
      });
      expect(claim).not.toBeNull();

      await expect(
        harness.repository.applyTransition(claim!, {
          state: ReviewCompletionProcessState.AwaitingPublication,
          nextActionAt: new Date(contractNow.getTime() + 2_000),
          lastSafeReason: ReviewCompletionSafeReason.ExecutionFactsUnavailable,
          now: new Date(contractNow.getTime() + 100),
        }),
      ).resolves.toEqual({
        status: ReviewCompletionProcessTransitionStatus.StaleClaim,
      });
    });

    it("rejects a forged fencing term even when every other claim field matches", async () => {
      const harness = await createHarness();
      const input = processInput(contractId("forged-term"));
      await harness.prepare(input);
      await harness.repository.createOrWake(input);
      await harness.preparePublicationAttempt(
        input,
        `${input.executionId}-publication`,
      );
      const claim = await harness.repository.claimByExecutionId({
        executionId: input.executionId,
        claimId: `${input.executionId}-claim`,
        ownerIdHash: "owner-fencing",
        now: contractNow,
        claimUntil: new Date(contractNow.getTime() + 10_000),
      });
      expect(claim).not.toBeNull();

      await expect(
        harness.repository.applyTransition(
          { ...claim!, fencingToken: claim!.fencingToken + 1n },
          {
            state: ReviewCompletionProcessState.PartialCompleted,
            publicationAttemptId: `${input.executionId}-publication`,
            nextActionAt: null,
            lastSafeReason: ReviewCompletionSafeReason.PartialCoveragePublished,
            now: new Date(contractNow.getTime() + 1),
          },
        ),
      ).resolves.toEqual({
        status: ReviewCompletionProcessTransitionStatus.StaleClaim,
      });

      await expect(
        harness.repository.applyTransition(claim!, {
          state: ReviewCompletionProcessState.PartialCompleted,
          publicationAttemptId: `${input.executionId}-publication`,
          nextActionAt: null,
          lastSafeReason: ReviewCompletionSafeReason.PartialCoveragePublished,
          now: new Date(contractNow.getTime() + 1),
        }),
      ).resolves.toMatchObject({
        status: ReviewCompletionProcessTransitionStatus.Applied,
      });
    });

    it("claims due rows in stable keyset order across sequential batches", async () => {
      const harness = await createHarness();
      const dueAt = new Date(contractNow.getTime() - 5_000);
      const inputs = [
        processInput(contractId("due-b"), dueAt),
        processInput(contractId("due-a"), dueAt),
        processInput(contractId("due-0-later"), new Date(dueAt.getTime() + 1_000)),
      ] as const;
      for (const input of inputs) {
        await harness.prepare(input);
        await harness.repository.createOrWake(input);
      }

      const claimInput = {
        now: contractNow,
        limit: 2,
        ownerIdHash: "due-owner-serial",
        claimIdForExecution: (executionId: string) => `${executionId}-serial`,
        claimUntil: new Date(contractNow.getTime() + 10_000),
      };
      const first = await harness.repository.claimDue(claimInput);
      expect(first.map((claim) => claim.executionId)).toEqual([
        inputs[1].executionId,
        inputs[0].executionId,
      ]);
      const second = await harness.repository.claimDue(claimInput);
      expect(second.map((claim) => claim.executionId)).toEqual([
        inputs[2].executionId,
      ]);
      await expect(harness.repository.claimDue(claimInput)).resolves.toEqual([]);
    });

    it("claims every due row once across concurrent workers", async () => {
      const harness = await createHarness();
      const dueAt = new Date(contractNow.getTime() - 5_000);
      const inputs = [
        processInput(contractId("due-b"), dueAt),
        processInput(contractId("due-a"), dueAt),
        processInput(contractId("due-0-later"), new Date(dueAt.getTime() + 1_000)),
      ] as const;
      for (const input of inputs) {
        await harness.prepare(input);
        await harness.repository.createOrWake(input);
      }

      const claimUntil = new Date(contractNow.getTime() + 10_000);
      const [left, right] = await Promise.all([
        harness.repository.claimDue({
          now: contractNow,
          limit: 2,
          ownerIdHash: "due-owner-left",
          claimIdForExecution: (executionId) => `${executionId}-left`,
          claimUntil,
        }),
        harness.repository.claimDue({
          now: contractNow,
          limit: 2,
          ownerIdHash: "due-owner-right",
          claimIdForExecution: (executionId) => `${executionId}-right`,
          claimUntil,
        }),
      ]);
      const claimed = [...left, ...right];
      expect(claimed).toHaveLength(3);
      expect(new Set(claimed.map((claim) => claim.executionId)).size).toBe(3);

      // SKIP LOCKED may split the earliest rows across transactions.
      // Ordering is per returned batch, using the original due-row keyset.
      const expectedIds = [
        inputs[1].executionId,
        inputs[0].executionId,
        inputs[2].executionId,
      ];
      expect(claimed.map((claim) => claim.executionId).sort()).toEqual(
        [...expectedIds].sort(),
      );
      for (const [batch, owner, suffix] of [
        [left, "due-owner-left", "left"],
        [right, "due-owner-right", "right"],
      ] as const) {
        expect(batch.length).toBeLessThanOrEqual(2);
        const ids = batch.map((claim) => claim.executionId);
        expect(ids).toEqual(expectedIds.filter((id) => ids.includes(id)));
        for (const claim of batch) {
          expect(claim.ownerIdHash).toBe(owner);
          expect(claim.claimId).toBe(`${claim.executionId}-${suffix}`);
          await expect(
            harness.repository.findByExecutionId(claim.executionId),
          ).resolves.toMatchObject({
            activeClaimId: claim.claimId,
            claimOwnerHash: claim.ownerIdHash,
            claimFencingToken: claim.fencingToken,
            processVersion: claim.processVersion,
            claimUntil: claim.claimUntil,
          });
        }
      }
      await expect(
        harness.repository.claimDue({
          now: contractNow,
          limit: 2,
          ownerIdHash: "due-owner-after",
          claimIdForExecution: (executionId) => `${executionId}-after`,
          claimUntil,
        }),
      ).resolves.toEqual([]);
    });

    it.each([
      [
        ReviewCompletionProcessState.PublicationNotApplied,
        ReviewCompletionSafeReason.PublicationFailedNoEffect,
      ],
      [
        ReviewCompletionProcessState.PublicationStaleCompensated,
        ReviewCompletionSafeReason.PublicationStaleCompensated,
      ],
      [
        ReviewCompletionProcessState.PublicationStaleVisible,
        ReviewCompletionSafeReason.PublicationStaleVisible,
      ],
    ])("round-trips terminal state %s", async (state, reason) => {
      const harness = await createHarness();
      const input = processInput(contractId(state));
      await harness.prepare(input);
      await harness.repository.createOrWake(input);
      const claim = await harness.repository.claimByExecutionId({
        executionId: input.executionId,
        claimId: `${input.executionId}-claim`,
        ownerIdHash: "owner-terminal",
        now: contractNow,
        claimUntil: new Date(contractNow.getTime() + 10_000),
      });

      await expect(
        harness.repository.applyTransition(claim!, {
          state,
          nextActionAt: null,
          lastSafeReason: reason,
          now: new Date(contractNow.getTime() + 1),
        }),
      ).resolves.toMatchObject({
        status: ReviewCompletionProcessTransitionStatus.Applied,
        process: { state, lastSafeReason: reason },
      });
      await expect(
        harness.repository.findByExecutionId(input.executionId),
      ).resolves.toMatchObject({ state, lastSafeReason: reason });
    });
  });
}

const contractNow = new Date("2026-07-22T12:00:00.000Z");
let contractOrdinal = 0;

function contractId(label: string): string {
  contractOrdinal += 1;
  return `process-contract-${label}-${contractOrdinal}`;
}

function processInput(
  executionId: string,
  wakeupAt = contractNow,
): CreateReviewCompletionProcessInput {
  return {
    executionId,
    finalizedArtifactId: `artifact-${executionId}`,
    wakeupKind: ReviewCompletionWakeupKind.ExecutionFinalized,
    wakeupAt: new Date(wakeupAt),
    retainUntil: new Date(contractNow.getTime() + 30 * 24 * 60 * 60 * 1_000),
  };
}
