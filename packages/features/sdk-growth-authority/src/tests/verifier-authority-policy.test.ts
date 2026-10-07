import { describe, expect, it } from "vitest";
import { SdkGrowthVerifierAuthorityPolicy } from "../application/verifier-authority-policy.js";

const digest = `sha256:${"a".repeat(64)}`;
const execution = {
  tenantId: "tenant",
  repositoryId: "repo",
  pullRequest: 42,
  githubRepositoryId: "123",
  installationId: "456",
  subject: "runner",
  runId: "789",
  runAttempt: "1",
  verifierRevision: "1".repeat(40),
  sourceCommit: "2".repeat(40),
  sourceTree: "3".repeat(40),
};
const binding = {
  repositoryId: execution.repositoryId,
  pullRequest: execution.pullRequest,
  head: execution.sourceCommit,
  base: "4".repeat(40),
  mergeBase: "5".repeat(40),
  verifierId: "verifier",
  verifierDigest: digest,
  policyDigest: digest,
  toolDigest: digest,
  artifactDigest: digest,
  lockDigest: digest,
  historyDigest: digest,
  scopeDigest: digest,
  scopes: ["public-api"],
};
const ownerEvidence = {
  version: 1 as const,
  evidenceId: "owner",
  tenantId: execution.tenantId,
  ownerSubject: "owner",
  binding,
  scopes: binding.scopes,
  decision: "approved" as const,
  sourceDigest: digest,
  issuedAt: 10,
  expiresAt: 200,
  revoked: false,
};
const current = {
  epoch: 3,
  material: {
    binding,
    ownerEvidence,
    provenance: {
      issuer: "control-plane",
      subject: ownerEvidence.ownerSubject,
      authenticationId: "approval-login",
      installationId: execution.installationId,
      sourceDigest: digest,
      authorizedSubjects: [execution.subject],
    },
    installationActive: true,
    verifierActive: true,
  },
};

describe("SDK verifier current authority policy", () => {
  const authorize = (value = current, now = 100) =>
    new SdkGrowthVerifierAuthorityPolicy(() => now).authorize({
      execution,
      expectedEpoch: 3,
      current: value,
    });

  it("returns the immutable authority link for a currently authorized verifier subject", () => {
    expect(authorize()).toEqual({
      binding,
      authorityEpoch: 3,
      ownerEvidenceId: "owner",
      ownerSourceDigest: digest,
    });
  });

  it.each([
    { now: 9, subjects: [execution.subject] },
    { now: 200, subjects: [execution.subject] },
    { now: 100, subjects: ["other"] },
  ])(
    "rejects invalid approval time or subject membership %#",
    ({ now, subjects }) => {
      expect(() =>
        authorize(
          {
            ...current,
            material: {
              ...current.material,
              provenance: {
                ...current.material.provenance,
                authorizedSubjects: subjects,
              },
            },
          },
          now,
        ),
      ).toThrow(expect.objectContaining({ code: "owner-evidence" }));
    },
  );
});
