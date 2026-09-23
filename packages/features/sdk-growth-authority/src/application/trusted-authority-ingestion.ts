import { AuthorityError, type OwnerEvidence } from "../domain/contracts.js";
import {
  equal,
  parseBinding,
  parseOwnerEvidence,
} from "../domain/validation.js";
import type {
  AuthorityChange,
  AuthorityScope,
  CanonicalAuthorityMaterial,
  TrustedAuthorityAuthenticatorPort,
  TrustedAuthorityIngestion,
  TrustedAuthorityRecord,
  TrustedAuthoritySourcePort,
} from "./ports.js";

function invalid(): never {
  throw new AuthorityError("owner-evidence");
}

function exactRecord(value: unknown, keys: readonly string[]) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    invalid();
  return value as Record<string, unknown>;
}

function text(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(value)
  )
    invalid();
}

function validateRecord(
  source: TrustedAuthorityRecord,
  scope: AuthorityScope,
): TrustedAuthorityRecord {
  const value = exactRecord(source, [
    "tenantId",
    "repositoryId",
    "pullRequest",
    "githubRepositoryId",
    "installationId",
    "binding",
    "approval",
    "approvalProvenance",
    "installationActive",
    "verifierActive",
  ]);
  for (const key of [
    "tenantId",
    "repositoryId",
    "githubRepositoryId",
    "installationId",
  ])
    text(value[key]);
  if (
    value.tenantId !== scope.tenantId ||
    value.repositoryId !== scope.repositoryId ||
    value.pullRequest !== scope.pullRequest
  )
    invalid();
  const binding = parseBinding(value.binding);
  if (
    binding.repositoryId !== scope.repositoryId ||
    binding.pullRequest !== scope.pullRequest
  )
    invalid();
  const approvalValue = exactRecord(value.approval, [
    "version",
    "evidenceId",
    "tenantId",
    "ownerSubject",
    "scopes",
    "decision",
    "sourceDigest",
    "issuedAt",
    "expiresAt",
    "revoked",
  ]);
  const ownerEvidence = parseOwnerEvidence({
    ...approvalValue,
    binding,
  });
  if (
    ownerEvidence.tenantId !== scope.tenantId ||
    !equal(ownerEvidence.scopes, binding.scopes)
  )
    invalid();
  const provenanceValue = exactRecord(value.approvalProvenance, [
    "issuer",
    "subject",
    "authenticationId",
    "installationId",
    "sourceDigest",
    "authorizedSubjects",
  ]);
  for (const key of [
    "issuer",
    "subject",
    "authenticationId",
    "installationId",
    "sourceDigest",
  ])
    text(provenanceValue[key]);
  const subjects = provenanceValue.authorizedSubjects;
  if (
    !Array.isArray(subjects) ||
    subjects.length === 0 ||
    subjects.length > 1024 ||
    !subjects.every(
      (subject, index) =>
        typeof subject === "string" &&
        /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(subject) &&
        (index === 0 || (subjects[index - 1] as string) < subject),
    ) ||
    typeof value.installationActive !== "boolean" ||
    typeof value.verifierActive !== "boolean"
  )
    invalid();
  if (
    provenanceValue.subject !== ownerEvidence.ownerSubject ||
    provenanceValue.installationId !== value.installationId ||
    provenanceValue.sourceDigest !== ownerEvidence.sourceDigest
  )
    invalid();
  return {
    tenantId: value.tenantId as string,
    repositoryId: value.repositoryId as string,
    pullRequest: value.pullRequest as number,
    githubRepositoryId: value.githubRepositoryId as string,
    installationId: value.installationId as string,
    binding,
    approval: {
      version: 1,
      evidenceId: ownerEvidence.evidenceId,
      tenantId: ownerEvidence.tenantId,
      ownerSubject: ownerEvidence.ownerSubject,
      scopes: ownerEvidence.scopes,
      decision: ownerEvidence.decision,
      sourceDigest: ownerEvidence.sourceDigest,
      issuedAt: ownerEvidence.issuedAt,
      expiresAt: ownerEvidence.expiresAt,
      revoked: ownerEvidence.revoked,
    },
    approvalProvenance: {
      issuer: provenanceValue.issuer as string,
      subject: provenanceValue.subject as string,
      authenticationId: provenanceValue.authenticationId as string,
      installationId: provenanceValue.installationId as string,
      sourceDigest: provenanceValue.sourceDigest as string,
      authorizedSubjects: [...subjects] as string[],
    },
    installationActive: value.installationActive,
    verifierActive: value.verifierActive,
  };
}

/** Narrow production boundary: authenticate first, then load every canonical
 * field from server-side authority. Only the opaque credential and scope cross
 * this boundary; candidate JSON is never accepted as authority material. */
export class ServerSideTrustedAuthorityIngestion implements TrustedAuthorityIngestion {
  constructor(
    private readonly authenticator: TrustedAuthorityAuthenticatorPort,
    private readonly source: TrustedAuthoritySourcePort,
  ) {}

  async authenticateAndLoad(
    credential: unknown,
    scope: AuthorityScope,
    change: AuthorityChange,
  ): Promise<CanonicalAuthorityMaterial> {
    const principal = await this.authenticator.authenticate(
      credential,
      structuredClone(scope),
      change,
    );
    const identity = exactRecord(principal, [
      "issuer",
      "subject",
      "authenticationId",
      "tenantId",
      "repositoryId",
      "githubRepositoryId",
      "installationId",
    ]);
    for (const value of Object.values(identity)) text(value);
    if (
      identity.tenantId !== scope.tenantId ||
      identity.repositoryId !== scope.repositoryId
    )
      invalid();
    const loaded = await this.source.load({
      principal: structuredClone(principal),
      scope: structuredClone(scope),
      change,
    });
    if (!loaded) invalid();
    const record = validateRecord(structuredClone(loaded), scope);
    if (
      record.githubRepositoryId !== identity.githubRepositoryId ||
      record.installationId !== identity.installationId
    )
      invalid();
    const ownerEvidence: OwnerEvidence = {
      ...record.approval,
      binding: record.binding,
    };
    return {
      binding: record.binding,
      ownerEvidence,
      provenance: record.approvalProvenance,
      installationActive: record.installationActive,
      verifierActive: record.verifierActive,
    };
  }
}
