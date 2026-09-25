import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  AuthenticatedEfExecution,
  Completion,
} from "@reviewrouter/features-sdk-growth-authority";
import {
  PinnedEfAuthorityCodecV1,
  SdkGrowthVerifierAuthorityPolicy,
} from "@reviewrouter/features-sdk-growth-authority";
import {
  SdkGrowthVerifierCustody,
  PrismaSdkGrowthVerifierEvidenceCustody,
  sdkGrowthVerifierExecutionId,
  type FinalizedVerifierReportRecord,
  type VerifierCustodyRecord,
} from "./sdk-growth-verifier-custody.js";

const execution: AuthenticatedEfExecution = {
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
const report = Buffer.from("finalized-report");
const reportDigest =
  "sha256:" + createHash("sha256").update(report).digest("hex");
const digest = "sha256:" + "a".repeat(64);
const completion: Completion = {
  version: 1,
  grantId: "grant",
  fence: 1,
  binding: {
    repositoryId: "repo",
    pullRequest: 42,
    head: "2".repeat(40),
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
  },
  coveredScopes: ["public-api"],
  coverage: "complete",
  outcome: "passed",
  reportDigest,
};
const evidence: VerifierCustodyRecord = {
  producer: "reviewrouter-verifier",
  candidateWritable: false,
  authorityEpoch: 1,
  ownerEvidenceId: "owner",
  ownerSourceDigest: digest,
  verifierRevision: execution.verifierRevision,
  sourceCommit: execution.sourceCommit,
  sourceTree: execution.sourceTree,
  candidateArchiveSha256: digest,
  candidateArchiveSha512Sri: "sha512-" + "a".repeat(88),
  releasedArchiveSha256: digest,
  releasedArchiveSha512Sri: "sha512-" + "b".repeat(88),
  toolArchiveSha256: digest,
  toolArchiveSha512Sri: "sha512-" + "c".repeat(88),
  installedDistributionDigest: digest,
  authorityBinding: completion.binding,
};
const finalized: FinalizedVerifierReportRecord = {
  producer: "reviewrouter-verifier",
  candidateWritable: false,
  repositoryId: execution.repositoryId,
  pullRequest: execution.pullRequest,
  runId: execution.runId,
  runAttempt: execution.runAttempt,
  verifierRevision: execution.verifierRevision,
  reportDigest,
  reportLength: report.byteLength,
  grantId: completion.grantId,
  outcome: "passed",
  coverage: "complete",
  coveredScopes: ["public-api"],
  phases: ["authority", "decision"],
  finalizedReport: report,
};
const reportDecision = {
  outcome: "passed" as const,
  coverage: "complete" as const,
  coveredScopes: ["public-api"],
  phases: ["authority", "decision"],
};

function custody(
  retainedEvidence: VerifierCustodyRecord | null = evidence,
  retainedReport: FinalizedVerifierReportRecord | null = finalized,
) {
  return new SdkGrowthVerifierCustody({
    async load() {
      return structuredClone(retainedEvidence);
    },
    async loadFinalizedReport() {
      return structuredClone(retainedReport);
    },
  });
}

describe("SDK verifier custody adapter", () => {
  it("derives distinct evidence identity for pull requests in one execution", () => {
    expect(sdkGrowthVerifierExecutionId(execution, evidence)).not.toBe(
      sdkGrowthVerifierExecutionId({ ...execution, pullRequest: 99 }, evidence),
    );
  });

  it("accepts verifier-owned archive and finalized report custody", async () => {
    await expect(custody().load(execution)).resolves.toEqual(evidence);
    await expect(
      custody().verifyFinalizedReport({
        execution,
        report,
        completion,
        reportDecision,
      }),
    ).resolves.toBeUndefined();
  });

  it("rejects candidate-writable archive and report evidence", async () => {
    await expect(
      custody({ ...evidence, candidateWritable: true } as never).load(
        execution,
      ),
    ).rejects.toMatchObject({ code: "owner-evidence" });
    await expect(
      custody(evidence, {
        ...finalized,
        candidateWritable: true,
      } as never).verifyFinalizedReport({
        execution,
        report,
        completion,
        reportDecision,
      }),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });

  it.each([
    { pullRequest: 99 },
    { runId: "wrong" },
    { runAttempt: "wrong" },
    { verifierRevision: "9".repeat(40) },
    { reportLength: report.byteLength + 1 },
    { grantId: "wrong" },
  ])("rejects mismatched finalized report custody %#", async (change) => {
    await expect(
      custody(evidence, { ...finalized, ...change }).verifyFinalizedReport({
        execution,
        report,
        completion,
        reportDecision,
      }),
    ).rejects.toMatchObject({ code: "owner-evidence" });
  });

  it.each([
    { outcome: "failed" as const },
    { coverage: "partial" as const },
    { coveredScopes: ["other"] },
    { phases: ["authority"] },
  ])(
    "rejects a caller decision that differs from the trusted report %#",
    async (change) => {
      await expect(
        custody().verifyFinalizedReport({
          execution,
          report,
          completion,
          reportDecision: { ...reportDecision, ...change },
        }),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    },
  );
});

function verifierWriterHarness() {
  const ownerEvidence = {
    version: 1 as const,
    evidenceId: "owner",
    tenantId: execution.tenantId,
    ownerSubject: "owner",
    binding: completion.binding,
    scopes: completion.binding.scopes,
    decision: "approved" as const,
    sourceDigest: digest,
    issuedAt: 1,
    expiresAt: 10_000,
    revoked: false,
  };
  const grant = {
    version: 1 as const,
    grantId: completion.grantId,
    identity: {
      tenantId: execution.tenantId,
      repositoryId: execution.repositoryId,
      subject: execution.subject,
    },
    request: {
      version: 1 as const,
      requestId: "authority-request",
      repositoryId: execution.repositoryId,
      pullRequest: execution.pullRequest,
    },
    binding: completion.binding,
    ownerEvidence,
    fence: 1,
    authorityEpoch: 1,
    issuedAt: 100,
    expiresAt: 1_000,
  };
  const requestDigest = digest;
  const grantWire = new PinnedEfAuthorityCodecV1().encodeGrant({
    requestDigest,
    grant,
  });
  const grantDigest =
    "sha256:" + createHash("sha256").update(grantWire).digest("hex");
  const evidenceRows = new Map<string, Record<string, unknown>>();
  const reportRows = new Map<string, Record<string, unknown>>();
  let currentOwner = structuredClone(ownerEvidence);
  let currentInstallationId = execution.installationId;
  let currentEpoch = 1n;
  let currentInstallationActive = true;
  let currentVerifierActive = true;
  let admissionAvailable = true;
  let now = 100;
  let credentialExpiresAt = Infinity;
  let assignmentExpiresAt = Infinity;
  let authorityLockWait: (() => Promise<void>) | undefined;
  const transaction = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (
        sql.includes(
          "SELECT * FROM public.sdk_growth_verifier_current_authority_lock(",
        )
      ) {
        await authorityLockWait?.();
        return [
          {
            epoch: currentEpoch,
            binding: completion.binding,
            evidence: currentOwner,
            provenance: {
              issuer: "control-plane",
              subject: currentOwner.ownerSubject,
              authenticationId: "approval-login",
              installationId: currentInstallationId,
              sourceDigest: currentOwner.sourceDigest,
              authorizedSubjects: [execution.subject],
            },
            installationActive: currentInstallationActive,
            verifierActive: currentVerifierActive,
          },
        ];
      }
      if (sql.includes('SELECT * FROM "SdkGrowthVerifierEvidence" WHERE')) {
        const row = evidenceRows.get(String(values[0]));
        return row ? [structuredClone(row)] : [];
      }
      if (sql.includes('FROM "SdkGrowthAuthorityCustody"'))
        return admissionAvailable
          ? [{ requestDigest, grantDigest, grantWire }]
          : [];
      if (sql.includes('SELECT r.*, e."pullRequest"')) {
        const row = sql.includes('r."reportEvidenceId"')
          ? [...reportRows.values()].find(
              (candidate) => candidate.reportEvidenceId === values[0],
            )
          : [...reportRows.values()].find(
              (candidate) =>
                candidate.evidenceId === values[0] &&
                candidate.reportDigest === values[1],
            );
        return row ? [structuredClone(row)] : [];
      }
      throw new Error(`unexpected query: ${sql}`);
    },
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const sql = strings.join("?");
      if (sql.includes('INSERT INTO "SdkGrowthVerifierEvidence"')) {
        const evidenceId = String(values[0]);
        if (!evidenceRows.has(evidenceId))
          evidenceRows.set(evidenceId, {
            evidenceId,
            tenantId: values[1],
            repositoryId: values[2],
            pullRequest: BigInt(values[3] as number),
            githubRepositoryId: values[4],
            installationId: values[5],
            subject: values[6],
            runId: values[7],
            runAttempt: values[8],
            verifierRevision: values[9],
            sourceCommit: values[10],
            sourceTree: values[11],
            producer: "reviewrouter-verifier",
            candidateWritable: false,
            authorityBinding: JSON.parse(String(values[12])),
            candidateArchive: values[13],
            candidateArchiveSha256: values[14],
            candidateArchiveSha512Sri: values[15],
            releasedArchive: values[16],
            releasedArchiveSha256: values[17],
            releasedArchiveSha512Sri: values[18],
            toolArchive: values[19],
            toolArchiveSha256: values[20],
            toolArchiveSha512Sri: values[21],
            installedDistributionWire: values[22],
            installedDistributionDigest: values[23],
          });
        return 1;
      }
      if (sql.includes('INSERT INTO "SdkGrowthFinalizedReportEvidence"')) {
        const evidenceId = String(values[1]);
        const reportDigest = String(values[6]);
        const key = `${evidenceId}:${String(values[8])}`;
        if (!reportRows.has(key))
          reportRows.set(key, {
            reportEvidenceId: values[0],
            evidenceId,
            repositoryId: values[2],
            pullRequest: BigInt(execution.pullRequest),
            runId: values[3],
            runAttempt: values[4],
            verifierRevision: values[5],
            producer: "reviewrouter-verifier",
            candidateWritable: false,
            reportDigest,
            finalizedReport: values[7],
            grantId: values[8],
            outcome: values[9],
            coverage: values[10],
            coveredScopes: JSON.parse(String(values[11])),
            phases: JSON.parse(String(values[12])),
          });
        return 1;
      }
      throw new Error(`unexpected execute: ${sql}`);
    },
  };
  const database = {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      return transaction.$queryRaw(strings, ...values);
    },
    async $transaction<T>(operation: (tx: typeof transaction) => Promise<T>) {
      return operation(transaction);
    },
  };
  let authenticatedExecution = execution;
  const authenticator = {
    async authenticate(credential: unknown) {
      if (credential !== "verifier-credential") throw new Error("unauthorized");
      if (now >= credentialExpiresAt || now >= assignmentExpiresAt)
        throw new Error("credential_expired");
      return {
        producer: "reviewrouter-verifier" as const,
        issuer: "workload-identity",
        subject: "verifier-service",
        authenticationId: "verification-job",
        execution: structuredClone(authenticatedExecution),
      };
    },
  };
  const writer = new PrismaSdkGrowthVerifierEvidenceCustody(
    database as never,
    authenticator,
    new SdkGrowthVerifierAuthorityPolicy(() => 100),
  );
  const evidenceInput = {
    expectedAuthorityEpoch: 1,
    candidateArchive: Buffer.from("candidate"),
    releasedArchive: Buffer.from("released"),
    toolArchive: Buffer.from("tool"),
    installedDistributionWire: Buffer.from("distribution"),
  };
  return {
    writer,
    evidenceInput,
    requestDigest,
    grantDigest,
    evidenceRows,
    reportRows,
    setNow(value: number) {
      now = value;
    },
    setDeadlines(credential: number, assignment: number) {
      credentialExpiresAt = credential;
      assignmentExpiresAt = assignment;
    },
    waitAtAuthorityLock(wait: () => Promise<void>) {
      authorityLockWait = wait;
    },
    setExecution(value: AuthenticatedEfExecution) {
      authenticatedExecution = value;
    },
    replaceOwner() {
      currentEpoch = 2n;
      currentOwner = { ...currentOwner, evidenceId: "replacement" };
    },
    revoke() {
      currentOwner = { ...currentOwner, revoked: true };
    },
    invalidateInstallation() {
      currentInstallationActive = false;
    },
    replaceInstallation() {
      currentInstallationId = "replacement-installation";
    },
    withdrawVerifier() {
      currentVerifierActive = false;
    },
    removeAdmission() {
      admissionAvailable = false;
    },
  };
}

