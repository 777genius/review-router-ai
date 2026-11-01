import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  ReviewRunAuthorizationTokenResolutionStatus,
  ReviewRunCompanionDispatchFailure,
  type ManageReviewRunAuthorizations,
  type ReviewRunCompanionDispatch,
  type ReviewRunModelDispatchAdmission,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";
import {
  parseReviewModelDispatchClaimV2,
  parseReviewModelDispatchSettlementV2,
  reviewModelDispatchContract,
  type ReviewModelDispatchReadbackV2,
  type ReviewModelDispatchSettlementV2,
} from "@reviewrouter/shared";

export type ReviewModelDispatchApi = Readonly<{
  authorizations: Pick<
    ManageReviewRunAuthorizations,
    "resolveReviewRunAuthorizationToken"
  >;
  admission: ReviewRunModelDispatchAdmission;
  checkAuthority(authorization: ReviewRunAuthorization): Promise<boolean>;
  reconcileNativeProof?(
    dispatch: ReviewRunCompanionDispatch,
    settlement?: ReviewModelDispatchSettlementV2,
  ): Promise<"completed" | "not_dispatched" | undefined>;
}>;

class DispatchRouteFailure extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
  ) {
    super(code);
  }
}

type ClaimFailureContext = {
  phase: "authentication" | "authority" | "body" | "admission" | "receipt";
  authorizationId?: string;
};

const claimFailureCodes = new Set([
  "model_dispatch_claim_requires_run_authority",
  "model_dispatch_authorization_required",
  "model_dispatch_authorization_denied",
  "model_dispatch_headers_invalid",
  "model_dispatch_authority_changed",
  "model_dispatch_request_invalid",
  "model_dispatch_receipt_unavailable",
  "model_dispatch_unavailable",
  "model_dispatch_version_required",
  "model_dispatch_native_forward_denied",
  "model_dispatch_profile_mismatch",
  "model_dispatch_already_forwarded",
  "model_dispatch_reservation_required",
  "model_dispatch_budget_exhausted",
  "model_dispatch_effect_unresolved",
  "model_dispatch_ordinal_invalid",
  "model_dispatch_claim_invalid",
  "companion_lease_capability_invalid",
  "companion_lease_capability_mismatch",
  "companion_authorization_denied",
  "companion_execution_not_current",
  "companion_slot_purpose_invalid",
  "companion_lease_mismatch",
  "companion_manifest_invalid",
  "companion_envelope_mismatch",
  "companion_lease_not_active",
  "companion_dispatch_conflict",
  "companion_slot_already_claimed",
  "companion_dispatch_limit",
  "companion_dispatch_corrupt",
  "phase_not_ready",
]);

/** Metadata only. The receipt header is deliberately never logged, included in
 * URLs, or accepted by the claim endpoint. It does not authenticate evidence or
 * publication and cannot renew the original receipt's retention window. */
export async function registerReviewModelDispatchRoutes(
  app: FastifyInstance,
  api: ReviewModelDispatchApi,
) {
  const claimFailures = new WeakMap<FastifyRequest, ClaimFailureContext>();
  await app.register(async (scope) => {
    scope.setErrorHandler((error, request, reply) => {
      const failure =
        error instanceof DispatchRouteFailure
          ? { statusCode: error.statusCode, code: error.code }
          : error instanceof ReviewRunCompanionDispatchFailure
            ? { statusCode: 409, code: error.code }
            : error instanceof Error &&
                error.message === "review_model_dispatch_contract_invalid"
              ? { statusCode: 400, code: "model_dispatch_request_invalid" }
              : { statusCode: 500, code: "model_dispatch_unavailable" };
      if (request.routeOptions.url === reviewModelDispatchContract.claimPath) {
        const context = claimFailures.get(request);
        try {
          request.log.warn(
            {
              event: "review_model_dispatch_claim_rejected",
              phase: context?.phase ?? "input",
              code: claimFailureCodes.has(failure.code)
                ? failure.code
                : "model_dispatch_unavailable",
              httpStatus: [400, 401, 409, 500].includes(failure.statusCode)
                ? failure.statusCode
                : 500,
              ...(context?.authorizationId
                ? { authorizationId: context.authorizationId }
                : {}),
            },
            "Review model dispatch claim rejected",
          );
        } catch {
          // Diagnostics must not change claim authority or its response.
        }
      }
      return reply.code(failure.statusCode).send({ code: failure.code });
    });
    scope.post(
      reviewModelDispatchContract.claimPath,
      { bodyLimit: 24 * 1024 },
      async (request, reply) => {
        const context: ClaimFailureContext = { phase: "authentication" };
        claimFailures.set(request, context);
        if (
          singleHeader(request, reviewModelDispatchContract.receiptHeader) !==
          undefined
        )
          throw new DispatchRouteFailure(
            "model_dispatch_claim_requires_run_authority",
            401,
          );
        const authorization = await resolve(request, api);
        context.authorizationId = authorization.authorizationId;
        context.phase = "authority";
        if (!(await api.checkAuthority(authorization)))
          throw new DispatchRouteFailure(
            "model_dispatch_authority_changed",
            409,
          );
        context.phase = "body";
        const claim = parseReviewModelDispatchClaimV2(request.body);
        context.phase = "admission";
        const result = await api.admission.claim(
          authorization,
          claim,
          claim.providerRequestEnvelopeHash,
        );
        context.phase = "receipt";
        if (result.status === "claimed" && !result.receiptToken)
          throw new DispatchRouteFailure(
            "model_dispatch_receipt_unavailable",
            500,
          );
        reply.header("Cache-Control", "no-store");
        return {
          status: result.status,
          dispatch: readback(result.dispatch),
          notAfter: result.notAfter.toISOString(),
          ...(result.status === "claimed"
            ? { receiptToken: result.receiptToken }
            : {}),
        };
      },
    );
    scope.get(
      `${reviewModelDispatchContract.basePath}/:dispatchId`,
      async (request, reply) => {
        const dispatchId = parameter(request);
        const token = receipt(request);
        const row = token
          ? await api.admission.readReceipt(dispatchId, token)
          : await api.admission.read(
              (await resolve(request, api)).authorizationId,
              dispatchId,
            );
        if (!row) throw new DispatchRouteFailure("model_dispatch_missing", 404);
        await api.reconcileNativeProof?.(row);
        reply.header("Cache-Control", "no-store");
        return { dispatch: readback(row) };
      },
    );
    scope.post(
      `${reviewModelDispatchContract.basePath}/:dispatchId/settle`,
      { bodyLimit: reviewModelDispatchContract.maxReceiptBytes },
      async (request, reply) => {
        const token = receipt(request);
        if (!token)
          throw new DispatchRouteFailure(
            "model_dispatch_receipt_required",
            401,
          );
        const settlement = parseReviewModelDispatchSettlementV2(request.body);
        const dispatchId = parameter(request);
        const existing = await api.admission.readReceipt(dispatchId, token);
        if (!existing)
          throw new DispatchRouteFailure("model_dispatch_receipt_denied", 401);
        await api.reconcileNativeProof?.(existing, settlement);
        const row = await api.admission.settleReceipt(
          dispatchId,
          token,
          settlement,
        );
        reply.header("Cache-Control", "no-store");
        return { dispatch: readback(row) };
      },
    );
  });
}

