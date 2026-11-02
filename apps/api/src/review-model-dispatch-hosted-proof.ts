import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import {
  parseReviewRunRuntimeSnapshot,
  ReviewRunCompanionDispatchFailure,
  type ReviewRunCompanionDispatch,
  type ReviewRunModelDispatchAdmission,
} from "@reviewrouter/features-review-run-control";
import type { ReviewModelDispatchSettlementV2 } from "@reviewrouter/shared";

/** Reconcile only an already-forwarded original request. This never resolves
 * fresh authority, opens a grant, changes accounts or repeats provider work. */
export function createHostedModelDispatchProofReconciler(input: {
  prisma: Pick<
    PrismaClient,
    "reviewRunAuthorization" | "hostedCodexRelayRequest"
  >;
  admission: Pick<ReviewRunModelDispatchAdmission, "settle">;
}) {
  return async (
    dispatch: ReviewRunCompanionDispatch,
    settlement?: ReviewModelDispatchSettlementV2,
  ): Promise<"completed" | "not_dispatched" | undefined> => {
    if (dispatch.dispatchVersion !== 2) return;
    if (dispatch.state === "completed") return "completed";
    const original = await input.prisma.reviewRunAuthorization.findUnique({
      where: { authorizationId: dispatch.authorizationId },
      select: { runtimeSnapshotCanonicalJson: true },
    });
    const snapshot = parseReviewRunRuntimeSnapshot(
      original?.runtimeSnapshotCanonicalJson,
    );
    if (snapshot?.modelDispatchCapability?.transport !== "hosted_pool") return;
    const hosted = snapshot.hosted;
    if (
      !hosted ||
      dispatch.routeIdentityHash !==
        snapshot.modelDispatchCapability.routeIdentityHash
    )
      deny();
    const request = await input.prisma.hostedCodexRelayRequest.findUnique({
      where: {
        grantId_idempotencyKeyHash: {
          grantId: hosted.grantId,
          idempotencyKeyHash: createHash("sha256")
            .update(dispatch.nativeRequestRef)
            .digest("hex"),
        },
      },
      include: { upstreamAttempts: true },
    });
    const scoped =
      !!request &&
      request.authorityKind === "v1_comment" &&
      request.grantId === hosted.grantId &&
      request.requestHash === dispatch.providerRequestEnvelopeHash &&
      request.requestBytes === dispatch.requestBytes &&
      request.upstreamAttempts.length > 0 &&
      request.upstreamAttempts.every(
        (attempt) =>
          attempt.authorityKind === "v1_comment" &&
          attempt.grantId === hosted.grantId &&
          attempt.accountId === hosted.activeAccountId &&
          attempt.requestHash === dispatch.providerRequestEnvelopeHash,
      );
    const completed =
      scoped &&
      request.status === "succeeded" &&
      request.completedAt !== null &&
      request.responseHash !== null &&
      request.responseBytes !== null &&
      request.responseBytes <=
        snapshot.modelDispatchCapability.maxResponseBytes &&
      request.upstreamAttempts.filter(
        (attempt) => attempt.state === "succeeded",
      ).length === 1 &&
      request.upstreamAttempts.every((attempt) =>
        ["succeeded", "failed_no_effect", "failed_classified"].includes(
          attempt.state,
        ),
      );
    if (
      settlement?.state === "completed" &&
      (!completed ||
        settlement.receipt.responseHash !== request!.responseHash ||
        settlement.receipt.responseBytes !== request!.responseBytes)
    )
      deny();
    if (completed) {
      await input.admission.settle(
        dispatch.authorizationId,
        dispatch.dispatchId,
        "completed",
      );
      return "completed";
    }
    const notDispatched =
      scoped &&
      request.status === "failed" &&
      request.errorCode === "upstream_dispatch_not_started" &&
      request.upstreamAttempts.every(
        (attempt) => attempt.state === "failed_no_effect",
      );
    if (notDispatched) {
      await input.admission.settle(
        dispatch.authorizationId,
        dispatch.dispatchId,
        "not_dispatched",
      );
      return "not_dispatched";
    }
    // Missing/pruned/uncertain native facts never become completion evidence.
  };
}

function deny(): never {
  throw new ReviewRunCompanionDispatchFailure(
    "model_dispatch_native_proof_required",
  );
}
