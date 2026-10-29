import type { Prisma, PrismaClient } from "@prisma/client";
import {
  canonicalReviewSkillsJson,
  createCapturedReviewSkills,
  parseCapturedReviewSkills,
} from "@reviewrouter/shared/review-skills-contract";
import type {
  ReviewRunAuthorizationCandidate,
  ReviewRunSkillsSnapshotPort,
} from "@reviewrouter/features-review-run-control";
import { createPrismaReviewSkillsAdmission } from "@reviewrouter/features-review-skills/composition";
import type { ReviewSkillsAdmissionSelection } from "@reviewrouter/features-review-skills";

/** App-owned bridge. No live Skill authority checks on renewal or execution. */
export class ProductionReviewSkillsSnapshot implements ReviewRunSkillsSnapshotPort {
  private readonly admission;
  constructor(prisma: PrismaClient) {
    this.admission = createPrismaReviewSkillsAdmission(prisma);
  }

  async capture(
    input: Parameters<ReviewRunSkillsSnapshotPort["capture"]>[0],
  ): ReturnType<ReviewRunSkillsSnapshotPort["capture"]> {
    try {
      const selected = await this.admission.capture({
        workspaceId: input.identity.workspaceId,
        repositoryConnectionId: input.identity.repositoryConnectionId,
        baseSha: input.identity.baseSha,
      });
      const agents = input.agents ?? (input.agent ? [input.agent] : []);
      if (
        !agents.length ||
        agents.some((agent) => agent.reviewSkillsVersion !== 1)
      ) {
        return selected.webSkills.length || selected.gitSources.length
          ? { captureDenied: "skills_engine_unsupported" }
          : { canonicalJson: null };
      }
      return {
        canonicalJson: canonicalReviewSkillsJson(
          createCapturedReviewSkills({
            baseSha: input.identity.baseSha,
            webSkills: selected.webSkills,
            gitSources: selected.gitSources,
          }),
        ),
      };
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      if (
        code === "unavailable" ||
        code === "forbidden" ||
        code === "not_found"
      )
        return { captureDenied: "skills_unavailable" };
      const message = error instanceof Error ? error.message : "";
      if (
        code === "limit_exceeded" ||
        /^review_skills_(capture_too_large|instructions_too_large|too_many_skills)$/.test(
          message,
        )
      )
        return { captureDenied: "skills_limits_exceeded" };
      throw error;
    }
  }

  /** Called BEFORE the existing runtime fence which locks destination Workspace. */
  async prelock(
    transaction: Prisma.TransactionClient,
    candidate: ReviewRunAuthorizationCandidate,
  ): Promise<boolean> {
    return this.admission.prelock(transaction, {
      workspaceId: candidate.workspaceId,
      candidate: capturedSelection(candidate),
    });
  }

  async matchesAdmission(
    transaction: Prisma.TransactionClient,
    candidate: ReviewRunAuthorizationCandidate,
  ): Promise<boolean> {
    return this.admission.matchesAdmission(transaction, {
      workspaceId: candidate.workspaceId,
      repositoryConnectionId: candidate.repositoryConnectionId,
      baseSha: candidate.baseSha,
      candidate: capturedSelection(candidate),
    });
  }
}

function capturedSelection(
  candidate: ReviewRunAuthorizationCandidate,
): ReviewSkillsAdmissionSelection {
  const value = candidate.skillsSnapshotCanonicalJson;
  if (!value) return { sourceWorkspaceIds: [], webSkills: [], gitSources: [] };
  const parsed = parseCapturedReviewSkills(JSON.parse(value));
  if (parsed.baseSha !== candidate.baseSha)
    throw new Error("review_skills_base_mismatch");
  return {
    sourceWorkspaceIds: [
      ...new Set(parsed.webSkills.map((skill) => skill.sourceWorkspaceId)),
    ].sort(),
    webSkills: parsed.webSkills,
    gitSources: parsed.gitSources,
  };
}
