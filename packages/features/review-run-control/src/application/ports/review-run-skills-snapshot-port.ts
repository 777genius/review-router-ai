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
    /** Every captured engine must support the selected shared content. */
    readonly agents?: readonly ReviewAgentProfile[];
  }): Promise<
    | Readonly<{ canonicalJson: string | null }>
    | Readonly<{ captureDenied: ReviewRunSkillsCaptureDenial }>
  >;
}
