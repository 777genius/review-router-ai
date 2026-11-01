import { createHash } from "node:crypto";
import type { Witness } from "./fixture.js";

/** Missing cleanup acknowledgment is debt, even after a completed model request. */
export function gatewayCandidateCleanupSettled(
  witness: Pick<Witness, "previewCalls" | "gatewayPreviewReceipt">,
): boolean {
  return (
    witness.previewCalls === 0 ||
    witness.gatewayPreviewReceipt?.gatewayCleanup === "closed"
  );
}

/** A new mechanism needs its own actual durable SDK receipt, not a native proof. */
export function requireGatewayCandidateReceipt(
  witness: Witness,
  candidateRunId: string,
): void {
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
