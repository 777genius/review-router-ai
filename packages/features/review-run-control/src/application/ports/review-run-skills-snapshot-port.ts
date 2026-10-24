import type { ReviewAgentProfile } from "../../domain/review-agent-profile";
import type { VerifiedScmRunIdentity } from "../use-cases/manage-review-run-authorizations";

export type ReviewRunSkillsCaptureDenial =
  | "skills_unavailable"
  | "skills_engine_unsupported"
  | "skills_limits_exceeded";

/** Captures content only for NEW admission. Never consulted on renewal/execution. */
export interface ReviewRunSkillsSnapshotPort {
  capture(input: {
    readonly identity: VerifiedScmRunIdentity;
    readonly agent: ReviewAgentProfile | null;
  }): Promise<
    | Readonly<{ canonicalJson: string | null }>
    | Readonly<{ captureDenied: ReviewRunSkillsCaptureDenial }>
  >;
}
