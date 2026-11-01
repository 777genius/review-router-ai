import type { ProviderApiAuthMode } from "@reviewrouter/shared";
import type { ReviewRunRuntimeSnapshot } from "../../domain/review-run-runtime-snapshot";
import type { VerifiedScmRunIdentity } from "../use-cases/manage-review-run-authorizations";
import type { ProducerRelease } from "../../domain/producer-release";
import type { ReviewAgentProfile } from "../../domain/review-agent-profile";
import type { ProviderVoteLane } from "../../domain/review-run-control-types";

/** Explicit agentProfileRef configuration errors are actionable policy errors,
 * not a generic admission-facts miss. Never fall back to another engine. */
export type ReviewRunRuntimeCaptureDenial = Readonly<{
  readonly captureDenied:
    | "agent_profile_unavailable"
    | "agent_profile_incompatible"
    | "context_tools_unavailable";
}>;

export interface ReviewRunRuntimeSnapshotPort {
  capture(input: {
    readonly identity: VerifiedScmRunIdentity;
    readonly deadline: Date;
    readonly modelTransport: ReviewAgentProfile["modelTransports"][number];
    /** Derived from a verified canonical caller, never a request input. */
    readonly providerApiAuthMode?: ProviderApiAuthMode;
    /** Native subscription credential route bound by the canonical caller. */
    readonly subscriptionAuthMode?: "claude-oauth";
    readonly providerVoteLanes?: readonly ProviderVoteLane[];
    readonly reviewInvestigationAuthorizationDescriptorCanonicalJson?:
      | string
      | null;
    readonly producerRelease: Pick<
      ProducerRelease,
      | "producerReleaseId"
      | "actionCommitSha"
      | "runtimeCommitSha"
      | "agentProfiles"
      | "contextToolsProfile"
      | "prDescriptionProfile"
      | "lifecycleVerificationProfile"
      | "modelDispatchProfile"
      | "reviewerPlanProfile"
    >;
  }): Promise<ReviewRunRuntimeSnapshot | ReviewRunRuntimeCaptureDenial | null>;
  /** Recheck original binding, never today's repository configuration. */
  isLive(input: {
    readonly snapshot: ReviewRunRuntimeSnapshot;
    readonly identity: VerifiedScmRunIdentity;
    readonly now: Date;
  }): Promise<boolean>;
  /** V4 selected allocation validity never revokes healthy sibling authority. */
  isAllocationLive?(input: {
    readonly snapshot: ReviewRunRuntimeSnapshot;
    readonly allocationId: string;
    readonly identity: VerifiedScmRunIdentity;
    readonly now: Date;
  }): Promise<boolean>;
}
