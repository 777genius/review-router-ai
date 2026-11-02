import { createGatewayUsageRecorder } from "./provider-usage-gateway-recorder.js";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import * as c from "@agent-teams/account-gateway/contracts";
import {
  createConsumerControlClient,
  createExecutionClient,
  type ConsumerControlClient,
} from "@agent-teams/account-gateway/http";
import {
  PrismaProviderAccountRepository,
  selectBinding,
} from "@reviewrouter/features-provider-accounts";
import { readPersonalAccountSharingEnabled } from "@reviewrouter/features-provider-accounts/composition";
import {
  captureGatewayProbeAccessRequest,
  verifyGatewayProbeAccess,
  gatewayProbeLimits,
  gatewayProbeTimeoutMs,
  gatewayProbeId,
  gatewayProbeAccessPath,
} from "@reviewrouter/features-provider-accounts/gateway-probe";
import {
  assertRateLimit,
  PrismaRateLimitStore,
  RateLimitExceededError,
} from "@reviewrouter/features-rate-limits";
import {
  gatewayProfileAcceptsRequestedModel,
  readReviewRunGatewayRelayPolicy,
} from "./review-run-gateway-relay.js";

/** The web's management-only credential cannot issue inference. The API mints
 * one short, fixed-budget capability after its own live binding authorization.
 * Neither the API run-control credential nor this reply enters the browser.
 */
export function createDashboardGatewayProbeAccess(input: {
  prisma: PrismaClient;
  secret: string;
  profiles: readonly c.Profile[];
  control: Pick<ConsumerControlClient, "get" | "runAccess">;
  executionOrigin: string;
  env: Readonly<Record<string, string | undefined>>;
}) {
  const profiles = new Map(
    input.profiles.map((profile) => [
      profile.profileId,
      c.profile.parse(profile),
    ]),
  );
  const accounts = new PrismaProviderAccountRepository(
    input.prisma,
    input.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
    readPersonalAccountSharingEnabled(input.env),
  );
  return async (raw: unknown, signature: unknown) => {
    let minted:
      | Awaited<ReturnType<ConsumerControlClient["runAccess"]>>
      | undefined;
    let closeId: string | undefined;
    try {
      const request = captureGatewayProbeAccessRequest(raw);
      if (!verifyGatewayProbeAccess(request, signature, input.secret))
        return { status: 403, body: { error: "denied" } };
      const liveDeadline = () =>
        Date.parse(request.deadline) > Date.now() &&
        Date.parse(request.deadline) <= Date.now() + gatewayProbeTimeoutMs;
      if (!liveDeadline()) return { status: 403, body: { error: "denied" } };
      async function resolve() {
        if (!liveDeadline()) throw new Error("denied");
        const workspace = await input.prisma.workspace.findUnique({
          where: { id: request.workspaceId },
          select: {
            deletionState: true,
            personalOwnerUserId: true,
            members: {
              where: { userId: request.userId },
              select: { role: true },
            },
          },
        });
        if (
          !workspace ||
          workspace.deletionState !== "active" ||
          (workspace.personalOwnerUserId !== null
            ? workspace.personalOwnerUserId !== request.userId
            : workspace.members.length !== 1)
        )
          throw new Error("denied");
        const row = await accounts.findBinding({
          workspaceId: request.workspaceId,
          bindingId: request.bindingId,
        });
        const tuple = selectBinding(
          request.workspaceId,
          request.bindingId,
          row,
          input.env.ACCOUNT_GATEWAY_OPERATOR_WORKSPACE_ID,
        );
        const profile = tuple.profileRef
          ? profiles.get(tuple.profileRef)
          : undefined;
        if (
          !row ||
          !profile ||
          profile.protocol !== "openai-responses" ||
          !gatewayProfileAcceptsRequestedModel(profile, request.model)
        )
          throw new Error("denied");
        const account = c.account.parse(
          await input.control.get(tuple.gatewayAccountRef),
        );
        const owner = row.connection.owner;
        const ownerRef = `${owner.kind === "user" ? "rru" : "rrw"}_${createHash(
          "sha256",
        )
          .update(
            owner.kind === "user"
              ? `rr-user-owner-v1\0${owner.userId}`
              : `rr-workspace-owner-v1\0${owner.workspaceId}`,
          )
          .digest("hex")}`;
        if (
          account.accountRef !== tuple.gatewayAccountRef ||
          account.ownerRef !== ownerRef ||
          account.profileId !== tuple.profileRef ||
          account.state !== "active" ||
          (tuple.expectedAuthorizationEpoch !== undefined &&
            account.authorizationEpoch !== tuple.expectedAuthorizationEpoch)
        )
          throw new Error("denied");
        return {
          ...tuple,
          authorizationEpoch: account.authorizationEpoch,
          metadataRevision: row.connection.metadataRevision,
        };
      }
      const original = await resolve();
      await assertRateLimit(
        {
          key: `gateway-probe-issuance:${request.workspaceId}:${request.userId}`,
          limit: 5,
          windowMs: 60000,
        },
        {
          rateLimits: new PrismaRateLimitStore(input.prisma),
          clock: { now: () => new Date() },
        },
      );
      if (JSON.stringify(original) !== JSON.stringify(await resolve()))
        throw new Error("denied");
      const id = (kind: string) =>
        gatewayProbeId(kind, request.bindingId, request.nonce);
      closeId = id("close");
      const intent = c.prepare.parse({
        operationId: id("prepare"),
        invocationRef: id("invocation"),
        attemptRef: id("attempt"),
        accountRefs: [original.gatewayAccountRef],
        subjectRef: original.policySubject,
        policyRevision: original.policyRevision,
        bindingRevision: original.bindingRevision,
        profileId: original.profileRef,
        limits: gatewayProbeLimits,
        deadline: request.deadline,
      });
      minted = await input.control.runAccess(intent, {
        signal: AbortSignal.timeout(10000),
      });
      const expected = c.admission.parse({
        invocationRef: intent.invocationRef,
        attemptRef: intent.attemptRef,
        accountRef: original.gatewayAccountRef,
        authorizationEpoch: original.authorizationEpoch,
        subjectRef: intent.subjectRef,
        policyRevision: intent.policyRevision,
        bindingRevision: intent.bindingRevision,
        profileId: intent.profileId,
        limits: intent.limits,
        expiresAt: intent.deadline,
      });
      if (
        minted.operation.operationRef !== intent.operationId ||
        JSON.stringify(c.admission.parse(minted.admission)) !==
          JSON.stringify(expected) ||
        JSON.stringify(original) !== JSON.stringify(await resolve())
      )
        throw new Error("denied");
      if (
        minted.operation.state !== "applied" ||
        minted.operation.result?.kind !== "execution"
      )
        throw new Error("denied");
      await createGatewayUsageRecorder(input.prisma).diagnostic({
        workspaceId: request.workspaceId,
        actorId: request.userId,
        bindingId: request.bindingId,
        invocationId: intent.invocationRef,
        attemptId: intent.attemptRef,
        executionRef: minted.operation.result.executionRef,
        requestRef: id("request"),
        model: request.model,
        deadline: new Date(request.deadline),
      });
      return { status: 200, body: minted };
    } catch (error) {
      if (
        minted?.operation.state === "applied" &&
        minted.operation.result?.kind === "execution" &&
        closeId
      ) {
        try {
          await createExecutionClient({
            role: "execution",
            origin: input.executionOrigin,
            token: minted.bearer,
            timeoutMs: 10000,
          }).close(minted.operation.result.executionRef, {
            operationId: closeId,
            reason: "revoked",
          });
        } catch {
          /* Deadline remains the bounded cleanup fallback; no inference was sent. */
        }
      }
      return {
        status: error instanceof RateLimitExceededError ? 429 : 403,
        body: {
          error:
            error instanceof RateLimitExceededError ? "rate_limited" : "denied",
        },
      };
    }
  };
}

