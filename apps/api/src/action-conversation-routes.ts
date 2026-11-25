import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  validateActionSessionAgainstRepository,
  type ActionControlPlaneRepositoryPort,
  type ActionEntitlementPolicyPort,
  type ActionRepositoryContext,
  type ActionSessionClaims,
  type ActionSessionTokenServicePort,
} from "@reviewrouter/features-action-control-plane";
import {
  ConversationError,
  type ConversationProcessResult,
  type ConversationProcessingStore,
  type ProcessConversation,
} from "@reviewrouter/features-conversations";
import type { Clock } from "@reviewrouter/shared";

const processSchema = z.strictObject({
  protocolVersion: z.literal(2),
  pullRequestNumber: z.number().int().positive().max(2_147_483_647),
  sourceCommentId: z.string().regex(/^[1-9]\d{0,19}$/),
  sourceRevision: z.iso.datetime({ offset: true }),
  eventAction: z.enum(["created", "edited", "deleted"]),
  replyMode: z.enum(["off", "suggest"]).optional(),
});
const statusSchema = z.strictObject({
  protocolVersion: z.literal(2),
  processingId: z.uuid(),
});
const publicationSchema = statusSchema
  .extend({
    status: z.enum(["published", "unknown", "failed"]),
    commentId: z
      .string()
      .regex(/^[1-9]\d{0,19}$/)
      .optional(),
    bodyDigest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const publicationClaimSchema = statusSchema
  .extend({
    status: z.literal("dispatching"),
    bodyDigest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type ActionConversationTask = {
  readonly processor: ProcessConversation;
  readonly records: ConversationProcessingStore;
  verifyPublication(
    processingId: string,
    commentId: string,
    result: ConversationProcessResult,
  ): Promise<boolean>;
  claimPublication(processingId: string, bodyDigest: string): Promise<boolean>;
  reconcile(
    result: ConversationProcessResult,
  ): Promise<ConversationProcessResult>;
};
export type ActionConversationDependencies = {
  readonly repositories: ActionControlPlaneRepositoryPort;
  readonly sessions: ActionSessionTokenServicePort;
  readonly entitlements?: ActionEntitlementPolicyPort;
  readonly clock: Clock;
  readonly qualifiedRuntimeSha: string | null;
  readonly enabled?: boolean;
  readonly task: (
    claims: ActionSessionClaims,
    repository: ActionRepositoryContext,
  ) => Promise<ActionConversationTask>;
};
async function session(
  request: FastifyRequest,
  dependencies: ActionConversationDependencies,
) {
  const header = request.headers.authorization;
  if (
    dependencies.enabled === false ||
    !header?.startsWith("Bearer ") ||
    header.length > 8200
  )
    throw new ConversationError("forbidden");
  const claims = await dependencies.sessions.verify({
    token: header.slice(7),
    now: dependencies.clock.now(),
  });
  const repository =
    await dependencies.repositories.findSelectedRepositoryByGithubId(
      claims.githubRepositoryId,
    );
  if (!repository) throw new ConversationError("forbidden");
  validateActionSessionAgainstRepository({ session: claims, repository });
  if (
    !repository.identityBindingEpoch ||
    claims.identityBindingEpoch !== repository.identityBindingEpoch
  )
    throw new ConversationError("forbidden");
  const runtime = dependencies.qualifiedRuntimeSha;
  if (
    !runtime ||
    claims.eventName !== "pull_request_review_comment" ||
    claims.workflowPath !== ".github/workflows/reviewrouter-interaction.yml" ||
    claims.jobWorkflowSha !== runtime ||
    claims.jobWorkflowRef !==
      `777genius/review-router/.github/workflows/reviewrouter-interaction-reusable.yml@${runtime}` ||
    !claims.githubActorId
  )
    throw new ConversationError("forbidden");
  await dependencies.entitlements?.assertActionControlPlaneAllowed({
    workspaceId: claims.workspaceId,
    repositoryId: claims.repositoryId,
    repositoryFullName: claims.repository,
  });
  return { claims, repository };
}
export async function registerActionConversationRoutes(
  app: FastifyInstance,
  dependencies: ActionConversationDependencies,
) {
  const guarded =
    (handler: (request: FastifyRequest) => Promise<unknown>) =>
    async (request: FastifyRequest, reply: import("fastify").FastifyReply) => {
      reply.header("cache-control", "private, no-store");
      try {
        return reply.send({
          protocolVersion: 2,
          ...((await handler(request)) as Record<string, unknown>),
        });
      } catch (error) {
        const code =
          error instanceof ConversationError
            ? error.code
            : error instanceof z.ZodError
              ? "invalid_input"
              : "unavailable";
        return reply
          .code(
            code === "forbidden"
              ? 403
              : code === "invalid_input"
                ? 400
                : code === "conflict" || code === "stale"
                  ? 409
                  : 503,
          )
          .send({
            protocolVersion: 2,
            status: "rejected",
            reason: `conversation_${code}`,
            retryable: false,
          });
      }
    };
  app.post(
    "/api/action/v2/conversations/process",
    { bodyLimit: 2048, logLevel: "silent" },
    guarded(async (request) => {
      const input = processSchema.parse(request.body);
      const { claims, repository } = await session(request, dependencies);
      const task = await dependencies.task(claims, repository);
      const deadlineAt = new Date(dependencies.clock.now().getTime() + 90_000);
      return task.reconcile(
        await task.processor.execute(
          {
            pullRequestNumber: input.pullRequestNumber,
            sourceCommentId: input.sourceCommentId,
            sourceRevision: input.sourceRevision,
            eventAction: input.eventAction,
            ...(input.replyMode ? { replyMode: input.replyMode } : {}),
          },
          { deadlineAt, signal: AbortSignal.timeout(90_000) },
        ),
      );
    }),
  );
  app.post(
    "/api/action/v2/conversations/status",
    { bodyLimit: 1024, logLevel: "silent" },
    guarded(async (request) => {
      const input = statusSchema.parse(request.body);
      const { claims, repository } = await session(request, dependencies);
      const task = await dependencies.task(claims, repository);
      const record = await task.records.read(input.processingId);
      if (
        !record ||
        record.identity.sourceActor.id !== `github-user:${claims.githubActorId}`
      )
        throw new ConversationError("forbidden");
      // Safe readback only. Expired/lost in-process work cannot resume or create a paid attempt.
      if (
        record.result.status === "processing" &&
        record.deadlineAt.getTime() <= dependencies.clock.now().getTime()
      ) {
        const result: ConversationProcessResult = {
          ...record.result,
          status: record.modelDispatched ? "output_unavailable" : "unavailable",
        };
        await task.records.finish(record.id, result);
        return result;
      }
      return task.reconcile(record.result);
    }),
  );
  app.post(
    "/api/action/v2/conversations/publication",
    { bodyLimit: 2048, logLevel: "silent" },
    guarded(async (request) => {
      const input = z
        .union([publicationSchema, publicationClaimSchema])
        .parse(request.body);
      const { claims, repository } = await session(request, dependencies);
      const task = await dependencies.task(claims, repository);
      const record = await task.records.read(input.processingId);
      if (
        !record ||
        record.identity.sourceActor.id !== `github-user:${claims.githubActorId}`
      )
        throw new ConversationError("forbidden");
      if (input.status === "dispatching")
        return {
          processingId: input.processingId,
          allowed: await task.claimPublication(
            input.processingId,
            input.bodyDigest,
          ),
        };
      if (
        input.status === "published" &&
        (!input.commentId ||
          !(await task.verifyPublication(
            input.processingId,
            input.commentId,
            record.result,
          )))
      )
        throw new ConversationError("forbidden");
      return task.reconcile(
        await task.records.publication({
          processingId: input.processingId,
          status: input.status,
          ...(input.commentId ? { commentId: input.commentId } : {}),
          ...(input.bodyDigest ? { bodyDigest: input.bodyDigest } : {}),
        }),
      );
    }),
  );
}
