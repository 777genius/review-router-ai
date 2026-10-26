import { createHash, timingSafeEqual } from "node:crypto";
import { Readable } from "node:stream";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { RegisterHostedCodexRelayRoutesDependencies } from "@reviewrouter/features-hosted-account-pool";
import { parseReviewConfigurationStrict } from "@reviewrouter/features-review-config";
import {
  canonicalJson,
  parseReviewRunRuntimeSnapshot,
  ReviewRunAuthorizationTokenResolutionStatus,
  type ReviewRunCompanionDispatchAdmission,
} from "@reviewrouter/features-review-run-control";
import { reviewModelDispatchContract } from "@reviewrouter/shared";
import type { ReviewModelDispatchApi } from "./review-model-dispatch";
import { readReviewRunCompanionDispatchContext } from "./review-run-gateway-relay";
import { confirmOriginalHostedReviewBinding } from "./review-run-hosted-binding";

export const hostedModelRoutePath =
  "/api/action/v2/model-route/hosted-responses";
export const hostedModelGrantHeader = "x-reviewrouter-hosted-grant";

class HostedModelRouteFailure extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly effect: "not_dispatched" | "effect_unknown" = "not_dispatched",
  ) {
    super(code);
  }
}

/** The original Hosted relay keeps custody, request accounting and effect
 * recovery. This adapter only binds its existing request to a fresh V2 claim. */
