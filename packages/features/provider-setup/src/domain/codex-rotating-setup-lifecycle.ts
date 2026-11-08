import {
  isCodexRotatingSetupLiveClaimStatus,
  type CodexRotatingSetupClaimStatus,
  type CodexRotatingSetupReplayableClaimStatus,
  type CodexRotatingSetupAttemptStatus,
} from "./codex-rotating-setup-payload-claim";

export const maximumSetupDispatchAttempts = 3;

export function admitSetupClaimReplay(
  input: Readonly<{
    status: CodexRotatingSetupClaimStatus;
    prepareReplayExpiresAt: Date;
    now: Date;
  }>,
): CodexRotatingSetupReplayableClaimStatus {
  if (!isCodexRotatingSetupLiveClaimStatus(input.status)) {
    throw new Error("codex_rotating_setup_recovery_required");
  }
  if (input.status === "active") {
    throw new Error("codex_rotating_setup_confirmation_stale_epoch");
  }
  if (
    input.status === "prepared" &&
    input.prepareReplayExpiresAt <= input.now
  ) {
    throw new Error("codex_rotating_setup_payload_claim_expired");
  }
  return input.status;
}

export function setupClaimReplayDeadline(
  now: Date,
  recoveryExpiresAt: Date,
): Date {
  return new Date(
    Math.min(recoveryExpiresAt.getTime(), now.getTime() + 15 * 60 * 1000),
  );
}

export enum SetupDispatchOutcomeDecision {
  ReturnRetired = "return_retired",
  RetireExpired = "retire_expired",
  Expire = "expire",
  ReturnConfirmed = "return_confirmed",
  RetireUnknown = "retire_unknown",
  Confirm = "confirm",
}

/** Decides from locked facts; the adapter still owns authority proof and CAS. */
export function planSetupDispatchOutcome(
  input: Readonly<{
    attempt: Readonly<{
      attemptId: string;
      status: CodexRotatingSetupAttemptStatus;
      dispatchExpiresAt: Date;
    }>;
    confirmedAttemptId: string | null;
    outcome: "definite_success" | "unknown";
    now: Date;
  }>,
): SetupDispatchOutcomeDecision {
  const { attempt, outcome, now, confirmedAttemptId } = input;
  if (attempt.status === "retired_ambiguous") {
    if (outcome === "unknown")
      return SetupDispatchOutcomeDecision.ReturnRetired;
    throw new Error("codex_rotating_setup_namespace_retired");
  }
  // Expiry deliberately precedes a confirmed replay. The tombstone, when needed,
  // must commit before the caller exposes the expired result outside its transaction.
  if (attempt.dispatchExpiresAt <= now) {
    return attempt.status === "dispatch_authorized"
      ? SetupDispatchOutcomeDecision.RetireExpired
      : SetupDispatchOutcomeDecision.Expire;
  }
  if (attempt.status === "confirmed") {
    if (outcome === "definite_success")
      return SetupDispatchOutcomeDecision.ReturnConfirmed;
    throw new Error("codex_rotating_setup_attempt_already_confirmed");
  }
  if (outcome === "unknown") return SetupDispatchOutcomeDecision.RetireUnknown;
  if (confirmedAttemptId && confirmedAttemptId !== attempt.attemptId) {
    throw new Error("codex_rotating_setup_confirmation_conflict");
  }
  return SetupDispatchOutcomeDecision.Confirm;
}

export type SetupAttemptNamespaceFacts = Readonly<{
  status: CodexRotatingSetupAttemptStatus;
  namespaceStatus: string;
  attemptRetiredAt: Date | null;
  namespacePermanentlyRetired: boolean;
  namespaceRetiredAt: Date | null;
}>;

export function classifyAttemptNamespaceState(
  row: SetupAttemptNamespaceFacts,
):
  | "dispatch_authorized"
  | "retired_predispatch"
  | "retired_ambiguous"
  | "confirmed" {
  if (
    row.status === "dispatch_authorized" &&
    row.namespaceStatus === "dispatch_authorized" &&
    !row.attemptRetiredAt &&
    !row.namespacePermanentlyRetired &&
    !row.namespaceRetiredAt
  ) {
    return "dispatch_authorized";
  }
  if (
    row.status === "retired_ambiguous" &&
    row.attemptRetiredAt &&
    row.namespacePermanentlyRetired &&
    row.namespaceRetiredAt &&
    (row.namespaceStatus === "retired_predispatch" ||
      row.namespaceStatus === "retired_ambiguous")
  ) {
    return row.namespaceStatus;
  }
  if (
    row.status === "confirmed" &&
    (row.namespaceStatus === "confirmed_candidate" ||
      row.namespaceStatus === "active") &&
    !row.attemptRetiredAt &&
    !row.namespacePermanentlyRetired &&
    !row.namespaceRetiredAt
  ) {
    return "confirmed";
  }
  throw new Error("codex_rotating_setup_retirement_conflict");
}

export function assertSetupDispatchAllocationOrdinal(
  ordinal: number,
  requiredOrdinal: number | null,
): void {
  if (ordinal > maximumSetupDispatchAttempts) {
    throw new Error("codex_rotating_setup_attempt_limit");
  }
  if (requiredOrdinal !== null && requiredOrdinal !== ordinal) {
    throw new Error("codex_rotating_setup_retirement_conflict");
  }
}

/** Exact canonical facts already parsed/verified by the workflow source adapter. */
type SetupWorkflowAttestationFacts = Readonly<{
  repositoryId: string;
  workflowPath: string;
  workflowSourceCommitSha: string;
  workflowSourceBlobSha: string;
  workflowSourceSha256: string;
  workflowSemanticSha256: string;
  workflowSchemaVersion: number;
  sourceTrust: string;
  secretNamespace: Readonly<{
    namespaceId: string;
    epoch: bigint;
    name: string;
    scope: Readonly<{ repositoryId: string; providerInstanceId: string }>;
  }>;
}>;

export function sameExactWorkflowAttestation(
  left: SetupWorkflowAttestationFacts,
  right: SetupWorkflowAttestationFacts,
): boolean {
  return (
    left.repositoryId === right.repositoryId &&
    left.workflowPath === right.workflowPath &&
    left.workflowSourceCommitSha === right.workflowSourceCommitSha &&
    left.workflowSourceBlobSha === right.workflowSourceBlobSha &&
    left.workflowSourceSha256 === right.workflowSourceSha256 &&
    left.workflowSemanticSha256 === right.workflowSemanticSha256 &&
    left.workflowSchemaVersion === right.workflowSchemaVersion &&
    left.sourceTrust === right.sourceTrust &&
    left.secretNamespace.namespaceId === right.secretNamespace.namespaceId &&
    left.secretNamespace.epoch === right.secretNamespace.epoch &&
    left.secretNamespace.name === right.secretNamespace.name &&
    left.secretNamespace.scope.repositoryId ===
      right.secretNamespace.scope.repositoryId &&
    left.secretNamespace.scope.providerInstanceId ===
      right.secretNamespace.scope.providerInstanceId
  );
}