async function resolve(request: FastifyRequest, api: ReviewModelDispatchApi) {
  const header = singleHeader(request, "authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token || token.length > 16_384 || /\s/.test(token))
    throw new DispatchRouteFailure(
      "model_dispatch_authorization_required",
      401,
    );
  const result = await api.authorizations.resolveReviewRunAuthorizationToken({
    token,
  });
  if (result.status !== ReviewRunAuthorizationTokenResolutionStatus.Valid)
    throw new DispatchRouteFailure("model_dispatch_authorization_denied", 401);
  return result.authorization;
}
function receipt(request: FastifyRequest) {
  const token = singleHeader(
    request,
    reviewModelDispatchContract.receiptHeader,
  );
  if (token !== undefined && !/^[a-f0-9]{64}$/.test(token))
    throw new DispatchRouteFailure("model_dispatch_receipt_denied", 401);
  return token;
}
function singleHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const raw = request.raw.rawHeaders;
  let count = 0;
  for (let i = 0; i < raw.length; i += 2)
    if (raw[i]?.toLowerCase() === name) count++;
  const value = request.headers[name];
  if (
    count > 1 ||
    Array.isArray(value) ||
    (typeof value === "string" && value.includes(","))
  )
    throw new DispatchRouteFailure("model_dispatch_headers_invalid", 400);
  return value;
}
function parameter(request: FastifyRequest) {
  const value = (request.params as { dispatchId?: unknown }).dispatchId;
  if (typeof value !== "string" || !/^rr-model-[a-f0-9]{64}$/.test(value))
    throw new DispatchRouteFailure("model_dispatch_id_invalid", 400);
  return value;
}
export function reviewModelDispatchReadback(
  row: ReviewRunCompanionDispatch,
): ReviewModelDispatchReadbackV2 {
  return readback(row);
}
function readback(
  row: ReviewRunCompanionDispatch,
): ReviewModelDispatchReadbackV2 {
  if (
    row.dispatchVersion !== 2 ||
    !row.requestOrdinal ||
    !row.routeIdentityHash ||
    !row.requestBytes ||
    !row.maxOutputTokens
  )
    throw new DispatchRouteFailure("model_dispatch_version_required", 409);
  return {
    dispatchVersion: 2,
    authorizationId: row.authorizationId,
    dispatchId: row.dispatchId,
    executionId: row.executionId,
    workSlotId: row.workSlotId,
    attemptOrdinal: row.attemptOrdinal,
    requestOrdinal: row.requestOrdinal,
    leaseId: row.leaseId,
    fencingToken: row.fencingToken.toString(10),
    preparedManifestKey: row.preparedManifestKey,
    routeIdentityHash: row.routeIdentityHash,
    providerRequestEnvelopeHash: row.providerRequestEnvelopeHash,
    nativeRequestRef: row.nativeRequestRef,
    role: row.role,
    state: row.state,
    requestBytes: row.requestBytes,
    maxOutputTokens: row.maxOutputTokens,
    terminalReceipt: row.terminalReceipt ?? null,
  };
}