export function productionDashboardGatewayProbeAccess(
  prisma: PrismaClient,
  env: Readonly<Record<string, string | undefined>>,
) {
  if (
    !env.AUTH_SECRET ||
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_ENABLED !== "1" ||
    !env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY ||
    !env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER ||
    !(
      env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ??
      env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN
    )
  )
    return null;
  const policy = readReviewRunGatewayRelayPolicy(
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RELAY_POLICY ?? "",
  );
  const origin =
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_CONTROL_ORIGIN ??
    env.REVIEW_ROUTER_ACCOUNT_GATEWAY_ORIGIN ??
    "";
  return createDashboardGatewayProbeAccess({
    prisma,
    env,
    secret: env.AUTH_SECRET,
    profiles: policy.profiles.map((entry) => entry.profile),
    executionOrigin: origin,
    control: createConsumerControlClient({
      role: "consumer-control",
      origin,
      token: env.REVIEW_ROUTER_ACCOUNT_GATEWAY_RUN_CONTROL_BEARER ?? "",
      timeoutMs: 10000,
      responseBytes: 65536,
    }),
  });
}
export async function registerDashboardGatewayProbeAccessRoute(
  app: FastifyInstance,
  issuer: ReturnType<typeof productionDashboardGatewayProbeAccess>,
) {
  app.post(
    gatewayProbeAccessPath,
    { bodyLimit: 4096 },
    async (request, reply) => {
      reply.header("Cache-Control", "private, no-store");
      if (!issuer) return reply.code(503).send({ error: "unavailable" });
      const result = await issuer(
        request.body,
        request.headers["x-reviewrouter-probe-proof"],
      );
      return reply.code(result.status).send(result.body);
    },
  );
}
