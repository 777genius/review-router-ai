import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { contextToolsContract } from "@reviewrouter/shared";
import {
  parseContextToolsPlan,
  type ContextToolsPlan,
} from "@reviewrouter/features-review-context-tools";
import {
  parseReviewRunRuntimeSnapshot,
  type ReviewRunAuthorization,
} from "@reviewrouter/features-review-run-control";

export class ContextToolsAccessFailure extends Error {
  constructor(
    readonly code: string,
    readonly status = 403,
  ) {
    super(code);
  }
}
export type ContextToolsRunAccess = Readonly<{
  /** Normal token resolution + current admission/SCM/producer/epoch guards. */
  authorize(token: string): Promise<ReviewRunAuthorization | null>;
  deliver(
    workspaceId: string,
    plan: ContextToolsPlan,
  ): Promise<Record<string, string>>;
  assertIssueAccess(authorization: ReviewRunAuthorization): Promise<void>;
  readIssue(
    authorization: ReviewRunAuthorization,
    issueNumber: number,
  ): Promise<unknown>;
}>;
const requestSchema = z
  .object({
    authorizationId: z.string().min(1).max(256),
    planDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
const issueSchema = requestSchema
  .extend({ issueNumber: z.number().int().positive().max(2_147_483_647) })
  .strict();
function bearer(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^Bearer [A-Za-z0-9._~-]{1,8192}$/.test(value)
  )
    throw new ContextToolsAccessFailure("context_auth_invalid", 401);
  return value.slice(7);
}
async function capture(
  token: string,
  request: z.infer<typeof requestSchema>,
  access: ContextToolsRunAccess,
) {
  const authorization = await access.authorize(token);
  if (
    !authorization ||
    authorization.authorizationId !== request.authorizationId
  )
    throw new ContextToolsAccessFailure("context_authorization_inactive", 410);
  const snapshot = parseReviewRunRuntimeSnapshot(
    authorization.runtimeSnapshotCanonicalJson,
  );
  if (
    !snapshot?.contextToolsPlanCanonicalJson ||
    snapshot.agent.agentKind !== "ocr"
  )
    throw new ContextToolsAccessFailure("context_plan_unavailable");
  const plan = parseContextToolsPlan(
    JSON.parse(snapshot.contextToolsPlanCanonicalJson),
  );
  if (plan.planDigest !== request.planDigest)
    throw new ContextToolsAccessFailure("context_plan_mismatch");
  return { authorization, plan };
}
export async function registerContextToolsRoutes(
  app: FastifyInstance,
  access: ContextToolsRunAccess,
): Promise<void> {
  for (const kind of ["credentials", "github-issue"] as const) {
    app.post(
      kind === "credentials"
        ? contextToolsContract.credentialsPath
        : contextToolsContract.githubIssuePath,
      { bodyLimit: 2048, logLevel: "silent" },
      async (request, reply) => {
        reply.header("cache-control", "private, no-store");
        try {
          const input = (
            kind === "credentials" ? requestSchema : issueSchema
          ).safeParse(request.body);
          if (!input.success)
            throw new ContextToolsAccessFailure("context_request_invalid", 400);
          const token = bearer(request.headers.authorization);
          const { authorization, plan } = await capture(
            token,
            input.data,
            access,
          );
          let result: unknown;
          if (kind === "credentials") {
            // Required builtin entitlement is checked before the parent begins inference.
            if (plan.builtinTools.includes("github.issue.read"))
              await access.assertIssueAccess(authorization);
            result = {
              planDigest: plan.planDigest,
              secrets: await access.deliver(authorization.workspaceId, plan),
            };
          } else {
            if (!plan.builtinTools.includes("github.issue.read"))
              throw new ContextToolsAccessFailure("context_tool_not_selected");
            result = await access.readIssue(
              authorization,
              issueSchema.parse(input.data).issueNumber,
            );
          }
          const fresh = await capture(token, input.data, access);
          if (
            fresh.authorization.runtimeSnapshotCanonicalJson !==
            authorization.runtimeSnapshotCanonicalJson
          )
            throw new ContextToolsAccessFailure(
              "context_authorization_changed",
              410,
            );
          return reply.code(200).send(result);
        } catch (error) {
          const allowed = error instanceof ContextToolsAccessFailure;
          return reply.code(allowed ? error.status : 503).send({
            error: allowed ? error.code : "context_tools_unavailable",
          });
        }
      },
    );
  }
}
