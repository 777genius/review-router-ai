import type { ReviewRunRuntimeSnapshot } from "../../domain/review-run-runtime-snapshot";
import type { VerifiedScmRunIdentity } from "../use-cases/manage-review-run-authorizations";
import type { ProducerRelease } from "../../domain/producer-release";

export interface ReviewRunRuntimeSnapshotPort {
  capture(input: {
    readonly identity: VerifiedScmRunIdentity;
    readonly deadline: Date;
    readonly producerRelease: Pick<
      ProducerRelease,
      | "producerReleaseId"
      | "actionCommitSha"
      | "runtimeCommitSha"
      | "agentProfiles"
    >;
  }): Promise<ReviewRunRuntimeSnapshot | null>;
  /** Recheck original binding, never today's repository configuration. */
  isLive(input: {
    readonly snapshot: ReviewRunRuntimeSnapshot;
    readonly identity: VerifiedScmRunIdentity;
    readonly now: Date;
  }): Promise<boolean>;
}
