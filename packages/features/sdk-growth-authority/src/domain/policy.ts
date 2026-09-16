import { AuthorityError } from "./contracts.js";
import type {
  Binding,
  Completion,
  Grant,
  Identity,
  OwnerEvidence,
  Receipt,
} from "./contracts.js";
import { equal } from "./validation.js";

export function assertIdentity(expected: Identity, actual: Identity): void {
  if (!equal(expected, actual)) throw new AuthorityError("wrong-identity");
}
export function assertBinding(expected: Binding, actual: Binding | null): void {
  if (!actual || !equal(expected, actual))
    throw new AuthorityError("binding-changed");
}
export function assertOwner(
  identity: Identity,
  binding: Binding,
  evidence: OwnerEvidence | null,
  now: number,
): asserts evidence is OwnerEvidence {
  if (
    !evidence ||
    evidence.tenantId !== identity.tenantId ||
    evidence.revoked ||
    evidence.decision !== "approved" ||
    evidence.issuedAt > now ||
    evidence.expiresAt <= now ||
    !equal(binding, evidence.binding) ||
    !equal(binding.scopes, evidence.scopes)
  ) {
    throw new AuthorityError("owner-evidence");
  }
}
export function assertLive(
  grant: Grant,
  revoked: boolean,
  fence: number,
  now: number,
): void {
  if (revoked) throw new AuthorityError("revoked");
  if (grant.fence !== fence) throw new AuthorityError("fenced");
  if (now < grant.issuedAt || now >= grant.expiresAt)
    throw new AuthorityError("expired");
}
export function makeReceipt(
  grant: Grant,
  completion: Completion,
  now: number,
): Receipt {
  const complete =
    completion.coverage === "complete" &&
    equal(completion.coveredScopes, grant.binding.scopes);
  const reason = !complete
    ? "incomplete"
    : completion.outcome === "failed"
      ? "failed"
      : "admitted";
  return {
    version: 1,
    receiptId: grant.grantId,
    grantId: grant.grantId,
    identity: grant.identity,
    binding: grant.binding,
    fence: grant.fence,
    completedAt: now,
    reportDigest: completion.reportDigest,
    admitted: reason === "admitted",
    reason,
  };
}
