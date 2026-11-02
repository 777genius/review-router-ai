import type { FastifyInstance } from "fastify";
import {
  parseCapturedReviewSkills,
  reviewSkillsCompanionContract,
  type CapturedReviewSkills,
} from "@reviewrouter/shared/review-skills-contract";
import {
  parseReviewReviewerId,
  reviewerPlanContract,
} from "@reviewrouter/shared";
import {
  getReviewRunReviewer,
  parseReviewRunRuntimeSnapshot,
  type ManageReviewRunAuthorizations,
} from "@reviewrouter/features-review-run-control";

export type ReviewRunSkillsReader = Readonly<{
  read(
    token: string,
    reviewerId?: string,
  ): Promise<
    | Readonly<{ status: "ready"; capture: CapturedReviewSkills }>
    | Readonly<{ status: "unauthorized" }>
    | Readonly<{ status: "unavailable" }>
  >;
}>;

export function createReviewRunSkillsReader(
  authorizations: Pick<
    ManageReviewRunAuthorizations,
    "resolveReviewRunAuthorizationToken"
  >,
): ReviewRunSkillsReader {
  return Object.freeze({
    async read(token: string, reviewerId?: string) {
      const result = await authorizations.resolveReviewRunAuthorizationToken({
        token,
      });
      if (result.status !== "valid") return { status: "unauthorized" as const };
      const authorization = result.authorization;
      const runtime = parseReviewRunRuntimeSnapshot(
        authorization.runtimeSnapshotCanonicalJson,
      );
      const agent =
        runtime?.snapshotVersion === 4
          ? reviewerId === undefined
            ? null
            : getReviewRunReviewer(runtime, reviewerId)?.agentProfile
          : reviewerId === undefined
            ? runtime?.agent
            : null;
      if (
        !agent ||
        agent.reviewSkillsVersion !== 1 ||
        !authorization.skillsSnapshotCanonicalJson
      )
        return { status: "unavailable" as const };
      const capture = parseCapturedReviewSkills(
        JSON.parse(authorization.skillsSnapshotCanonicalJson),
      );
      if (capture.baseSha !== authorization.baseSha)
        return { status: "unavailable" as const };
      return { status: "ready" as const, capture };
    },
  });
}

/** Bounded companion. Authorization identifies the sole immutable captured document. */
export async function registerReviewRunSkillsRoute(
  app: FastifyInstance,
  reader: ReviewRunSkillsReader,
): Promise<void> {
  app.route({
    method: reviewSkillsCompanionContract.method,
    url: reviewSkillsCompanionContract.path,
    bodyLimit: reviewSkillsCompanionContract.requestMaxBytes,
    schema: {
      body: { type: "object", maxProperties: 0 },
    },
    async handler(request, reply) {
      reply.header("Cache-Control", "no-store");
      const header = request.headers.authorization;
      if (
        typeof header !== "string" ||
        !header.startsWith("Bearer ") ||
        header.length > 32768 ||
        !header.slice(7).trim()
      )
        return reply.code(401).send({ error: "authorization_denied" });
      try {
        const selector = request.headers[reviewerPlanContract.reviewerIdHeader];
        let reviewerId: string | undefined;
        try {
          reviewerId =
            selector === undefined
              ? undefined
              : parseReviewReviewerId(selector);
        } catch {
          return reply.code(400).send({ error: "invalid_request" });
        }
        const result = await reader.read(header.slice(7), reviewerId);
        if (result.status === "unauthorized")
          return reply.code(401).send({ error: "authorization_denied" });
        if (result.status === "unavailable")
          return reply.code(409).send({ error: "skills_capture_unavailable" });
        return reply.send(result.capture);
      } catch {
        // Never serialize source bodies, parser input, or credentials in an error.
        return reply.code(503).send({ error: "skills_capture_unavailable" });
      }
    },
  });
}
