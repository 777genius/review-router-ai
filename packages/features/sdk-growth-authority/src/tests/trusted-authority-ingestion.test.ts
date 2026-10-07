import { describe, expect, it, vi } from "vitest";
import { ServerSideTrustedAuthorityIngestion } from "../application/trusted-authority-ingestion.js";
import { assertAuthorityTransition } from "../application/current-authority-transition.js";
import type {
  AuthenticatedAuthorityPrincipal,
  TrustedAuthorityRecord,
} from "../application/ports.js";

const digest = `sha256:${"a".repeat(64)}`;
const scope = { tenantId: "tenant", repositoryId: "repo", pullRequest: 42 };
const principal: AuthenticatedAuthorityPrincipal = {
  issuer: "control-plane",
  subject: "owner",
  authenticationId: "operator-session",
  tenantId: scope.tenantId,
  repositoryId: scope.repositoryId,
  githubRepositoryId: "123",
  installationId: "456",
};
const binding = {
  repositoryId: scope.repositoryId,
  pullRequest: scope.pullRequest,
  head: "1".repeat(40),
  base: "2".repeat(40),
  mergeBase: "3".repeat(40),
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
const record: TrustedAuthorityRecord = {
  ...scope,
  githubRepositoryId: principal.githubRepositoryId,
  installationId: principal.installationId,
  binding,
  approval: {
    version: 1,
    evidenceId: "approval",
    tenantId: scope.tenantId,
    ownerSubject: principal.subject,
    scopes: binding.scopes,
    decision: "approved",
    sourceDigest: digest,
    issuedAt: 1,
    expiresAt: 1_000,
    revoked: false,
  },
  approvalProvenance: {
    issuer: principal.issuer,
    subject: principal.subject,
    authenticationId: "approval-login",
    installationId: principal.installationId,
    sourceDigest: digest,
    authorizedSubjects: ["runner"],
  },
  installationActive: true,
  verifierActive: true,
};

function harness(overrides?: {
  principal?: AuthenticatedAuthorityPrincipal;
  record?: TrustedAuthorityRecord | null;
}) {
  const authenticate = vi.fn(async (credential: unknown) => {
    if (credential !== "trusted-operator") throw new Error("unauthorized");
    return structuredClone(overrides?.principal ?? principal);
  });
  const load = vi.fn(async () =>
    structuredClone(
      overrides && "record" in overrides ? overrides.record : record,
    ),
  );
  return {
    authenticate,
    load,
    ingestion: new ServerSideTrustedAuthorityIngestion(
      { authenticate },
      { load },
    ),
  };
}

describe("trusted SDK authority ingestion", () => {
  it("derives the complete canonical authority only from authenticated server custody", async () => {
    const h = harness();
    await expect(
      h.ingestion.authenticateAndLoad("trusted-operator", scope, "provision"),
    ).resolves.toEqual({
      binding,
      ownerEvidence: { ...record.approval, binding },
      provenance: {
        issuer: principal.issuer,
        subject: principal.subject,
        authenticationId: "approval-login",
        installationId: principal.installationId,
        sourceDigest: record.approval.sourceDigest,
        authorizedSubjects: record.approvalProvenance.authorizedSubjects,
      },
      installationActive: true,
      verifierActive: true,
    });
  });

  it("rejects candidate-authored approval JSON as a credential without consulting authority custody", async () => {
    const h = harness();
    await expect(
      h.ingestion.authenticateAndLoad(record, scope, "provision"),
    ).rejects.toThrow("unauthorized");
    expect(h.load).not.toHaveBeenCalled();
  });

  it.each([
    { tenantId: "other" },
    { repositoryId: "other" },
    { githubRepositoryId: "999" },
    { installationId: "999" },
  ])(
    "rejects a principal outside the requested authority %#",
    async (change) => {
      const h = harness({ principal: { ...principal, ...change } });
      await expect(
        h.ingestion.authenticateAndLoad("trusted-operator", scope, "provision"),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    },
  );

  it.each([
    { tenantId: "other" },
    { repositoryId: "other" },
    { pullRequest: 99 },
    { installationId: "999" },
    { githubRepositoryId: "999" },
  ])("rejects server custody for another scope %#", async (change) => {
    const h = harness({ record: { ...record, ...change } });
    await expect(
      h.ingestion.authenticateAndLoad("trusted-operator", scope, "provision"),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });

  it("preserves authenticated revocation and verifier withdrawal facts", async () => {
    const h = harness({
      record: {
        ...record,
        approval: { ...record.approval, revoked: true },
        verifierActive: false,
      },
    });
    await expect(
      h.ingestion.authenticateAndLoad(
        "trusted-operator",
        scope,
        "verifier-withdrawal",
      ),
    ).resolves.toMatchObject({
      ownerEvidence: { revoked: true },
      verifierActive: false,
    });
  });

  it.each([
    "owner-revocation",
    "installation-invalidation",
    "verifier-withdrawal",
  ] as const)(
    "preserves original approval provenance when %s uses a fresh login",
    async (change) => {
      const h = harness({
        principal: {
          ...principal,
          authenticationId: "fresh-operation-login",
        },
        record: {
          ...record,
          approval:
            change === "owner-revocation"
              ? { ...record.approval, revoked: true }
              : record.approval,
          installationActive: change !== "installation-invalidation",
          verifierActive: change !== "verifier-withdrawal",
        },
      });
      await expect(
        h.ingestion.authenticateAndLoad("trusted-operator", scope, change),
      ).resolves.toMatchObject({
        provenance: record.approvalProvenance,
      });
    },
  );

  it.each([
    "owner-revocation",
    "installation-invalidation",
    "verifier-withdrawal",
  ] as const)(
    "authorizes the complete %s transition with a distinct operation login",
    async (change) => {
      const previous = await harness().ingestion.authenticateAndLoad(
        "trusted-operator",
        scope,
        "provision",
      );
      const next = await harness({
        principal: {
          ...principal,
          authenticationId: "fresh-operation-login",
        },
        record: {
          ...record,
          approval:
            change === "owner-revocation"
              ? { ...record.approval, revoked: true }
              : record.approval,
          installationActive: change !== "installation-invalidation",
          verifierActive: change !== "verifier-withdrawal",
        },
      }).ingestion.authenticateAndLoad("trusted-operator", scope, change);
      expect(() =>
        assertAuthorityTransition(previous, next, change),
      ).not.toThrow();
      expect(next.provenance.authenticationId).toBe("approval-login");
    },
  );
});