export function createReviewRunHostedModelRoute(input: {
  prisma: Pick<
    PrismaClient,
    | "hostedCodexInvocationGrant"
    | "hostedCodexRelayRequest"
    | "hostedCodexRuntimeGate"
    | "reviewRequestedIntent"
  >;
  api: ReviewModelDispatchApi;
  native: Pick<
    RegisterHostedCodexRelayRoutesDependencies,
    "authorization" | "relay"
  >;
}) {
  return {
    async responses(request: {
      token: string;
      opaqueGrant: string;
      context: Parameters<ReviewRunCompanionDispatchAdmission["claim"]>[1];
      body: Buffer;
      controller: AbortController;
    }) {
      const resolved =
        await input.api.authorizations.resolveReviewRunAuthorizationToken({
          token: request.token,
        });
      if (resolved.status !== ReviewRunAuthorizationTokenResolutionStatus.Valid)
        throw new HostedModelRouteFailure("authorization_denied", 401);
      const authorization = resolved.authorization;
      const snapshot = parseReviewRunRuntimeSnapshot(
        authorization.runtimeSnapshotCanonicalJson,
      );
      const cap = snapshot?.modelDispatchCapability;
      const hosted = snapshot?.hosted;
      if (
        !snapshot ||
        !cap ||
        !hosted ||
        cap.transport !== "hosted_pool" ||
        cap.wireProtocol !== "codex-responses" ||
        request.context.dispatchVersion !== 2 ||
        request.context.routeIdentityHash !== cap.routeIdentityHash ||
        !input.api.reconcileNativeProof
      )
        throw new HostedModelRouteFailure(
          "hosted_model_route_unavailable",
          403,
        );
      const configuration = parseReviewConfigurationStrict(
        JSON.parse(snapshot.configurationCanonicalJson),
      );
      if (
        !(await input.api.checkAuthority(authorization)) ||
        !(await confirmOriginalHostedReviewBinding({
          reader: input.prisma,
          identity: authorization,
          configuration,
          configurationVersion: snapshot.configurationVersion,
          original: hosted,
          now: new Date(),
        }))
      )
        throw new HostedModelRouteFailure(
          "hosted_model_authority_changed",
          409,
        );
      const grant = await input.prisma.hostedCodexInvocationGrant.findUnique({
        where: { id: hosted.grantId },
        select: { capabilityTokenHash: true },
      });
      if (
        !grant ||
        !/^[a-f0-9]{64}$/.test(grant.capabilityTokenHash) ||
        !timingSafeEqual(
          Buffer.from(grant.capabilityTokenHash, "hex"),
          Buffer.from(hash(request.opaqueGrant), "hex"),
        )
      )
        throw new HostedModelRouteFailure("hosted_model_grant_denied", 401);
      const reserved = await input.api.admission.read(
        authorization.authorizationId,
        request.context.dispatchId,
      );
      if (
        !reserved ||
        reserved.dispatchVersion !== 2 ||
        !reserved.maxOutputTokens
      )
        throw new HostedModelRouteFailure(
          "model_dispatch_reservation_required",
          409,
        );
      const body = validateNativeRequest(
        request.body,
        cap.model,
        cap.maxRequestBytes,
      );
      if (
        reserved.role !== "finding_discovery" &&
        ((body.tools !== undefined &&
          (!Array.isArray(body.tools) || body.tools.length !== 0)) ||
          (body.tool_choice !== undefined && body.tool_choice !== "none"))
      )
        throw new HostedModelRouteFailure("companion_tools_forbidden", 400);
      if (request.controller.signal.aborted)
        throw new HostedModelRouteFailure("hosted_model_cancelled", 409);
      let forwarded = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let upstream: Readable | undefined;
      try {
        // A lost forwarding acknowledgement can never authorize a second send.
        forwarded = true;
        const claim = await input.api.admission.forward(
          authorization,
          {
            ...request.context,
            requestBytes: request.body.byteLength,
            maxOutputTokens: reserved.maxOutputTokens,
          },
          hash(request.body),
        );
        const remaining =
          Math.min(claim.notAfter.getTime(), Date.parse(cap.deadline)) -
          Date.now();
        if (remaining <= 0) throw new Error("hosted_model_deadline");
        timer = setTimeout(
          () => request.controller.abort(),
          Math.min(remaining, 3_600_000),
        );
        // Native ordinals are global to the original grant, while V2 ordinals
        // are per slot. The unique native request key is the durable claim ref.
        const latest = await input.prisma.hostedCodexRelayRequest.findFirst({
          where: { grantId: hosted.grantId },
          orderBy: { ordinal: "desc" },
          select: { ordinal: true },
        });
        const nativeAuthorization = await input.native.authorization.authorize({
          opaqueGrant: request.opaqueGrant,
          idempotencyKey: reserved.nativeRequestRef,
          requestOrdinal: (latest?.ordinal ?? 0) + 1,
          requestBytes: request.body.byteLength,
        });
        if (
          nativeAuthorization.grantId !== hosted.grantId ||
          nativeAuthorization.accountId !== hosted.activeAccountId ||
          nativeAuthorization.workspaceId !== authorization.workspaceId ||
          nativeAuthorization.runId !== authorization.sourceRunId ||
          nativeAuthorization.runAttempt !==
            Number(authorization.sourceRunAttempt) ||
          nativeAuthorization.model !== cap.model ||
          request.controller.signal.aborted
        )
          throw new Error("hosted_model_native_scope_changed");
        const opened = await input.native.relay.open({
          authorization: {
            ...nativeAuthorization,
            allowAccountFailover: false,
            grantExpiresAtMs: Math.min(
              nativeAuthorization.grantExpiresAtMs,
              claim.notAfter.getTime(),
              Date.parse(cap.deadline),
            ),
            maxRequestBodyBytes: Math.min(
              nativeAuthorization.maxRequestBodyBytes,
              cap.maxRequestBytes,
            ),
            maxResponseBytes: Math.min(
              nativeAuthorization.maxResponseBytes,
              cap.maxResponseBytes,
            ),
            maxOutputTokens: Math.min(
              nativeAuthorization.maxOutputTokens,
              reserved.maxOutputTokens,
            ),
          },
          body: Readable.from([request.body]),
          contentType: "application/json",
          accept: "text/event-stream",
          abortSignal: request.controller.signal,
        });
        upstream = opened.body;
        const abort = () =>
          upstream?.destroy(new Error("hosted_model_cancelled"));
        request.controller.signal.addEventListener("abort", abort, {
          once: true,
        });
        const chunks: Buffer[] = [];
        let bytes = 0;
        try {
          for await (const chunk of upstream) {
            const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            bytes += part.byteLength;
            if (
              bytes > cap.maxResponseBytes ||
              request.controller.signal.aborted
            )
              throw new Error("hosted_model_response_bound");
            chunks.push(part);
          }
        } finally {
          request.controller.signal.removeEventListener("abort", abort);
        }
        const proof = await input.api.reconcileNativeProof(reserved);
        if (
          opened.statusCode !== 200 ||
          proof !== "completed" ||
          request.controller.signal.aborted
        )
          throw new Error("hosted_model_native_completion_required");
        return {
          body: Buffer.concat(chunks),
          requestRef: reserved.nativeRequestRef,
        };
      } catch {
        request.controller.abort();
        upstream?.destroy();
        if (forwarded) {
          // Reconciliation reads positive server facts only. An absent native
          // row or transport exception is never fabricated as no paid effect.
          await input.api.reconcileNativeProof(reserved).catch(() => undefined);
        }
        throw new HostedModelRouteFailure(
          "hosted_model_effect_unresolved",
          502,
          "effect_unknown",
        );
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

export type ReviewRunHostedModelRoute = ReturnType<
  typeof createReviewRunHostedModelRoute
>;

export async function registerReviewRunHostedModelRoute(
  app: FastifyInstance,
  route: ReviewRunHostedModelRoute,
) {
  const active = new Set<AbortController>();
  await app.register(async (scope) => {
    const reservations = new WeakMap<
      FastifyRequest,
      { controller: AbortController; timer: ReturnType<typeof setTimeout> }
    >();
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      {
        parseAs: "buffer",
        bodyLimit: reviewModelDispatchContract.maxRequestBytes,
      },
      (_request, body, done) => done(null, body),
    );
    const finish = (request: FastifyRequest) => {
      const reservation = reservations.get(request);
      if (reservation) {
        clearTimeout(reservation.timer);
        active.delete(reservation.controller);
      }
    };
    scope.setErrorHandler((_error, request, reply) => {
      finish(request);
      reply
        .code(400)
        .send({ error: { code: "invalid_request", effect: "not_dispatched" } });
    });
    scope.post(
      hostedModelRoutePath,
      {
        bodyLimit: reviewModelDispatchContract.maxRequestBytes,
        onRequest: async (request, reply) => {
          reply.header("cache-control", "no-store");
          if (active.size >= 4)
            return reply
              .code(503)
              .send({
                error: {
                  code: "hosted_model_saturated",
                  effect: "not_dispatched",
                },
              });
          const controller = new AbortController();
          active.add(controller);
          const timer = setTimeout(() => {
            controller.abort();
            request.raw.destroy();
            reply.raw.destroy();
          }, 30_000);
          reservations.set(request, { controller, timer });
        },
      },
      async (request, reply) => {
        const reservation = reservations.get(request)!;
        clearTimeout(reservation.timer);
        const abort = () => {
          if (!reply.raw.writableEnded) reservation.controller.abort();
        };
        request.raw.once("aborted", abort);
        reply.raw.once("close", abort);
        try {
          const token = singleHeader(request, "authorization");
          const opaqueGrant = singleHeader(request, hostedModelGrantHeader);
          if (
            !token ||
            !/^Bearer [A-Za-z0-9._~-]{1,16384}$/.test(token) ||
            !opaqueGrant ||
            !/^[A-Za-z0-9._~-]{16,16384}$/.test(opaqueGrant) ||
            request.raw.url?.includes("?") ||
            request.headers["content-encoding"] !== undefined ||
            !Buffer.isBuffer(request.body)
          )
            throw new HostedModelRouteFailure("invalid_request", 400);
          let context: ReturnType<typeof readReviewRunCompanionDispatchContext>;
          try {
            context = readReviewRunCompanionDispatchContext(request);
          } catch {
            throw new HostedModelRouteFailure(
              "model_dispatch_headers_invalid",
              400,
            );
          }
          if (!context || context.dispatchVersion !== 2)
            throw new HostedModelRouteFailure(
              "model_dispatch_claim_required",
              403,
            );
          const result = await route.responses({
            token: token.slice(7),
            opaqueGrant,
            context,
            body: request.body,
            controller: reservation.controller,
          });
          reply.header("content-type", "text/event-stream");
          reply.header("x-reviewrouter-request-ref", result.requestRef);
          return reply.code(200).send(result.body);
        } catch (error) {
          const failure =
            error instanceof HostedModelRouteFailure
              ? error
              : new HostedModelRouteFailure("hosted_model_unavailable", 503);
          return reply
            .code(failure.status)
            .send({ error: { code: failure.code, effect: failure.effect } });
        } finally {
          request.raw.removeListener("aborted", abort);
          reply.raw.removeListener("close", abort);
          if (Buffer.isBuffer(request.body)) request.body.fill(0);
          finish(request);
        }
      },
    );
  });
  app.addHook("preClose", async () => {
    for (const controller of active) controller.abort();
  });
}

function validateNativeRequest(
  bytes: Buffer,
  model: string,
  maximum: number,
): Record<string, unknown> {
  try {
    if (!bytes.byteLength || bytes.byteLength > maximum) throw new Error();
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body: unknown = JSON.parse(text);
    if (
      !body ||
      typeof body !== "object" ||
      Array.isArray(body) ||
      canonicalJson(body) !== text ||
      Reflect.get(body, "model") !== model ||
      Reflect.get(body, "stream") !== true ||
      Reflect.get(body, "store") !== false ||
      Object.hasOwn(body, "max_output_tokens") ||
      Object.hasOwn(body, "previous_response_id")
    )
      throw new Error();
    return body as Record<string, unknown>;
  } catch {
    throw new HostedModelRouteFailure("hosted_model_request_invalid", 400);
  }
}
function singleHeader(
  request: FastifyRequest,
  name: string,
): string | undefined {
  const counts = new Map<string, number>();
  for (let index = 0; index < request.raw.rawHeaders.length; index += 2) {
    const key = request.raw.rawHeaders[index]!.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (
    [...counts].some(
      ([key, count]) =>
        count > 1 &&
        (key === "authorization" ||
          key.startsWith("x-reviewrouter-") ||
          key === "content-type"),
    )
  )
    throw new HostedModelRouteFailure("invalid_request", 400);
  const value = request.headers[name];
  if (
    Array.isArray(value) ||
    (typeof value === "string" && value.includes(","))
  )
    throw new HostedModelRouteFailure("invalid_request", 400);
  return value;
}
function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}
