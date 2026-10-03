import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type {
  HostedV4OneShotAuthorizationPort,
  HostedV4OneShotRelayPort,
} from "../../infrastructure/http/hosted-v4-one-shot-relay";

export const hostedV4ResponsesPath = "/api/hosted/v4/codex/responses";

/** Not registered by production composition until its real verified issuer,
 * authorization adapter and immutable approval have been supplied. */
export async function registerHostedV4OneShotRelayRoute(
  app: FastifyInstance,
  dependencies: {
    authorization: HostedV4OneShotAuthorizationPort;
    relay: HostedV4OneShotRelayPort;
  },
): Promise<void> {
  await app.register(async (scope) => {
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser(
      "application/json",
      { parseAs: "buffer", bodyLimit: 1_000_000 },
      (_request, body, done) => done(null, body),
    );
    scope.post(
      hostedV4ResponsesPath,
      { bodyLimit: 1_000_000 },
      async (request, reply) => {
        const controller = new AbortController();
        const abort = () => controller.abort();
        const close = () => {
          if (!reply.raw.writableEnded) abort();
        };
        request.raw.once("aborted", abort);
        reply.raw.once("close", close);
        const body = request.body;
        try {
          const bearer =
            typeof request.headers.authorization === "string" &&
            /^Bearer ([^\s]{1,512})$/i.exec(request.headers.authorization)?.[1];
          const idempotencyKey = request.headers["idempotency-key"];
          if (
            !bearer ||
            typeof idempotencyKey !== "string" ||
            !idempotencyKey.trim() ||
            idempotencyKey.length > 256 ||
            request.headers["x-reviewrouter-request-ordinal"] !== "1" ||
            !Buffer.isBuffer(body) ||
            body.byteLength < 1 ||
            request.headers["content-length"] !== String(body.byteLength)
          )
            return reply.code(400).send({ error: "hosted_v4_request_invalid" });
          const authorization = await dependencies.authorization.authorize({
            opaqueGrant: bearer,
            idempotencyKey,
            requestOrdinal: 1,
            requestHash: createHash("sha256").update(body).digest("hex"),
            requestBytes: body.byteLength,
          });
          const upstream = await dependencies.relay.open({
            authorization,
            body,
            idempotencyKey,
            abortSignal: controller.signal,
          });
          return reply
            .code(upstream.statusCode)
            .type(upstream.contentType)
            .header("cache-control", "no-store")
            .header("x-content-type-options", "nosniff")
            .header(
              "x-reviewrouter-output-token-policy",
              "owner-one-shot-uncapped-test",
            )
            .send(upstream.body);
        } catch {
          // Never expose bearer, provider body, credentials, or raw DB errors.
          return reply
            .code(412)
            .send({ error: "hosted_v4_rejected_or_recovery_required" });
        } finally {
          request.raw.off("aborted", abort);
          reply.raw.off("close", close);
          if (Buffer.isBuffer(body)) body.fill(0);
        }
      },
    );
  });
}
