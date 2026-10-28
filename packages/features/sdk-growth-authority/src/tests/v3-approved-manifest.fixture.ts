import { createHash } from "node:crypto";

export const scope = {
  tenantId: "test-tenant",
  repositoryId: "test-repo",
  pullRequest: 42,
};
export const source = { commit: "1".repeat(40), tree: "2".repeat(40) };
export const digest = `sha256:${"a".repeat(64)}`;
export const sri = `sha512-${"A".repeat(86)}==`;
export const toolId = "b".repeat(64);
export const wire = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value));
export const hash = (value: Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}`;
const reference = { wireSha256: digest, byteLength: 10, source };

export function proposal(pullRequest = 42) {
  const binding = {
    invocation: {
      repository: "github:123",
      sourceCommit: source.commit,
      sourceTree: source.tree,
      topologyDigest: digest,
      lockDigest: digest,
      toolchainDigest: digest,
      artifactDigests: [digest],
      tool: {
        version: "1.6.1",
        artifactDigest: digest,
        extractorVersion: "7.58.12",
      },
    },
    target: {
      repository: {
        provider: "github",
        repositoryId: "123",
        owner: "test",
        name: "repo",
      },
      pullRequestNumber: pullRequest,
      head: source,
      base: source,
      mergeBase: source,
      evaluation: source,
      evaluationKind: "head",
    },
    verifier: {
      identity: "test",
      immutableRevision: source.commit,
      artifactDigest: digest,
    },
    tool: {
      packageName: "@agent-teams/engineering-foundation",
      version: "1.6.1",
      archiveDigest: digest,
      archiveIntegrity: sri,
      distributionDigest: digest,
      extractorVersion: "7.58.12",
    },
    policy: {
      contractRevision: "foundation:sdk-growth:c0:5",
      policyVersion: "foundation:sdk-growth:policy:1",
      enrollmentRevision: source.commit,
      configurationDigest: digest,
      scopeDigest: digest,
      commandDigest: digest,
    },
    historyDigest: digest,
    evidenceManifestDigest: digest,
  };
  const contextSelectors = {
    trustedBasePath: "evidence/base.json",
    decisionsPath: "evidence/decisions.json",
    released: [
      {
        packageName: "pkg",
        kind: "initial-unreleased",
        trustedHistoryPath: "evidence/pkg.json",
      },
    ],
  };
  const request = {
    schemaVersion: "reviewrouter:sdk-growth-authority:3",
    kind: "request",
    operation: "check",
    admissionReceiptId: null,
    binding,
    contextSelectors,
    decisionDigests: [],
    requiredPhases: [
      "topology",
      "observation",
      "packed",
      "decision",
      "trusted-base",
      "released",
      "authority",
    ],
  };
  const requestWire = wire(request);
  const validation = {
    schema: "reviewrouter:g1-v3-request-validation-fixture:1",
    requestWireSha256: hash(requestWire),
    requestByteLength: requestWire.byteLength,
    toolArtifactId: toolId,
    result: "validated",
  };
  const validationEvidenceWire = wire(validation);
  const manifest = {
    schema: "reviewrouter:g1-approved-v3-manifest:1",
    scope: {
      ...scope,
      pullRequest,
      githubRepositoryId: "123",
      installationId: "456",
    },
    approval: {
      version: 3,
      evidenceId: "test-approval",
      tenantId: scope.tenantId,
      ownerSubject: "test-owner",
      scopes: ["api"],
      decision: "approved",
      sourceDigest: digest,
      issuedAt: 1,
      expiresAt: 9_999_999_999_999,
      revoked: false,
      operation: "check",
    },
    provenance: {
      issuer: "test-issuer",
      subject: "test-owner",
      authenticationId: "test-auth",
      installationId: "456",
      sourceDigest: digest,
      authorizedSubjects: ["test-runner"],
    },
    ef: { schemaVersion: request.schemaVersion, binding, contextSelectors },
    tool: {
      efToolArtifactId: toolId,
      archiveSha256: digest,
      archiveSha512Sri: sri,
      source,
      installedDistributionDigest: digest,
    },
    governedPackages: ["pkg"],
    packages: [
      {
        packageName: "pkg",
        candidate: {
          version: "1.0.0",
          source,
          archive: { sha256: digest, sha512Sri: sri, byteLength: 10 },
          evidence: reference,
          observationDigest: digest,
        },
        baseline: { kind: "initial-unreleased", historyDigest: digest },
      },
    ],
    metadataRootNames: [],
    metadataRoots: [],
    retainedHistory: {
      targetSource: source,
      receiptDigest: digest,
      custodyEvidence: reference,
    },
    requestWireSha256: hash(requestWire),
    requestByteLength: requestWire.byteLength,
    validationEvidenceSha256: hash(validationEvidenceWire),
    validationEvidenceByteLength: validationEvidenceWire.byteLength,
  };
  return { manifest, request, requestWire, validationEvidenceWire };
}
