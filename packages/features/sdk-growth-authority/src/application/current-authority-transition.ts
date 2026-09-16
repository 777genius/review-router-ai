import type { AuthorityChange, CanonicalAuthorityMaterial } from "./ports.js";
import { AuthorityError } from "../domain/contracts.js";
import { equal } from "../domain/validation.js";

function requireTransition(condition: boolean): asserts condition {
  if (!condition) throw new AuthorityError("invalid-contract");
}

/** Match the immutable reason to the complete semantic delta. Replacements may
 * renew their associated trusted evidence, but invalidations and revocation are
 * deliberately single-purpose transitions. */
export function assertAuthorityTransition(
  previous: CanonicalAuthorityMaterial | null,
  next: CanonicalAuthorityMaterial,
  change: AuthorityChange,
): void {
  if (previous === null) {
    requireTransition(change === "provision");
    return;
  }
  requireTransition(change !== "provision");
  const sameBinding = equal(previous.binding, next.binding);
  const sameEvidence = equal(previous.ownerEvidence, next.ownerEvidence);
  const sameProvenance = equal(previous.provenance, next.provenance);
  const sameInstallation =
    previous.installationActive === next.installationActive;
  const sameVerifier = previous.verifierActive === next.verifierActive;

  if (change === "binding-replacement") {
    requireTransition(
      !sameBinding &&
        previous.ownerEvidence.revoked === next.ownerEvidence.revoked &&
        sameInstallation &&
        sameVerifier,
    );
    return;
  }
  if (change === "owner-replacement") {
    requireTransition(
      sameBinding &&
        (!sameEvidence || !sameProvenance) &&
        previous.ownerEvidence.revoked === next.ownerEvidence.revoked &&
        sameInstallation &&
        sameVerifier,
    );
    return;
  }
  if (change === "owner-revocation") {
    requireTransition(
      sameBinding &&
        !previous.ownerEvidence.revoked &&
        next.ownerEvidence.revoked &&
        equal(next.ownerEvidence, {
          ...previous.ownerEvidence,
          revoked: true,
        }) &&
        sameProvenance &&
        sameInstallation &&
        sameVerifier,
    );
    return;
  }
  if (change === "installation-invalidation") {
    requireTransition(
      sameBinding &&
        sameEvidence &&
        sameProvenance &&
        previous.installationActive &&
        !next.installationActive &&
        sameVerifier,
    );
    return;
  }
  requireTransition(
    change === "verifier-withdrawal" &&
      sameBinding &&
      sameEvidence &&
      sameProvenance &&
      sameInstallation &&
      previous.verifierActive &&
      !next.verifierActive,
  );
}
