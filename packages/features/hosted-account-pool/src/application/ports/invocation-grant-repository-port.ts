import type { LegacyInvocationGrant } from "../../domain/invocation-grant";
import type { InvocationGrantId, InvocationId } from "../../domain/identifiers";

export interface InvocationGrantRepositoryPort {
  findByInvocationId(
    invocationId: InvocationId,
  ): Promise<LegacyInvocationGrant | null>;
  insert(grant: LegacyInvocationGrant): Promise<void>;
  /** Adapter must serialize this mutation (transaction/row lock/CAS). */
  mutate(
    grantId: InvocationGrantId,
    transition: (current: LegacyInvocationGrant) => LegacyInvocationGrant,
  ): Promise<LegacyInvocationGrant>;
}
