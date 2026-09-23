import type { Binding } from "../domain/contracts.js";
import { AuthorityError } from "../domain/contracts.js";
import { assertOwner } from "../domain/policy.js";
import { equal } from "../domain/validation.js";
import type { AuthenticatedEfExecution } from "./ef-authority-service.js";
import type { CanonicalAuthorityMaterial } from "./ports.js";

export interface VerifierCurrentAuthority {
  readonly epoch: number;
  readonly material: CanonicalAuthorityMaterial;
}

export interface VerifierAuthorityLink {
  readonly binding: Binding;
  readonly authorityEpoch: number;
  readonly ownerEvidenceId: string;
  readonly ownerSourceDigest: string;
}

export interface VerifierAuthorityPolicyPort {
  authorize(input: {
    readonly execution: AuthenticatedEfExecution;
    readonly expectedEpoch: number;
    readonly current: VerifierCurrentAuthority;
  }): VerifierAuthorityLink;
}

/** Shared application policy for verifier custody reads and writes. Database
 * adapters supply a transactionally fenced current epoch; this service owns
 * approval validity, subject membership, installation and binding policy. */
export class SdkGrowthVerifierAuthorityPolicy implements VerifierAuthorityPolicyPort {
  constructor(private readonly now: () => number = Date.now) {}

  authorize(input: {
    readonly execution: AuthenticatedEfExecution;
    readonly expectedEpoch: number;
    readonly current: VerifierCurrentAuthority;
  }): VerifierAuthorityLink {
    const { execution, current, expectedEpoch } = input;
    const { material } = current;
    const now = this.now();
    if (
      !Number.isSafeInteger(expectedEpoch) ||
      expectedEpoch < 1 ||
      !Number.isSafeInteger(current.epoch) ||
      current.epoch !== expectedEpoch ||
      !Number.isSafeInteger(now) ||
      now < 0 ||
      !material.installationActive ||
      !material.verifierActive ||
      material.provenance.installationId !== execution.installationId ||
      !material.provenance.authorizedSubjects.includes(execution.subject) ||
      material.binding.repositoryId !== execution.repositoryId ||
      material.binding.pullRequest !== execution.pullRequest ||
      material.binding.head !== execution.sourceCommit ||
      material.ownerEvidence.tenantId !== execution.tenantId ||
      material.provenance.subject !== material.ownerEvidence.ownerSubject ||
      material.provenance.sourceDigest !==
        material.ownerEvidence.sourceDigest ||
      !equal(material.binding, material.ownerEvidence.binding) ||
      !equal(material.binding.scopes, material.ownerEvidence.scopes)
    )
      throw new AuthorityError("owner-evidence");
    assertOwner(
      {
        tenantId: execution.tenantId,
        repositoryId: execution.repositoryId,
        subject: execution.subject,
      },
      material.binding,
      material.ownerEvidence,
      now,
    );
    return {
      binding: structuredClone(material.binding),
      authorityEpoch: current.epoch,
      ownerEvidenceId: material.ownerEvidence.evidenceId,
      ownerSourceDigest: material.ownerEvidence.sourceDigest,
    };
  }
}