describe("trusted verifier producer custody", () => {
  it("retains evidence when the authority wait ends before both deadlines", async () => {
    const h = verifierWriterHarness();
    h.setDeadlines(150, 150);
    h.waitAtAuthorityLock(async () => h.setNow(149));
    await expect(
      h.writer.retainEvidence("verifier-credential", h.evidenceInput),
    ).resolves.toMatchObject({ authorityEpoch: 1 });
    expect(h.evidenceRows.size).toBe(1);
  });

  it.each([
    ["credential", 150, 200],
    ["assignment", 200, 150],
  ] as const)(
    "rejects evidence when the %s expires while the authority lock waits",
    async (_deadline, credentialExpiry, assignmentExpiry) => {
      const h = verifierWriterHarness();
      h.setDeadlines(credentialExpiry, assignmentExpiry);
      let entered!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => (entered = resolve));
      const blocked = new Promise<void>((resolve) => (release = resolve));
      h.waitAtAuthorityLock(async () => {
        entered();
        await blocked;
      });
      const attempt = h.writer.retainEvidence(
        "verifier-credential",
        h.evidenceInput,
      );
      await locked;
      h.setNow(150);
      release();
      await expect(attempt).rejects.toThrow("credential_expired");
      expect(h.evidenceRows.size).toBe(0);
    },
  );

  it.each([
    ["credential", 150, 200],
    ["assignment", 200, 150],
  ] as const)(
    "rejects finalization when the %s expires while the authority lock waits",
    async (_deadline, credentialExpiry, assignmentExpiry) => {
      const h = verifierWriterHarness();
      await h.writer.retainEvidence("verifier-credential", h.evidenceInput);
      h.setDeadlines(credentialExpiry, assignmentExpiry);
      let entered!: () => void;
      let release!: () => void;
      const locked = new Promise<void>((resolve) => (entered = resolve));
      const blocked = new Promise<void>((resolve) => (release = resolve));
      h.waitAtAuthorityLock(async () => {
        entered();
        await blocked;
      });
      const attempt = h.writer.retainFinalizedReport("verifier-credential", {
        expectedAuthorityEpoch: 1,
        requestDigest: h.requestDigest,
        grantDigest: h.grantDigest,
        finalizedReport: report,
        decision: reportDecision,
      });
      await locked;
      h.setNow(150);
      release();
      await expect(attempt).rejects.toThrow("credential_expired");
      expect(h.evidenceRows.size).toBe(1);
      expect(h.reportRows.size).toBe(0);
    },
  );

  it("persists independently authenticated evidence and a report bound to the exact admission grant", async () => {
    const h = verifierWriterHarness();
    await expect(
      h.writer.retainEvidence("verifier-credential", h.evidenceInput),
    ).resolves.toMatchObject({
      authorityEpoch: 1,
      ownerEvidenceId: "owner",
      authorityBinding: completion.binding,
    });
    const retained = await h.writer.retainFinalizedReport(
      "verifier-credential",
      {
        expectedAuthorityEpoch: 1,
        requestDigest: h.requestDigest,
        grantDigest: h.grantDigest,
        finalizedReport: report,
        decision: reportDecision,
      },
    );
    expect(retained).toMatchObject({
      grantId: completion.grantId,
      reportDigest,
    });
    expect(Buffer.from(retained.finalizedReport)).toEqual(report);
  });

  it("makes an identical finalization retry idempotent and rejects changed bytes or decision for the same grant", async () => {
    const h = verifierWriterHarness();
    await h.writer.retainEvidence("verifier-credential", h.evidenceInput);
    const input = {
      expectedAuthorityEpoch: 1,
      requestDigest: h.requestDigest,
      grantDigest: h.grantDigest,
      finalizedReport: report,
      decision: reportDecision,
    };
    const first = await h.writer.retainFinalizedReport(
      "verifier-credential",
      input,
    );
    await expect(
      h.writer.retainFinalizedReport("verifier-credential", input),
    ).resolves.toEqual(first);
    await expect(
      h.writer.retainFinalizedReport("verifier-credential", {
        ...input,
        finalizedReport: Buffer.from("changed-report"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      h.writer.retainFinalizedReport("verifier-credential", {
        ...input,
        decision: { ...reportDecision, outcome: "failed" },
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects candidate-authored evidence without invoking database custody", async () => {
    const h = verifierWriterHarness();
    await expect(
      h.writer.retainEvidence({ candidate: true }, h.evidenceInput),
    ).rejects.toThrow("unauthorized");
  });

  it.each([
    { tenantId: "other" },
    { repositoryId: "other" },
    { pullRequest: 99 },
    { runId: "wrong" },
  ])("rejects producer identity for another execution %#", async (change) => {
    const h = verifierWriterHarness();
    await h.writer.retainEvidence("verifier-credential", h.evidenceInput);
    h.setExecution({ ...execution, ...change });
    await expect(
      h.writer.retainFinalizedReport("verifier-credential", {
        expectedAuthorityEpoch: 1,
        requestDigest: h.requestDigest,
        grantDigest: h.grantDigest,
        finalizedReport: report,
        decision: reportDecision,
      }),
    ).rejects.toMatchObject({
      code: change.runId ? "owner-evidence" : "owner-evidence",
    });
  });

  it("rejects changed archive bytes for an immutable execution identity", async () => {
    const h = verifierWriterHarness();
    await h.writer.retainEvidence("verifier-credential", h.evidenceInput);
    await expect(
      h.writer.retainEvidence("verifier-credential", {
        ...h.evidenceInput,
        candidateArchive: Buffer.from("changed"),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("rejects a finalized report without prior verifier evidence or admission custody", async () => {
    const missingEvidence = verifierWriterHarness();
    await expect(
      missingEvidence.writer.retainFinalizedReport("verifier-credential", {
        expectedAuthorityEpoch: 1,
        requestDigest: missingEvidence.requestDigest,
        grantDigest: missingEvidence.grantDigest,
        finalizedReport: report,
        decision: reportDecision,
      }),
    ).rejects.toMatchObject({ code: "owner-evidence" });

    const missingAdmission = verifierWriterHarness();
    await missingAdmission.writer.retainEvidence(
      "verifier-credential",
      missingAdmission.evidenceInput,
    );
    missingAdmission.removeAdmission();
    await expect(
      missingAdmission.writer.retainFinalizedReport("verifier-credential", {
        expectedAuthorityEpoch: 1,
        requestDigest: missingAdmission.requestDigest,
        grantDigest: missingAdmission.grantDigest,
        finalizedReport: report,
        decision: reportDecision,
      }),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("rejects stale epoch, owner replacement, revocation, installation invalidation, and verifier withdrawal", async () => {
    const stale = verifierWriterHarness();
    await expect(
      stale.writer.retainEvidence("verifier-credential", {
        ...stale.evidenceInput,
        expectedAuthorityEpoch: 2,
      }),
    ).rejects.toMatchObject({ code: "owner-evidence" });

    for (const change of [
      "replaceOwner",
      "revoke",
      "invalidateInstallation",
      "replaceInstallation",
      "withdrawVerifier",
    ] as const) {
      const h = verifierWriterHarness();
      await h.writer.retainEvidence("verifier-credential", h.evidenceInput);
      h[change]();
      await expect(
        h.writer.retainFinalizedReport("verifier-credential", {
          expectedAuthorityEpoch: change === "replaceOwner" ? 2 : 1,
          requestDigest: h.requestDigest,
          grantDigest: h.grantDigest,
          finalizedReport: report,
          decision: reportDecision,
        }),
      ).rejects.toMatchObject({ code: "owner-evidence" });
    }
  });
});
