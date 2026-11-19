import { canonicalJson } from "../../domain/canonicalization";
import {
  ExpiredActiveTurnReconciliationDisposition,
  reconcileExpiredActiveTurn,
  type ReviewInvestigation,
} from "../../domain/review-investigation";
import type { InvestigationClockPort } from "../ports/clock-port";
import type { InvestigationDigestPort } from "../ports/digest-port";
import {
  InvestigationExecutionAuthorityVerdict,
  type InvestigationExecutionAuthorityPort,
} from "../ports/execution-authority-port";
import {
  InvestigationStoreCommitGuardKind,
  InvestigationStoreTransitionKind,
  type InvestigationStorePort,
} from "../ports/investigation-store-port";
import { ExpiredActiveTurnRecoveryBackoff } from "../expired-active-turn-recovery-backoff";
import { issueReplayEvidenceCheckpoint } from "../replay-evidence-checkpoint-issuer";
import {
  commitOrThrow,
  requireValidDossierDigest,
  withCurrentDossierDigest,
} from "./investigation-use-case-support";

export enum InvestigationExpiredTurnRecoveryFailureCause {
  DossierDigestInvalid = "dossier_digest_invalid",
  InvestigationMissing = "investigation_missing",
  IdempotencyConflict = "idempotency_conflict",
  Unknown = "unknown",
}

export type ExpiredActiveTurnSweepResult = Readonly<{
  reconciledCount: number;
  failedCount: number;
  deferredCount: number;
  failureCause: InvestigationExpiredTurnRecoveryFailureCause | null;
}>;

export class ReconcileExpiredActiveTurn {
  private readonly backoff = new ExpiredActiveTurnRecoveryBackoff();

  constructor(
    private readonly store: InvestigationStorePort,
    private readonly authority: InvestigationExecutionAuthorityPort,
    private readonly digest: InvestigationDigestPort,
    private readonly clock: InvestigationClockPort,
    private readonly replayCheckpointTtlMs = 3_600_000,
  ) {}

  async execute(investigationId: string): Promise<ReviewInvestigation> {
    const current = await this.store.findById(investigationId);
    if (current === null) throw new Error("investigation_missing");
    await requireValidDossierDigest(this.digest, current);
    const turn = current.activeTurn;
    if (turn === null || new Date(turn.expiresAt) > this.clock.now()) {
      return current;
    }
    const verdict = await this.authority.check(current);
    const reconciled = reconcileExpiredActiveTurn({
      investigation: current,
      reconciledAt: this.clock.now().toISOString(),
      superseded:
        verdict === InvestigationExecutionAuthorityVerdict.Superseded ||
        verdict === InvestigationExecutionAuthorityVerdict.Missing ||
        verdict === InvestigationExecutionAuthorityVerdict.Unauthorized,
    });
    if (
      reconciled.disposition ===
      ExpiredActiveTurnReconciliationDisposition.Unchanged
    ) {
      return current;
    }
    let next = reconciled.investigation;
    if (
      reconciled.disposition ===
      ExpiredActiveTurnReconciliationDisposition.Superseded
    ) {
      next = {
        ...next,
        replayEvidenceCheckpoint: await issueReplayEvidenceCheckpoint({
          source: current,
          sourceState: next.state,
          sourceConclusion: next.conclusion,
          sourceVersion: next.version,
          issuedAt: this.clock.now(),
          ttlMs: this.replayCheckpointTtlMs,
          digest: this.digest,
        }),
      };
    }
    next = await withCurrentDossierDigest(this.digest, next);
    const commandHash = await this.digest.digestUtf8(
      canonicalJson({
        operation: "reconcile_expired_active_turn",
        investigationId,
        expectedVersion: current.version,
        turnId: turn.turnId,
        expiresAt: turn.expiresAt,
        authority: verdict,
      }),
    );
    return commitOrThrow({
      store: this.store,
      investigation: next,
      expectedVersion: current.version,
      commandId: `reconcile-expired-turn:${investigationId}:${turn.turnId}`,
      commandHash,
      transition: {
        kind: InvestigationStoreTransitionKind.ActiveTurnExpired,
        turnId: turn.turnId,
      },
      guard: {
        kind: InvestigationStoreCommitGuardKind.ExpiredActiveTurn,
        expectedVerdict: verdict,
        turnId: turn.turnId,
        expiresAt: turn.expiresAt,
      },
    });
  }

  /**
   * Recovers each expired active turn independently. A row that cannot be
   * recovered is counted with an allowlisted cause and put on a bounded
   * backoff; it never stops the rest of the batch.
   */
  async sweep(input: {
    readonly expiresAtOrBefore: string;
    readonly limit: number;
  }): Promise<ExpiredActiveTurnSweepResult> {
    const nowMs = this.clock.now().getTime();
    const deferred = this.backoff.deferredInvestigationIds(nowMs);
    const ids = await this.store.findExpiredActiveTurnIds({
      ...input,
      excludeInvestigationIds: deferred,
    });
    let reconciledCount = 0;
    let failedCount = 0;
    let failureCause: InvestigationExpiredTurnRecoveryFailureCause | null =
      null;
    for (const investigationId of ids) {
      try {
        const before = await this.store.findById(investigationId);
        const after = await this.execute(investigationId);
        if (before !== null && after.version !== before.version) {
          reconciledCount += 1;
        }
        this.backoff.clear(investigationId);
      } catch (error: unknown) {
        if (isConcurrentRecoveryRace(error)) continue;
        failedCount += 1;
        failureCause ??= expiredTurnRecoveryFailureCause(error);
        this.backoff.recordFailure(investigationId, nowMs);
      }
    }
    return Object.freeze({
      reconciledCount,
      failedCount,
      deferredCount: deferred.length,
      failureCause,
    });
  }
}

const concurrentRecoveryRaceMessages: ReadonlySet<string> = new Set([
  "investigation_concurrency_conflict",
  "investigation_lease_fencing_stale",
]);

function isConcurrentRecoveryRace(error: unknown): boolean {
  return (
    error instanceof Error && concurrentRecoveryRaceMessages.has(error.message)
  );
}

const recoveryFailureCauseByMessage: ReadonlyMap<
  string,
  InvestigationExpiredTurnRecoveryFailureCause
> = new Map([
  [
    "investigation_dossier_digest_invalid",
    InvestigationExpiredTurnRecoveryFailureCause.DossierDigestInvalid,
  ],
  [
    "investigation_missing",
    InvestigationExpiredTurnRecoveryFailureCause.InvestigationMissing,
  ],
  [
    "investigation_idempotency_conflict",
    InvestigationExpiredTurnRecoveryFailureCause.IdempotencyConflict,
  ],
]);

// Only allowlisted codes leave this module: a raw error message can carry
// persisted values, so anything unrecognised is reported as `unknown`.
function expiredTurnRecoveryFailureCause(
  error: unknown,
): InvestigationExpiredTurnRecoveryFailureCause {
  return (
    (error instanceof Error
      ? recoveryFailureCauseByMessage.get(error.message)
      : undefined) ?? InvestigationExpiredTurnRecoveryFailureCause.Unknown
  );
}
