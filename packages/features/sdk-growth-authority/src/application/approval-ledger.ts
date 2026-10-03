import type { AuthorityScope, TrustedAuthorityRecord } from "./ports.js";

/** The reference selects an immutable proposal in trusted server custody.
 * This port is owned by the protected Host; candidate material is never an
 * argument to the administrative command. The proposal builder must display
 * its exact source/base/merge-base, scopes, decisions, package set and expiry. */
export interface TrustedG1ApprovalProposalPort {
  load(
    reference: string,
    scope: AuthorityScope,
  ): Promise<TrustedAuthorityRecord | null>;
}
