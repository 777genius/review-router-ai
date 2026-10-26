import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { ReviewActionV2RouteFailure } from "@reviewrouter/features-action-control-plane/v2";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import { ReviewActionV2ProtocolErrorCode } from "@reviewrouter/protocol-review-action-v2";
import {
  parseReviewModelDispatchSettlementV2,
  reviewModelDispatchOutputUsageIsWithinLimit,
  type ReviewModelDispatchRole,
} from "@reviewrouter/shared";

/** One eligibility boundary for fresh acceptance and reuse. Callers must pass
 * the ORIGINAL source authority. Proof never allocates or reopens a request. */
export async function assertReviewModelDispatchEvidence(
  input: Readonly<{
    prisma: Pick<PrismaClient, "reviewRunCompanionDispatchV1">;
    authorization: Pick<
      ReviewRunAuthorization,
      "authorizationId" | "runtimeSnapshotCanonicalJson"
    >;
    executionId: string;
    workSlotId: string;
    leaseId: string;
    fencingToken: bigint;
    preparedManifestKey: string;
    providerRequestEnvelopeHash: string;
    actualModel: string;
    role: ReviewModelDispatchRole;
  }>,
) {
  const budget = parseReviewRunRuntimeSnapshot(
    input.authorization.runtimeSnapshotCanonicalJson,
  )?.modelDispatchCapability;
  if (!budget) return;
  const rows = await input.prisma.reviewRunCompanionDispatchV1.findMany({
    where: {
      authorizationId: input.authorization.authorizationId,
      workSlotId: input.workSlotId,
      attemptOrdinal: 1,
    },
    orderBy: { requestOrdinal: "asc" },
    take: budget.maxRequests + 1,
  });
  if (
    !rows.length ||
    rows.length > budget.maxRequests ||
    (input.role !== "finding_discovery" && rows.length !== 1) ||
    input.actualModel !== budget.model
  )
    invalid();
  let completed = 0;
  for (const [index, row] of rows.entries()) {
    if (
      row.dispatchVersion !== 2 ||
      row.requestOrdinal !== index + 1 ||
      row.role !== input.role ||
      row.executionId !== input.executionId ||
      row.leaseId !== input.leaseId ||
      row.fencingToken !== input.fencingToken ||
      row.preparedManifestKey !== input.preparedManifestKey ||
      row.routeIdentityHash !== budget.routeIdentityHash ||
      (input.role !== "finding_discovery" &&
        row.providerRequestEnvelopeHash !==
          input.providerRequestEnvelopeHash) ||
      !row.requestBytes ||
      row.requestBytes > budget.maxRequestBytes ||
      !row.maxOutputTokens ||
      row.maxOutputTokens > budget.maxOutputTokens
    )
      invalid();
    // Positively local unpaid denials still consume allowance but cannot prove a
    // result. They do not invalidate later completed requests in the SAME slot.
    if (row.state === "not_dispatched") continue;
    if (row.state !== "completed" || !row.terminalReceiptJson) invalid();
    if (
      ["account_gateway", "hosted_pool"].includes(budget.transport) &&
      (!row.forwardedAt || row.nativeEffectState !== "completed")
    )
      invalid();
    try {
      const settlement = parseReviewModelDispatchSettlementV2({
        state: "completed",
        receipt: row.terminalReceiptJson,
      });
      if (settlement.state !== "completed") invalid();
      const receipt = settlement.receipt;
      if (
        receipt.routeIdentityHash !== budget.routeIdentityHash ||
        receipt.providerRequestEnvelopeHash !==
          row.providerRequestEnvelopeHash ||
        receipt.actualModel !== budget.model ||
        receipt.responseHash !== row.resultHash ||
        receipt.responseBytes > budget.maxResponseBytes ||
        createHash("sha256")
          .update(canonicalJson(receipt.usage))
          .digest("hex") !== row.usageHash ||
        !reviewModelDispatchOutputUsageIsWithinLimit(
          receipt.usage,
          row.maxOutputTokens,
        )
      )
        invalid();
    } catch {
      invalid();
    }
    completed++;
  }
  if (!completed) invalid();
}
function invalid(): never {
  throw new ReviewActionV2RouteFailure(
    422,
    ReviewActionV2ProtocolErrorCode.InvariantViolation,
    ["model_dispatch_completed_source_required"],
  );
}
