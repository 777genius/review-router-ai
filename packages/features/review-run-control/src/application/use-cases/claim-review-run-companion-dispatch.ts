import type { ReviewRunAuthorization } from "../../domain/review-run-authorization";
import {
  ReviewRunCompanionDispatchFailure,
  type ReviewRunCompanionDispatchAdmission,
  type ReviewRunCompanionDispatchRepository,
} from "../ports/review-run-companion-dispatch-port";

export type CompanionLeaseAuthority = Readonly<{
  capabilityId: string;
  authorizationId: string;
  mutationEpoch: bigint;
  scopeHash: string;
  executionId: string;
  workSlotId: string;
  leaseId: string;
  ownerIdHash: string;
  providerInvocationKey: string;
  purpose: string;
  reviewRevisionHash: string;
  ownershipExpiresAt: Date;
}>;

/** A signed lease capability and the bearer authorization are independent
 * requirements. Verified ownership is consumed once by the durable claim. */
export class ClaimReviewRunCompanionDispatch implements ReviewRunCompanionDispatchAdmission {
  constructor(
    private readonly repository: ReviewRunCompanionDispatchRepository,
    private readonly verifyLease: (
      token: string,
      now: Date,
    ) => Promise<CompanionLeaseAuthority>,
  ) {}

  async claim(
    authorization: ReviewRunAuthorization,
    context: Parameters<ReviewRunCompanionDispatchAdmission["claim"]>[1],
    providerRequestEnvelopeHash: string,
  ) {
    let authority: CompanionLeaseAuthority;
    try {
      authority = await this.verifyLease(context.leaseCapability, new Date());
    } catch {
      throw new ReviewRunCompanionDispatchFailure(
        "companion_lease_capability_invalid",
      );
    }
    if (
      authority.authorizationId !== authorization.authorizationId ||
      authority.executionId !== context.executionId ||
      authority.workSlotId !== context.workSlotId ||
      authority.leaseId !== context.leaseId ||
      authority.purpose !== "provider_execution" ||
      !/^[1-9][0-9]{0,19}$/.test(context.fencingToken) ||
      !/^[a-f0-9]{64}$/.test(providerRequestEnvelopeHash)
    )
      throw new ReviewRunCompanionDispatchFailure(
        "companion_lease_capability_mismatch",
      );
    return this.repository.claim({
      authorizationId: authorization.authorizationId,
      runtimeSnapshotCanonicalJson:
        authorization.runtimeSnapshotCanonicalJson ?? "",
      dispatchId: context.dispatchId,
      executionId: context.executionId,
      workSlotId: context.workSlotId,
      attemptOrdinal: context.attemptOrdinal,
      leaseId: context.leaseId,
      fencingToken: BigInt(context.fencingToken),
      preparedManifestKey: context.preparedManifestKey,
      providerRequestEnvelopeHash,
      leaseCapabilityId: authority.capabilityId,
      ownerIdHash: authority.ownerIdHash,
      providerInvocationKey: authority.providerInvocationKey,
      ownershipExpiresAt: authority.ownershipExpiresAt,
      capabilityMutationEpoch: authority.mutationEpoch,
      capabilityReviewRevisionHash: authority.reviewRevisionHash,
      capabilityScopeHash: authority.scopeHash,
    });
  }

  read = (authorizationId: string, dispatchId: string) =>
    this.repository.read(authorizationId, dispatchId);
  settle: ReviewRunCompanionDispatchRepository["settle"] = (...args) =>
    this.repository.settle(...args);
}
