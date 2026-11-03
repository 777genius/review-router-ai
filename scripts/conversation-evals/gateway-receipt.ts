import { createHash } from "node:crypto";
import { gatewayOneTurnCandidateMechanism } from "./configuration.js";
import type { Witness } from "./fixture.js";

/** Missing cleanup acknowledgment is debt, even after a completed model request. */
export function gatewayCandidateCleanupSettled(
  witness: Pick<
    Witness,
    "previewCalls" | "gatewayPreviewReceipt" | "gatewayParentCleanupPending"
  > &
    Partial<Pick<Witness, "modelCalls" | "gatewayParentReceipt">>,
): boolean {
  if (witness.gatewayParentReceipt !== undefined) {
    const parent = witness.gatewayParentReceipt;
    return (
      witness.gatewayParentCleanupPending !== true &&
      (witness.modelCalls === 0
        ? parent === null
        : !!parent &&
          (parent.requestEffect === "completed"
            ? parent.gatewayCleanup === "closed"
            : ["not_dispatched", "rejected_before_dispatch"].includes(
                parent.requestEffect ?? "",
              ) &&
              ["closed", "not_needed"].includes(parent.gatewayCleanup ?? "")))
    );
  }
  return (
    witness.gatewayParentCleanupPending !== true &&
    (witness.previewCalls === 0 ||
      witness.gatewayPreviewReceipt?.gatewayCleanup === "closed")
  );
}

/** A new mechanism needs its own actual durable SDK receipt, not a native proof. */
export function requireGatewayCandidateReceipt(
  witness: Witness,
  candidateRunId: string,
  mechanism?: string,
): void {
  if (mechanism === gatewayOneTurnCandidateMechanism) {
    if (!gatewayCandidateCleanupSettled(witness))
      throw new Error("eval_gateway_candidate_cleanup_unsettled");
    if (witness.previewCalls !== 0 || witness.gatewayPreviewReceipt != null)
      throw new Error("eval_one_turn_child_receipt_forbidden");
    if (witness.modelCalls === 0) {
      if (witness.gatewayParentReceipt !== null)
        throw new Error("eval_gateway_candidate_receipt_missing");
      return;
    }
    const receipt = witness.gatewayParentReceipt;
    if (
      witness.modelCalls !== 1 ||
      !receipt ||
      receipt.processingId !== witness.processingId ||
      receipt.candidateRunId !== candidateRunId ||
      receipt.requestEffect !== "completed" ||
      receipt.gatewayCleanup !== "closed" ||
      !receipt.observedModel?.trim() ||
      !/^[a-f0-9]{64}$/.test(receipt.selectedAccountDigest)
    )
      throw new Error("eval_gateway_candidate_receipt_missing");
    return;
  }
  if (witness.gatewayParentCleanupPending === true)
    throw new Error("eval_gateway_candidate_cleanup_unsettled");
  if (witness.previewCalls === 0) return;
  const receipt = witness.gatewayPreviewReceipt;
  const expectedId = `rr-memory-${createHash("sha256").update(witness.processingId).digest("hex")}`;
  if (
    !receipt ||
    receipt.processingId !== expectedId ||
    receipt.candidateRunId !== candidateRunId ||
    receipt.requestEffect !== "completed" ||
    !receipt.observedModel?.trim() ||
    !/^[a-f0-9]{64}$/.test(receipt.selectedAccountDigest)
  )
    throw new Error("eval_gateway_candidate_receipt_missing");
  if (!gatewayCandidateCleanupSettled(witness))
    throw new Error("eval_gateway_candidate_cleanup_unsettled");
}
