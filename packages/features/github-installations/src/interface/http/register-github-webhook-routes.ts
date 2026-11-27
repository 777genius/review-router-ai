import type {
  FastifyError,
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
} from "fastify";
import rawBody from "fastify-raw-body";
import {
  githubAppAuthorizationWebhookPayloadSchema,
  githubInstallationWebhookPayloadSchema,
  githubPullRequestWebhookPayloadSchema,
  githubPushWebhookPayloadSchema,
  githubRepositoryWebhookPayloadSchema,
  isSupportedGitHubInstallationWebhookEvent,
  type GitHubPullRequestWebhookHandlerPort,
} from "../../domain/github-webhook";
import { hashGitHubWebhookPayload } from "../../domain/github-webhook-normalization";
import type { GitHubWebhookTransactionPort } from "../../application/ports/github-webhook-transaction-port";
import {
  processGitHubWebhook,
  type SupportedGitHubWebhookEnvelope,
} from "../../application/use-cases/process-github-webhook";
import { verifyGitHubWebhookSignature } from "../../infrastructure/crypto/github-webhook-signature";

export type RegisterGitHubWebhookRoutesDependencies = {
  readonly webhookSecret: string;
  readonly transactions: GitHubWebhookTransactionPort;
  /** Remote/independent admission runs before the local receipt transaction. */
  readonly preAdmissionPullRequests?: GitHubPullRequestWebhookHandlerPort;
  /** Never receives raw payloads or exception text. */
  readonly onProcessingError?: () => void;
};

type RawBodyRequest = FastifyRequest & { readonly rawBody?: Buffer };

// The larger signed webhook limit never changes other API parser limits.
const githubWebhookBodyLimitBytes = 25 * 1024 * 1024;

export async function registerGitHubWebhookRoutes(
  app: FastifyInstance,
  dependencies: RegisterGitHubWebhookRoutesDependencies,
): Promise<void> {
  const notifyProcessingError = () => {
    try {
      dependencies.onProcessingError?.();
    } catch {
      // An observer cannot change the opaque webhook response.
    }
  };
  await app.register(rawBody, {
    field: "rawBody",
    global: false,
    encoding: false,
    runFirst: true,
    routes: ["/webhooks/github"],
  });
  const routeOptions = {
    bodyLimit: githubWebhookBodyLimitBytes,
    errorHandler: (
      error: FastifyError,
      _request: FastifyRequest,
      reply: FastifyReply,
    ) => {
      const status =
        typeof error.statusCode === "number" &&
        error.statusCode >= 400 &&
        error.statusCode < 500
          ? error.statusCode
          : 500;
      if (status === 500) notifyProcessingError();
      return reply.code(status).send({
        error:
          status < 500
            ? "invalid_webhook_payload"
            : "github_webhook_processing_failed",
      });
    },
  };
  app.post("/webhooks/github", routeOptions, async (request, reply) => {
    try {
      const rawPayload = (request as RawBodyRequest).rawBody;
      const deliveryId = request.headers["x-github-delivery"];
      const eventName = request.headers["x-github-event"];
      const signature = request.headers["x-hub-signature-256"];
      if (!rawPayload || !Buffer.isBuffer(rawPayload)) {
        return reply.code(400).send({ error: "missing_raw_body" });
      }
      if (typeof deliveryId !== "string" || typeof eventName !== "string") {
        return reply.code(400).send({ error: "missing_github_headers" });
      }
      if (
        !verifyGitHubWebhookSignature({
          payload: rawPayload,
          signatureHeader:
            typeof signature === "string" ? signature : undefined,
          secret: dependencies.webhookSecret,
        })
      ) {
        return reply.code(401).send({ error: "invalid_signature" });
      }
      if (!isSupportedGitHubInstallationWebhookEvent(eventName)) {
        return reply
          .code(202)
          .send({ processed: false, ignored: true, eventName });
      }
      const envelope = parseEnvelope({
        eventName,
        deliveryId,
        payloadHash: hashGitHubWebhookPayload(rawPayload),
        body: request.body,
      });
      if (!envelope) {
        return reply.code(400).send({ error: "invalid_webhook_payload" });
      }
      const preAdmissionResult =
        envelope.eventName === "pull_request" &&
        dependencies.preAdmissionPullRequests
          ? await dependencies.preAdmissionPullRequests.handleGitHubPullRequestWebhook(
              envelope,
            )
          : null;
      const result = await processGitHubWebhook(
        envelope,
        dependencies.transactions,
        preAdmissionResult,
      );
      // Sending before run() commits would acknowledge an event that can roll back.
      return result.kind === "unhandled"
        ? reply.code(202).send({ processed: false, ignored: true, eventName })
        : reply.send(result.value);
    } catch {
      notifyProcessingError();
      return reply
        .code(500)
        .send({ error: "github_webhook_processing_failed" });
    }
  });
}

function parseEnvelope(input: {
  readonly eventName: SupportedGitHubWebhookEnvelope["eventName"];
  readonly deliveryId: string;
  readonly payloadHash: string;
  readonly body: unknown;
}): SupportedGitHubWebhookEnvelope | null {
  const { deliveryId, payloadHash } = input;
  switch (input.eventName) {
    case "github_app_authorization": {
      const parsed = githubAppAuthorizationWebhookPayloadSchema.safeParse(
        input.body,
      );
      return parsed.success
        ? {
            deliveryId,
            payloadHash,
            eventName: input.eventName,
            payload: parsed.data,
          }
        : null;
    }
    case "pull_request": {
      const parsed = githubPullRequestWebhookPayloadSchema.safeParse(
        input.body,
      );
      return parsed.success
        ? {
            deliveryId,
            payloadHash,
            eventName: input.eventName,
            payload: parsed.data,
          }
        : null;
    }
    case "push": {
      const parsed = githubPushWebhookPayloadSchema.safeParse(input.body);
      return parsed.success
        ? {
            deliveryId,
            payloadHash,
            eventName: input.eventName,
            payload: parsed.data,
          }
        : null;
    }
    case "repository": {
      const parsed = githubRepositoryWebhookPayloadSchema.safeParse(input.body);
      return parsed.success
        ? {
            deliveryId,
            payloadHash,
            eventName: input.eventName,
            payload: parsed.data,
          }
        : null;
    }
    case "installation":
    case "installation_repositories": {
      const parsed = githubInstallationWebhookPayloadSchema.safeParse(
        input.body,
      );
      return parsed.success
        ? {
            deliveryId,
            payloadHash,
            eventName: input.eventName,
            payload: parsed.data,
          }
        : null;
    }
  }
}
